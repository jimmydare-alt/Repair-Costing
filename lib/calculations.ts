import { defaultRepairCatalog, materialById, repairTypeByCode } from "./repairCatalog";
import { distanceRateUnit } from "./company";
import type { AdminRates, AirportTransport, CommercialRateSchedule, DestinationTransport, Line, MaterialCalc, PLActuals, PLCategory, PLSummary, ProjectCalculations, ProjectInput, ProjectServiceKey, RemedialWorkPackage, RepairCatalog, RepairLineItem, RepairMaterial, RepairTypeMaterialRule, Section, TravelMode, WorkPackageCalculationSummary } from "./types";
import { chargeableJourneyDistance, effectiveReturnFlights } from "./travel";
import { packageProjectInput } from "./workPackages";

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const pct = (value: number) => Math.round(value * 10000) / 100;
const ceil = (value: number) => Math.ceil(Math.max(0, value));
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function sectionPLCategory(section: Section): PLCategory {
  if (section === "Subcontract") return "Subcontract";
  if (section === "Materials") return "Materials";
  if (section === "Equipment" || section === "Additional items") return "Equipment";
  if (section === "Travel") return "Travel";
  if (section === "Hotel" || section === "Subsistence") return "Hotel/Subsistence";
  if (section === "Haulage") return "Haulage";
  return "Labour";
}

function line(section: Section, item: string, rate: number, unit: string, quantity: number, marginRate: number, source: string, plCategory: PLCategory = sectionPLCategory(section), costKind: Line["costKind"] = "operating"): Line {
  const cost = money(num(rate) * num(quantity));
  const margin = money(cost * num(marginRate));
  const total = money(cost + margin);
  return { section, item, rate: num(rate), unit, quantity: num(quantity), cost, margin, total, discount: 0, originalTotal: total, source, plCategory, costKind };
}

function rateMargin(rates: AdminRates, key: keyof AdminRates, fallback: number) {
  return num(rates.rateMargins?.[String(key)] ?? fallback);
}

type InternalTravelLineOptions = {
  enabled: boolean;
  prefix: string;
  travelItem?: string;
  mileageItem?: string;
  source: string;
  mode: TravelMode;
  people: number;
  travelDays: number;
  travelDayRate: number;
  travelDayMargin: number;
  primaryOneWay: number;
  secondaryOneWay: number;
  vehicles: number;
  journeys?: number;
  mileageRate: number;
  mileageMargin: number;
  returnFlights: number;
  airportTransport: AirportTransport;
  airportTransferReturns: number;
  airportParkingDays: number;
  destinationTransport: DestinationTransport;
  rentalVehicles: number;
  rentalVehicleDays: number;
  costKind?: Line["costKind"];
};

function internalTravelLines(input: ProjectInput, rates: AdminRates, options: InternalTravelLineOptions) {
  const active = options.enabled && options.mode !== "None";
  const drive = active && options.mode === "Drive";
  const fly = active && options.mode === "Fly";
  const people = Math.max(0, num(options.people));
  const vehicles = Math.max(0, num(options.vehicles));
  const mileage = drive ? chargeableJourneyDistance(input.officeCount, options.primaryOneWay, options.secondaryOneWay, vehicles, options.journeys ?? 1) : 0;
  const flights = fly ? effectiveReturnFlights(options.returnFlights, people) : 0;
  const airportReturns = fly && options.airportTransport === "Uber" ? num(options.airportTransferReturns) || 1 : 0;
  const airportParking = fly && options.airportTransport === "Drive" ? num(options.airportParkingDays) * Math.max(1, vehicles) : 0;
  const rentalVehicles = Math.max(1, num(options.rentalVehicles));
  const rentalDays = fly && options.destinationTransport !== "None" ? rentalVehicles * num(options.rentalVehicleDays) : 0;
  const rentalRate = options.destinationTransport === "Rental Van" ? rates.rentalVan : rates.rentalCar;
  const rentalKey: keyof AdminRates = options.destinationTransport === "Rental Van" ? "rentalVan" : "rentalCar";
  const costKind = options.costKind ?? "mobilisation";
  return [
    line("Travel", options.travelItem ?? `${options.prefix} travel days`, options.travelDayRate, "person day", active ? people * num(options.travelDays) : 0, options.travelDayMargin, `${options.source} travel days`, "Travel", costKind),
    line("Travel", options.mileageItem ?? `${options.prefix} mileage`, options.mileageRate, distanceRateUnit(input.distanceUnit), mileage, options.mileageMargin, `${options.source} office journey x vehicles`, "Travel", costKind),
    line("Travel", `${options.prefix} return flights`, rates.returnFlight, "flight", flights, rateMargin(rates, "returnFlight", rates.flightMargin), `${options.source} return flights`, "Travel", costKind),
    line("Travel", `${options.prefix} airport transfer`, rates.airportUberReturn, "return", airportReturns, rateMargin(rates, "airportUberReturn", rates.travelMargin), `${options.source} return airport transfer`, "Travel", costKind),
    line("Travel", `${options.prefix} airport parking`, rates.airportParkingPerDay, "vehicle day", airportParking, rateMargin(rates, "airportParkingPerDay", rates.travelMargin), `${options.source} airport parking days x vehicles`, "Travel", costKind),
    line("Travel", `${options.prefix} ${options.destinationTransport === "Rental Van" ? "rental van" : "rental car"}`, rentalRate, "vehicle day", rentalDays, rateMargin(rates, rentalKey, rates.travelMargin), `${options.source} destination transport`, "Travel", costKind)
  ];
}

const nonCurrencyRateKeys = new Set(["hotelMargin", "subsistenceMargin", "subcontractMargin", "defaultMargin", "travelMargin", "flightMargin", "equipmentMargin", "materialMargin", "shippingMargin", "materialShippingMargin", "equipmentShippingMargin", "bdmBonusRate", "screedMaterialContingency", "screedMaterialWaste", "screedPrimerContingency", "screedPrimerWaste", "screedSandContingency", "screedSandWaste"]);

export function ratesInQuoteCurrency(rates: AdminRates, companyCurrencyPerQuoteCurrency: number): AdminRates {
  const divisor = num(companyCurrencyPerQuoteCurrency) > 0 ? num(companyCurrencyPerQuoteCurrency) : 1;
  const converted = { ...rates } as Record<string, unknown>;
  Object.entries(rates).forEach(([key, value]) => {
    if (key !== "rateMargins" && !nonCurrencyRateKeys.has(key) && typeof value === "number") converted[key] = money(value / divisor);
  });
  return converted as AdminRates;
}

export function screedMaterialUnits(baseUnits: number, contingency: number, waste: number) {
  return Math.max(0, num(baseUnits)) * (1 + Math.max(0, num(contingency)) + Math.max(0, num(waste)));
}

function volumeRequirement(volumeLitres: number, material: RepairMaterial) {
  return material.measuredUnitType === "m3" ? volumeLitres / 1000 : volumeLitres;
}

function holeVolumeLitres(repairLine: RepairLineItem) {
  const diameter = num(repairLine.holeDiameterMm);
  const depth = num(repairLine.holeDepthMm);
  const each = num(repairLine.eachQty);
  if (!diameter || !depth || !each) return 0;
  return (Math.PI * Math.pow(diameter / 2, 2) * depth * each) / 1000000;
}

function holeInternalAreaM2(repairLine: RepairLineItem) {
  const diameter = num(repairLine.holeDiameterMm);
  const depth = num(repairLine.holeDepthMm);
  const each = num(repairLine.eachQty);
  if (!diameter || !depth || !each) return 0;
  const sideAreaMm2 = Math.PI * diameter * depth;
  const bottomAreaMm2 = Math.PI * Math.pow(diameter / 2, 2);
  return ((sideAreaMm2 + bottomAreaMm2) * each) / 1000000;
}

export function grindingDays(input: ProjectInput) {
  return input.includeGrinding && input.grinding.enabled ? num(input.grinding.estimatedDays) : 0;
}

export function screedDays(input: ProjectInput) {
  if (!input.includeScreeding || !input.screeding.enabled) return 0;
  return num(input.screeding.preparationDays) + num(input.screeding.screedingDays) + num(input.screeding.grindingDays);
}

export function repairDays(input: ProjectInput, repairCatalog: RepairCatalog = defaultRepairCatalog) {
  if (!input.includeRepairs || !input.repairs.enabled) return 0;
  if (num(input.repairs.labourDays) > 0) return num(input.repairs.labourDays);
  const lineDays = input.repairs.repairLines.reduce((sum, repairLine) => {
    const type = repairTypeByCode(repairLine.repairTypeCode, repairCatalog);
    const output = num(repairLine.outputPerDay) || type.defaultOutputPerDay || 1;
    const qty = type.measurementBasis === "area" ? repairLine.areaM2 : type.measurementBasis === "each" ? repairLine.eachQty : repairLine.lengthM;
    return sum + (output ? num(qty) / output : 0);
  }, 0);
  return Math.ceil(money(lineDays));
}

export function weekendDaysForProgramme(days: number, standardDaysPerWeek: number, weekendDaysPerWeek: number) {
  const weekend = Math.min(2, Math.max(0, num(weekendDaysPerWeek)));
  if (!days || !weekend) return 0;
  const cycle = Math.max(1, num(standardDaysPerWeek) + weekend);
  const wholeDays = Math.ceil(days);
  const fullCycles = Math.floor(wholeDays / cycle);
  const remainder = wholeDays % cycle;
  return Math.min(wholeDays, fullCycles * weekend + Math.min(weekend, Math.max(0, remainder - Math.max(0, num(standardDaysPerWeek)))));
}

export function nonWorkingDaysForProgramme(days: number, weekendDaysPerWeek: number) {
  const workDays = Math.ceil(Math.max(0, num(days)));
  if (workDays <= 1) return 0;
  const weekendWorked = Math.min(2, Math.max(0, num(weekendDaysPerWeek)));
  const workedPerWeek = 5 + weekendWorked;
  const nonWorkingPerWeek = 2 - weekendWorked;
  return Math.floor((workDays - 1) / workedPerWeek) * nonWorkingPerWeek;
}

export function calculatedHotelNights(siteDays: number, weekendDaysPerWeek: number, travelDays: number) {
  const workDays = Math.ceil(Math.max(0, num(siteDays)));
  if (!workDays) return 0;
  return Math.max(0, workDays + nonWorkingDaysForProgramme(workDays, weekendDaysPerWeek) + Math.ceil(Math.max(0, num(travelDays))) - 1);
}

export function calculatePhaseSchedule(input: ProjectInput, repairCatalog: RepairCatalog = defaultRepairCatalog) {
  const calculated: Record<ProjectServiceKey, number> = {
    Grinding: Math.ceil(grindingDays(input)),
    Screeding: Math.ceil(screedDays(input)),
    Repairs: Math.ceil(repairDays(input, repairCatalog))
  };
  const selected = ([input.includeGrinding && input.grinding.enabled && "Grinding", input.includeScreeding && input.screeding.enabled && "Screeding", input.includeRepairs && input.repairs.enabled && "Repairs"] as Array<ProjectServiceKey | false>).filter((item): item is ProjectServiceKey => Boolean(item));
  const ordered = [...input.phaseSchedule.order.filter((service) => selected.includes(service)), ...selected.filter((service) => !input.phaseSchedule.order.includes(service))];
  let previousStart = 1;
  let previousEnd = 0;
  const rows = ordered.map((service, index) => {
    const inputDays = calculated[service];
    const legacyConcurrent = index > 0 && Boolean(input.phaseSchedule.startsWithPrevious[service]);
    const defaultStart = index === 0 ? 1 : legacyConcurrent ? previousStart : previousEnd + 1;
    const startDay = Math.max(1, Math.ceil(num(input.phaseSchedule.startDays?.[service]) || defaultStart));
    const endDay = inputDays > 0 ? startDay + inputDays - 1 : startDay - 1;
    const concurrent = index > 0 && startDay <= previousEnd;
    previousStart = startDay;
    previousEnd = Math.max(previousEnd, endDay);
    return { service, calculatedDays: calculated[service], inputDays, startDay, endDay, concurrent };
  });
  const calculatedProjectDays = rows.length ? Math.max(...rows.map((row) => row.endDay)) : 0;
  const projectDays = calculatedProjectDays;
  return { rows, calculatedProjectDays, projectDays };
}

function calculateCatalogueRequirement(repairLine: RepairLineItem, material: RepairMaterial, rule: RepairTypeMaterialRule, selection?: RepairLineItem["materialSelections"][number]) {
  const length = num(repairLine.lengthM);
  const selectedWidth = num(selection?.widthMm);
  const selectedDepth = num(selection?.depthMm);
  const width = rule.usesOwnDimensions ? (selectedWidth && selectedWidth !== num(repairLine.widthMm) ? selectedWidth : num(rule.defaultWidthMm) || selectedWidth || num(repairLine.widthMm)) : num(repairLine.widthMm);
  const depth = rule.usesOwnDimensions ? (selectedDepth && selectedDepth !== num(repairLine.depthMm) ? selectedDepth : num(rule.defaultDepthMm) || selectedDepth || num(repairLine.depthMm)) : num(repairLine.depthMm);
  const area = num(repairLine.areaM2);
  const thickness = num(repairLine.thicknessMm);
  const each = num(repairLine.eachQty);
  const holeVolume = holeVolumeLitres(repairLine);
  const holeInternalArea = holeInternalAreaM2(repairLine);
  const coverage = Math.max(num(material.coveragePerUnit), 0.0001);
  const waste = Math.max(num(material.wasteFactor), 0);
  let requiredUnits = 0;
  let formula = "";
  if (material.calcMethod === "volume_lwd") {
    const baseVolumeLitres = length && width && depth ? (length * width * depth) / 1000 : area && thickness ? area * thickness : holeVolume;
    const required = volumeRequirement(baseVolumeLitres, material) * waste;
    requiredUnits = required / coverage;
    formula = length && width && depth ? `${repairLine.repairTypeCode}: ROUNDUP(((Length*Width*Depth)/1000*Waste)/Coverage per unit,0)` : area && thickness ? `${repairLine.repairTypeCode}: ROUNDUP((Area*Thickness*Waste)/Coverage per unit,0)` : `${repairLine.repairTypeCode}: ROUNDUP((Each*PI*(Hole diameter/2)^2*Hole depth/1000000*Waste)/Coverage per unit,0)`;
  } else if (material.calcMethod === "area_thickness") {
    if (material.id === "fastprime-5") {
      const primedArea = area || holeInternalArea;
      requiredUnits = (((0.14 * primedArea) / 2) * waste) / coverage;
      formula = area
        ? `${repairLine.repairTypeCode}: ROUNDUP((((0.14*Area)/2)*Waste)/Coverage per unit,0)`
        : `${repairLine.repairTypeCode}: ROUNDUP((((0.14*Each*(PI*Diameter*Depth+PI*(Diameter/2)^2)/1000000)/2)*Waste)/Coverage per unit,0)`;
    } else if (material.id === "bondcoat-rbp") {
      const bondArea = area || (length && width ? length * width / 1000 : 0);
      requiredUnits = (bondArea * waste) / coverage;
      formula = area
        ? `${repairLine.repairTypeCode}: ROUNDUP((Area*Waste)/Coverage per unit,0)`
        : `${repairLine.repairTypeCode}: ROUNDUP(((Length*Width/1000)*Waste)/Coverage per unit,0)`;
    } else {
      const density = material.densityKgPerL ?? 1;
      const areaVolumeLitres = area && thickness ? area * thickness : holeVolume;
      const required = material.measuredUnitType === "kg" ? density * areaVolumeLitres : volumeRequirement(areaVolumeLitres, material);
      requiredUnits = (required * waste) / coverage;
      formula = area && thickness
        ? material.measuredUnitType === "kg" ? `${repairLine.repairTypeCode}: ROUNDUP(((Density*Area*Thickness)*Waste)/Coverage per unit,0)` : `${repairLine.repairTypeCode}: ROUNDUP((Area*Thickness*Waste)/Coverage per unit,0)`
        : material.measuredUnitType === "kg" ? `${repairLine.repairTypeCode}: ROUNDUP((Density*Each*PI*(Hole diameter/2)^2*Hole depth/1000000*Waste)/Coverage per unit,0)` : `${repairLine.repairTypeCode}: ROUNDUP((Each*PI*(Hole diameter/2)^2*Hole depth/1000000*Waste)/Coverage per unit,0)`;
    }
  } else if (material.calcMethod === "linear") {
    requiredUnits = (length * waste) / coverage;
    formula = `${repairLine.repairTypeCode}: ROUNDUP((Length*Waste)/Coverage per unit,0)`;
  } else if (material.calcMethod === "each") {
    requiredUnits = (each * waste) / coverage;
    formula = `${repairLine.repairTypeCode}: ROUNDUP((Each*Waste)/Coverage per unit,0)`;
  } else {
    requiredUnits = (num(repairLine.manualMaterialQty) * waste) / coverage;
    formula = `${repairLine.repairTypeCode}: ROUNDUP((Manual quantity*Waste)/Coverage per unit,0)`;
  }
  return { material, requiredUnits: Math.max(0, requiredUnits), formula };
}

function calculateCatalogueMaterial(repairLine: RepairLineItem, material: RepairMaterial, rule: RepairTypeMaterialRule, selection?: RepairLineItem["materialSelections"][number]): MaterialCalc {
  const requirement = calculateCatalogueRequirement(repairLine, material, rule, selection);
  const quantity = Math.ceil(requirement.requiredUnits - 1e-9);
  return { product: `${repairLine.repairTypeCode} - ${material.name}`, quantity, unit: "full units", rate: material.costPerUnit, cost: money(quantity * material.costPerUnit), formula: requirement.formula, unroundedUnits: requirement.requiredUnits };
}

export function calculateRepairLineMaterials(repairLine: RepairLineItem, repairCatalog: RepairCatalog = defaultRepairCatalog): MaterialCalc[] {
  const type = repairTypeByCode(repairLine.repairTypeCode, repairCatalog);
  const selections = new Map(repairLine.materialSelections.map((selection) => [selection.materialId, selection]));
  const selected = new Set(repairLine.materialSelections.filter((selection) => selection.selected).map((selection) => selection.materialId));
  return type.materialRules
    .filter((rule) => rule.role === "required" || selected.has(rule.materialId))
    .map((rule) => ({ rule, material: materialById(rule.materialId, repairCatalog) }))
    .filter((entry): entry is { rule: RepairTypeMaterialRule; material: RepairMaterial } => Boolean(entry.material))
    .map(({ rule, material }) => calculateCatalogueMaterial(repairLine, material, rule, selections.get(material.id)))
    .filter((calc) => calc.quantity > 0 || calc.cost > 0);
}

export function calculateProjectRepairMaterials(repairLines: RepairLineItem[], repairCatalog: RepairCatalog = defaultRepairCatalog): MaterialCalc[] {
  const grouped = new Map<string, { material: RepairMaterial; requiredUnits: number; formulas: string[] }>();
  repairLines.forEach((repairLine) => {
    const type = repairTypeByCode(repairLine.repairTypeCode, repairCatalog);
    const selections = new Map(repairLine.materialSelections.map((selection) => [selection.materialId, selection]));
    const selected = new Set(repairLine.materialSelections.filter((selection) => selection.selected).map((selection) => selection.materialId));
    type.materialRules.filter((rule) => rule.role === "required" || selected.has(rule.materialId)).forEach((rule) => {
      const material = materialById(rule.materialId, repairCatalog);
      if (!material) return;
      const requirement = calculateCatalogueRequirement(repairLine, material, rule, selections.get(material.id));
      const current = grouped.get(material.id) ?? { material, requiredUnits: 0, formulas: [] };
      current.requiredUnits += requirement.requiredUnits;
      current.formulas.push(requirement.formula);
      grouped.set(material.id, current);
    });
  });
  return Array.from(grouped.values()).map(({ material, requiredUnits, formulas }) => {
    const quantity = Math.ceil(requiredUnits - 1e-9);
    return { product: material.name, quantity, unit: "full units", rate: material.costPerUnit, cost: money(quantity * material.costPerUnit), formula: `Project aggregate before rounding: ${formulas.join(" + ")}`, unroundedUnits: requiredUnits };
  }).filter((calc) => calc.quantity > 0 || calc.cost > 0);
}

function grindingLines(input: ProjectInput, rates: AdminRates) {
  if (!input.includeGrinding || !input.grinding.enabled) return [];
  const g = input.grinding;
  const days = grindingDays(input);
  const productionMode = g.productionLabourMode ?? "in_house";
  const surveyorMode = g.surveyorLabourMode ?? "in_house";
  const useProductionInHouse = productionMode === "in_house" || productionMode === "both";
  const useProductionSubcontract = productionMode === "subcontract" || productionMode === "both";
  const useSurveyorInHouse = surveyorMode === "in_house" || surveyorMode === "both";
  const useSurveyorSubcontract = surveyorMode === "subcontract" || surveyorMode === "both";
  const productionDays = num(g.productionLabourDays) > 0 ? num(g.productionLabourDays) : days;
  const surveyorDays = num(g.surveyorDays) > 0 ? num(g.surveyorDays) : days;
  const productionMen = Math.max(0, num(g.productionMen));
  const surveyorCount = Math.max(0, num(g.surveyorCount || g.surveyorsOnSite));
  const productionHotelNightsPerTeam = num(g.productionHotelNights) || calculatedHotelNights(productionDays, g.weekendDaysPerWeek, g.productionTravelMode === "None" ? 0 : g.productionTravelDays);
  const surveyorHotelNightsPerTeam = num(g.surveyorHotelNights) || calculatedHotelNights(surveyorDays, g.weekendDaysPerWeek, g.surveyorTravelMode === "None" ? 0 : g.surveyorTravelDays);
  const productionHotelNights = g.productionHotelRequired ? productionHotelNightsPerTeam * productionMen : 0;
  const surveyorHotelNights = g.surveyorHotelRequired ? surveyorHotelNightsPerTeam * surveyorCount : 0;
  const rows: Line[] = [
    line("Labour", "Surveyor labour", rates.grindingSurveyorDayRate, "surveyor day", useSurveyorInHouse ? surveyorCount * surveyorDays : 0, rateMargin(rates, "grindingSurveyorDayRate", 0), "Grinding surveyor labour"),
    line("Labour", "Surveyor weekend extra", rates.grindingSurveyorWeekendDayRate, "surveyor day", useSurveyorInHouse ? surveyorCount * weekendDaysForProgramme(surveyorDays, 5, g.weekendDaysPerWeek) : 0, rateMargin(rates, "grindingSurveyorWeekendDayRate", rates.defaultMargin), "Grinding surveyor weekend allowance"),
    line("Labour", "Surveyor night-shift allowance", rates.surveyorNightShiftAllowance, "surveyor night", useSurveyorInHouse && g.nightShiftRequired ? surveyorCount * num(g.surveyorNightShifts) : 0, rateMargin(rates, "surveyorNightShiftAllowance", rates.defaultMargin), "Grinding surveyor night shift allowance"),
    line("Hotel", "Surveyor hotel", rates.grindingHotelNightRate, "night", useSurveyorInHouse ? surveyorHotelNights : 0, rateMargin(rates, "grindingHotelNightRate", rates.hotelMargin), "Grinding surveyor hotel nights x surveyors"),
    line("Subsistence", "Surveyor subsistence", rates.subsistence, "day", useSurveyorInHouse ? surveyorHotelNights : 0, rateMargin(rates, "subsistence", rates.subsistenceMargin), "Grinding surveyor subsistence follows hotel nights"),
    line("Labour", "Grinding production labour", rates.productionLabourDayRate, "man day", useProductionInHouse ? productionMen * productionDays : 0, rateMargin(rates, "productionLabourDayRate", rates.defaultMargin), "Grinding production labour"),
    line("Labour", "Grinding production weekend extra", rates.productionWeekendDayRate, "man day", useProductionInHouse ? productionMen * weekendDaysForProgramme(productionDays, 5, g.weekendDaysPerWeek) : 0, rateMargin(rates, "productionWeekendDayRate", rates.defaultMargin), "Grinding production weekend allowance"),
    line("Labour", "Grinding production night-shift allowance", rates.productionNightShiftAllowance, "man night", useProductionInHouse && g.nightShiftRequired ? productionMen * num(g.productionNightShifts) : 0, rateMargin(rates, "productionNightShiftAllowance", rates.defaultMargin), "Grinding production night shift allowance"),
    line("Hotel", "Grinding hotel production", rates.grindingHotelNightRate, "night", useProductionInHouse ? productionHotelNights : 0, rateMargin(rates, "grindingHotelNightRate", rates.hotelMargin), "Grinding production hotel nights x men"),
    line("Subsistence", "Grinding subsistence production", rates.subsistence, "day", useProductionInHouse ? productionHotelNights : 0, rateMargin(rates, "subsistence", rates.subsistenceMargin), "Grinding production subsistence follows hotel nights"),
    line("Reports", "Engineering report", rates.grindingEngineeringReportRate, "item", useSurveyorInHouse && g.engineeringReport ? 1 : 0, rateMargin(rates, "grindingEngineeringReportRate", 0), "Grinding engineering report")
  ];
  rows.push(
    ...internalTravelLines(input, rates, { enabled: useSurveyorInHouse, prefix: "Grinding surveyor", travelItem: "Surveyor travel", mileageItem: "Surveyor mileage", source: "Grinding surveyor", mode: g.surveyorTravelMode, people: surveyorCount, travelDays: g.surveyorTravelDays, travelDayRate: rates.grindingSurveyorTravelDayRate, travelDayMargin: rateMargin(rates, "grindingSurveyorTravelDayRate", 0), primaryOneWay: g.surveyorOneWayKm, secondaryOneWay: g.surveyorSecondaryOneWayKm, vehicles: g.surveyorVehicles, mileageRate: rates.mileagePerKm, mileageMargin: rateMargin(rates, "mileagePerKm", rates.travelMargin), returnFlights: g.surveyorReturnFlights, airportTransport: g.surveyorAirportTransport, airportTransferReturns: g.surveyorAirportTransferReturns, airportParkingDays: g.surveyorAirportParkingDays, destinationTransport: g.surveyorDestinationTransport, rentalVehicles: g.surveyorRentalVehicles, rentalVehicleDays: g.surveyorRentalVehicleDays }),
    ...internalTravelLines(input, rates, { enabled: useProductionInHouse, prefix: "Grinding production", travelItem: "Grinding production travel", mileageItem: "Grinding production mileage", source: "Grinding production", mode: g.productionTravelMode, people: productionMen, travelDays: g.productionTravelDays, travelDayRate: rates.productionLabourTravelDayRate, travelDayMargin: rateMargin(rates, "productionLabourTravelDayRate", rates.travelMargin), primaryOneWay: g.productionOneWayKm, secondaryOneWay: g.productionSecondaryOneWayKm, vehicles: g.productionVehicles, mileageRate: rates.mileagePerKm, mileageMargin: rateMargin(rates, "mileagePerKm", rates.travelMargin), returnFlights: g.productionReturnFlights, airportTransport: g.productionAirportTransport, airportTransferReturns: g.productionAirportTransferReturns, airportParkingDays: g.productionAirportParkingDays, destinationTransport: g.productionDestinationTransport, rentalVehicles: g.productionRentalVehicles, rentalVehicleDays: g.productionRentalVehicleDays })
  );
  if (useSurveyorSubcontract) {
    g.surveyorSubcontractors.forEach((item) => {
      const qty = item.priceType === "day" ? item.days || surveyorDays : item.rate ? 1 : 0;
      rows.push(line("Subcontract", item.name || "Grinding surveyor subcontractor", item.rate, item.priceType, qty, item.margin, "Grinding surveyor subcontract labour"));
      rows.push(line("Subcontract", `${item.name || "Grinding surveyor subcontractor"} mobilisation`, item.mobilisationCost, "mobilisation", item.mobilisations, item.mobilisationMargin, "Grinding surveyor subcontract mobilisation", "Subcontract", "mobilisation"));
    });
  }
  if (useProductionSubcontract) {
    const activeSubcontractors = g.productionSubcontractors.filter((item) => item.rate > 0 || item.mobilisationCost > 0);
    const subcontractors = activeSubcontractors.length ? activeSubcontractors : [{ name: "Grinding subcontractor", priceType: g.subcontractPriceType, rate: g.subcontractRate, days, margin: rates.subcontractMargin, mobilisationCost: g.subcontractMobilisation, mobilisations: g.subcontractMobilisation ? 1 : 0, mobilisationMargin: rates.subcontractMargin }];
    subcontractors.forEach((item) => {
      const qty = item.priceType === "day" ? item.days || days : item.rate ? 1 : 0;
      rows.push(line("Subcontract", item.name || "Grinding subcontractor", item.rate, item.priceType, qty, item.margin, "Grinding subcontract labour incl. standard labour/equipment"));
      rows.push(line("Subcontract", `${item.name || "Grinding subcontractor"} mobilisation`, item.mobilisationCost, "mobilisation", item.mobilisations, item.mobilisationMargin, "Grinding subcontract mobilisation", "Subcontract", "mobilisation"));
    });
  }
  rows.push(
    line("Equipment", "10000 watt generator", rates.grindingSmallGeneratorDayRate, "generator day", useProductionInHouse && g.generatorRequired ? Math.max(0, num(g.generatorCount)) * productionDays : 0, rateMargin(rates, "grindingSmallGeneratorDayRate", rates.equipmentMargin), "Grinding generator quantity x production days"),
    line("Equipment", "Large generator rental", g.largeGeneratorRate, "day", useProductionInHouse && g.largeGeneratorRequired ? productionDays : 0, rates.equipmentMargin, "Grinding production days"),
    line("Equipment", "Large generator delivery", g.largeGeneratorDelivery, "item", useProductionInHouse && g.largeGeneratorRequired ? 1 : 0, rates.equipmentMargin, "Grinding generator delivery", "Equipment", "mobilisation"),
    line("Equipment", "Large generator collection", g.largeGeneratorCollection, "item", useProductionInHouse && g.largeGeneratorRequired ? 1 : 0, rates.equipmentMargin, "Grinding generator collection", "Equipment", "mobilisation"),
    line("Equipment", "Grinders", rates.grindingGrinderDayRate, "grinder day", useProductionInHouse ? productionMen * productionDays : 0, rateMargin(rates, "grindingGrinderDayRate", rates.equipmentMargin), "Grinding production days x men"),
    line("Equipment", "Planers", rates.grindingPlanerDayRate, "planer day", useProductionInHouse && g.gasPlaners ? g.gasPlaners * productionDays : 0, rateMargin(rates, "grindingPlanerDayRate", rates.equipmentMargin), "Grinding production days"),
    line("Equipment", "Vacuums", rates.grindingDustVacuumDayRate, "vacuum day", useProductionInHouse && g.dustVacuums ? g.dustVacuums * productionDays : 0, rateMargin(rates, "grindingDustVacuumDayRate", rates.equipmentMargin), "Grinding production days"),
    line("Equipment", "Extension cords", rates.grindingExtensionCordsDayRate, "day", useProductionInHouse && g.extensionCordsRequired ? productionDays : 0, rateMargin(rates, "grindingExtensionCordsDayRate", rates.equipmentMargin), "Grinding production days"),
    line("Materials", "Grinding segments", rates.grindingSegmentsDayRate, "grinder day", useProductionInHouse && g.grindingSegmentsRequired ? productionMen * productionDays : 0, rateMargin(rates, "grindingSegmentsDayRate", rates.equipmentMargin), "Grinding production days x men"),
    line("Materials", "Grinding consumables", rates.grindingConsumablesDayRate, "grinder day", useProductionInHouse && g.consumablesRequired ? productionMen * productionDays : 0, rateMargin(rates, "grindingConsumablesDayRate", rates.equipmentMargin), "Grinding production days x men"),
    line("Equipment", "Grinding equipment shipping", g.equipmentShipping, "round trip", useProductionInHouse && g.equipmentShipping ? 1 : 0, num(g.equipmentShippingMargin ?? rates.equipmentShippingMargin), "Grinding equipment shipping", "Equipment", "mobilisation")
  );
  if (useProductionInHouse) g.additionalTools.forEach((item) => rows.push(line("Equipment", item.name || "Additional grinding tool", item.rate, "item", item.rate ? 1 : 0, item.margin, "Grinding additional tool", "Equipment")));
  return rows;
}

function screedLines(input: ProjectInput, rates: AdminRates) {
  if (!input.includeScreeding || !input.screeding.enabled) return [];
  const s = input.screeding;
  const days = screedDays(input);
  const productionMode = s.productionLabourMode ?? "subcontract";
  const surveyorMode = s.surveyorLabourMode ?? "in_house";
  const useProductionInHouse = productionMode === "in_house" || productionMode === "both";
  const useProductionSubcontract = productionMode === "subcontract" || productionMode === "both";
  const useSurveyorInHouse = surveyorMode === "in_house" || surveyorMode === "both";
  const useSurveyorSubcontract = surveyorMode === "subcontract" || surveyorMode === "both";
  const productionDays = num(s.productionLabourDays) > 0 ? num(s.productionLabourDays) : days;
  const surveyorDays = num(s.surveyorDays) > 0 ? num(s.surveyorDays) : days;
  const productionMen = Math.max(0, num(s.productionMen));
  const surveyors = Math.max(0, num(s.surveyors));
  const productionHotelNightsPerTeam = num(s.productionHotelNights) || calculatedHotelNights(productionDays, s.weekendDaysPerWeek, s.productionTravelMode === "None" ? 0 : s.productionTravelDays);
  const surveyorHotelNightsPerTeam = num(s.surveyorHotelNights) || calculatedHotelNights(surveyorDays, s.weekendDaysPerWeek, s.surveyorTravelMode === "None" ? 0 : s.surveyorTravelDays);
  const productionHotelNights = s.productionHotelRequired ? productionHotelNightsPerTeam * productionMen : 0;
  const surveyorHotelNights = s.surveyorHotelRequired || s.hotelRequired ? surveyorHotelNightsPerTeam * surveyors : 0;
  const toolDays = useProductionInHouse ? productionDays : 0;
  const grinderCount = Math.max(0, num(s.propaneGrinders));
  const rows: Line[] = [
    line("Labour", "Screed surveyor labour", rates.screedSurveyorDayRate, "surveyor day", useSurveyorInHouse ? surveyors * surveyorDays : 0, rateMargin(rates, "screedSurveyorDayRate", 0), "Screed surveyor labour"),
    line("Labour", "Screed surveyor weekend extra", rates.screedSurveyorWeekendDayRate, "surveyor day", useSurveyorInHouse ? surveyors * weekendDaysForProgramme(surveyorDays, 5, s.weekendDaysPerWeek) : 0, rateMargin(rates, "screedSurveyorWeekendDayRate", rates.defaultMargin), "Screed surveyor weekend allowance"),
    line("Labour", "Screed surveyor night-shift allowance", rates.surveyorNightShiftAllowance, "surveyor night", useSurveyorInHouse && s.nightShiftRequired ? surveyors * num(s.surveyorNightShifts) : 0, rateMargin(rates, "surveyorNightShiftAllowance", rates.defaultMargin), "Screed surveyor night shift allowance"),
    line("Hotel", "Screed surveyor hotel", rates.screedHotelNightRate, "night", useSurveyorInHouse ? surveyorHotelNights : 0, rateMargin(rates, "screedHotelNightRate", rates.hotelMargin), "Screed surveyor hotel nights x surveyors"),
    line("Subsistence", "Screed surveyor subsistence", rates.subsistence, "day", useSurveyorInHouse ? surveyorHotelNights : 0, rateMargin(rates, "subsistence", rates.subsistenceMargin), "Screed surveyor subsistence follows hotel nights"),
    line("Reports", "Screed engineering report", rates.screedEngineeringReportRate, "item", useSurveyorInHouse && s.engineeringReport ? 1 : 0, rateMargin(rates, "screedEngineeringReportRate", 0), "Screed engineering report"),
    line("Labour", "Screed production labour", rates.productionLabourDayRate, "man day", useProductionInHouse ? productionMen * productionDays : 0, rateMargin(rates, "productionLabourDayRate", rates.defaultMargin), "Screed production labour"),
    line("Labour", "Screed production weekend extra", rates.productionWeekendDayRate, "man day", useProductionInHouse ? productionMen * weekendDaysForProgramme(productionDays, 5, s.weekendDaysPerWeek) : 0, rateMargin(rates, "productionWeekendDayRate", rates.defaultMargin), "Screed production weekend allowance"),
    line("Labour", "Screed production night-shift allowance", rates.productionNightShiftAllowance, "man night", useProductionInHouse && s.nightShiftRequired ? productionMen * num(s.productionNightShifts) : 0, rateMargin(rates, "productionNightShiftAllowance", rates.defaultMargin), "Screed production night shift allowance"),
    line("Hotel", "Screed production hotel", rates.screedHotelNightRate, "night", useProductionInHouse ? productionHotelNights : 0, rateMargin(rates, "screedHotelNightRate", rates.hotelMargin), "Screed production hotel nights x men"),
    line("Subsistence", "Screed production subsistence", rates.subsistence, "day", useProductionInHouse ? productionHotelNights : 0, rateMargin(rates, "subsistence", rates.subsistenceMargin), "Screed production subsistence follows hotel nights")
  ];
  rows.push(
    ...internalTravelLines(input, rates, { enabled: useSurveyorInHouse, prefix: "Screed surveyor", travelItem: "Screed surveyor travel", mileageItem: "Screed surveyor mileage", source: "Screed surveyor", mode: s.surveyorTravelMode, people: surveyors, travelDays: s.surveyorTravelDays, travelDayRate: rates.screedSurveyorTravelDayRate, travelDayMargin: rateMargin(rates, "screedSurveyorTravelDayRate", 0), primaryOneWay: s.surveyorOneWayKm, secondaryOneWay: s.surveyorSecondaryOneWayKm, vehicles: s.surveyorVehicles, mileageRate: rates.mileagePerKm, mileageMargin: rateMargin(rates, "mileagePerKm", rates.travelMargin), returnFlights: s.surveyorReturnFlights, airportTransport: s.surveyorAirportTransport, airportTransferReturns: s.surveyorAirportTransferReturns, airportParkingDays: s.surveyorAirportParkingDays, destinationTransport: s.surveyorDestinationTransport, rentalVehicles: s.surveyorRentalVehicles, rentalVehicleDays: s.surveyorRentalVehicleDays }),
    ...internalTravelLines(input, rates, { enabled: useProductionInHouse, prefix: "Screed production", travelItem: "Screed production travel", mileageItem: "Screed production mileage", source: "Screed production", mode: s.productionTravelMode, people: productionMen, travelDays: s.productionTravelDays, travelDayRate: rates.productionLabourTravelDayRate, travelDayMargin: rateMargin(rates, "productionLabourTravelDayRate", rates.travelMargin), primaryOneWay: s.productionOneWayKm, secondaryOneWay: s.productionSecondaryOneWayKm, vehicles: s.productionVehicles, mileageRate: rates.mileagePerKm, mileageMargin: rateMargin(rates, "mileagePerKm", rates.travelMargin), returnFlights: s.productionReturnFlights, airportTransport: s.productionAirportTransport, airportTransferReturns: s.productionAirportTransferReturns, airportParkingDays: s.productionAirportParkingDays, destinationTransport: s.productionDestinationTransport, rentalVehicles: s.productionRentalVehicles, rentalVehicleDays: s.productionRentalVehicleDays })
  );
  if (useSurveyorSubcontract) {
    s.surveyorSubcontractors.forEach((item) => {
      const qty = item.priceType === "day" ? item.days || surveyorDays : item.rate ? 1 : 0;
      rows.push(line("Subcontract", item.name || "Screed surveyor subcontractor", item.rate, item.priceType, qty, item.margin, "Screed surveyor subcontract labour"));
      rows.push(line("Subcontract", `${item.name || "Screed surveyor subcontractor"} mobilisation`, item.mobilisationCost, "mobilisation", item.mobilisations, item.mobilisationMargin, "Screed surveyor subcontract mobilisation", "Subcontract", "mobilisation"));
    });
  }
  if (useProductionSubcontract) {
    s.teams.forEach((team, index) => {
      const preparationDays = team.prep ? num(team.preparationDays) || num(s.preparationDays) : 0;
      const screedingDays = team.screed ? num(team.screedingDays) || num(s.screedingDays) : 0;
      const grindingDays = team.grind ? num(team.grindingDays) || num(s.grindingDays) : 0;
      const activityDays = preparationDays + screedingDays + grindingDays;
      const scope = [team.prep && "preparation", team.screed && "screeding", team.grind && "grinding"].filter(Boolean).join(", ");
      const label = `Screed subcontractor ${index + 1}${team.contractorName ? ` - ${team.contractorName}` : ""}`;
      rows.push(line("Subcontract", `${label} mobilisation`, team.mobilisation, "mobilisation", team.mobilisation ? 1 : 0, num(team.mobilisationMargin ?? rates.subcontractMargin), `Screed subcontract mobilisation${scope ? ` (${scope})` : ""}`, "Subcontract", "mobilisation"));
      rows.push(line("Subcontract", `${label} price on site`, team.rate, team.priceType, team.priceType === "day" ? activityDays : team.rate ? 1 : 0, num(team.margin ?? rates.subcontractMargin), `Screed subcontract rate${scope ? ` (${scope})` : ""}`));
    });
  }
  rows.push(
    line("Materials", "Screed material", s.screedMaterialRate, "bags", screedMaterialUnits(s.screedMaterialBags, s.screedMaterialContingency, s.screedMaterialWaste), s.screedMaterialMargin, "Screed material base quantity plus contingency and waste"),
    line("Materials", "Primer", s.primerRate, "units", screedMaterialUnits(s.primerUnits, s.primerContingency, s.primerWaste), s.primerMargin, "Screed primer base quantity plus contingency and waste"),
    line("Materials", "Sand", s.sandRate, "bags", screedMaterialUnits(s.sandBags, s.sandContingency, s.sandWaste), s.sandMargin, "Screed sand base quantity plus contingency and waste"),
    line("Materials", "Shipping of materials", s.materialShipping, "return", s.materialShipping ? 1 : 0, num(s.materialShippingMargin ?? rates.materialShippingMargin), "Screed material shipping"),
    line("Equipment", "Screed generator", rates.screedSmallGeneratorDayRate, "day", useProductionInHouse ? s.generatorDays : 0, rateMargin(rates, "screedSmallGeneratorDayRate", rates.equipmentMargin), "Screed generator"),
    line("Equipment", "Screed large generator rental", s.largeGeneratorRate, "day", useProductionInHouse && s.largeGeneratorRequired ? Math.ceil(productionDays) : 0, rates.equipmentMargin, "Screed large generator"),
    line("Equipment", "Screed large generator delivery", s.largeGeneratorDelivery, "item", useProductionInHouse && s.largeGeneratorRequired ? 1 : 0, rates.equipmentMargin, "Screed large generator delivery", "Equipment", "mobilisation"),
    line("Equipment", "Screed large generator collection", s.largeGeneratorCollection, "item", useProductionInHouse && s.largeGeneratorRequired ? 1 : 0, rates.equipmentMargin, "Screed large generator collection", "Equipment", "mobilisation"),
    line("Equipment", "Screed grinders", rates.screedDiamondGrinderPropaneDayRate, "grinder day", useProductionInHouse ? grinderCount * toolDays : 0, rateMargin(rates, "screedDiamondGrinderPropaneDayRate", rates.equipmentMargin), "Screed grinders"),
    line("Equipment", "Screed planers", rates.screedGasPlanerDayRate, "planer day", useProductionInHouse ? s.gasPlaners * toolDays : 0, rateMargin(rates, "screedGasPlanerDayRate", rates.equipmentMargin), "Screed planers"),
    line("Equipment", "Screed vacuums", rates.screedDustVacuumDayRate, "vacuum day", useProductionInHouse ? s.dustVacuums * toolDays : 0, rateMargin(rates, "screedDustVacuumDayRate", rates.equipmentMargin), "Screed vacuums"),
    line("Equipment", "Screed extension cords", rates.screedExtensionCordSetDayRate, "set day", useProductionInHouse ? s.extensionCordSets * toolDays : 0, rateMargin(rates, "screedExtensionCordSetDayRate", rates.equipmentMargin), "Screed extension cords"),
    line("Materials", "Screed grinding segments", rates.screedGrindingSegmentsDayRate, "grinder day", useProductionInHouse && s.grindingSegmentsRequired ? grinderCount * toolDays : 0, rateMargin(rates, "screedGrindingSegmentsDayRate", rates.equipmentMargin), "Screed grinding segments"),
    line("Materials", "Screed consumables", rates.screedConsumablesDayRate, "grinder day", useProductionInHouse && s.consumablesRequired ? Math.max(1, grinderCount) * toolDays : 0, rateMargin(rates, "screedConsumablesDayRate", rates.equipmentMargin), "Screed consumables"),
    line("Equipment", "Screed equipment shipping", s.equipmentShipping, "round trip", useProductionInHouse && s.equipmentShipping ? 1 : 0, num(s.equipmentShippingMargin ?? rates.equipmentShippingMargin), "Screed equipment shipping", "Equipment", "mobilisation")
  );
  return rows;
}

function repairLines(input: ProjectInput, rates: AdminRates, materialCalcs: MaterialCalc[], repairCatalog: RepairCatalog = defaultRepairCatalog) {
  if (!input.includeRepairs || !input.repairs.enabled) return [];
  const r = input.repairs;
  const calculatedDays = repairDays(input, repairCatalog);
  const mode = r.labourMode ?? "subcontract";
  const useSubcontract = mode === "subcontract" || mode === "both";
  const useInHouse = mode === "in_house" || mode === "both";
  const inHouseMen = Math.max(0, r.labourMen);
  const inHouseDays = useInHouse ? calculatedDays : 0;
  const hotelNightsPerTeam = num(r.hotelNights) || calculatedHotelNights(inHouseDays, r.weekendRequired ? r.weekendDays : 0, r.travelMode === "None" ? 0 : r.travelDays);
  const hotelRoomNights = r.hotelRequired ? hotelNightsPerTeam * inHouseMen : 0;
  const rows = [
    line("Labour", "In-house repair production labour", rates.productionLabourDayRate, "man day", inHouseMen * inHouseDays, rateMargin(rates, "productionLabourDayRate", rates.defaultMargin), "Repair labour mode + repair type output rates"),
    line("Labour", "Repair weekend extra", rates.productionWeekendDayRate, "man day", useInHouse && r.weekendRequired ? inHouseMen * weekendDaysForProgramme(inHouseDays, 5, r.weekendDays) : 0, rateMargin(rates, "productionWeekendDayRate", rates.defaultMargin), "In-house repair weekend allowance per man per weekend day"),
    line("Labour", "Repair night-shift allowance", rates.productionNightShiftAllowance, "man night", useInHouse && r.nightShiftRequired ? inHouseMen * r.nightShiftHours : 0, rateMargin(rates, "productionNightShiftAllowance", rates.defaultMargin), "In-house repair night shift allowance per man per night"),
    line("Hotel", "Repair hotel", rates.hotel, "room night", useInHouse ? hotelRoomNights : 0, rateMargin(rates, "hotel", rates.hotelMargin), "Hotel nights per team x in-house men"),
    line("Subsistence", "Repair subsistence", rates.subsistence, "day", useInHouse ? hotelRoomNights : 0, rateMargin(rates, "subsistence", rates.subsistenceMargin), "Follows hotel nights: nights per team x in-house men"),
  ];
  rows.push(...internalTravelLines(input, rates, { enabled: useInHouse, prefix: "Repair production", travelItem: "Repair production travel", mileageItem: "Repair fuel", source: "In-house repair", mode: r.travelMode, people: inHouseMen, travelDays: r.travelDays, travelDayRate: rates.productionLabourTravelDayRate, travelDayMargin: rateMargin(rates, "productionLabourTravelDayRate", rates.travelMargin), primaryOneWay: r.mobilisationOneWayKm, secondaryOneWay: r.mobilisationSecondaryOneWayKm, vehicles: r.mobilisationVehicles, mileageRate: rates.repairFuelPerKm, mileageMargin: rateMargin(rates, "repairFuelPerKm", rates.travelMargin), returnFlights: r.returnFlights, airportTransport: r.airportTransport, airportTransferReturns: r.airportTransferReturns, airportParkingDays: r.airportParkingDays, destinationTransport: r.destinationTransport, rentalVehicles: r.rentalVehicles, rentalVehicleDays: r.rentalVehicleDays }));
  if (useSubcontract) {
    r.repairSubcontractors.forEach((item) => {
      const labourQty = item.priceType === "day" ? item.days : item.rate ? 1 : 0;
      rows.push(line("Subcontract", item.name || "Repair subcontractor", item.rate, item.priceType, labourQty, item.margin, "Repair subcontract labour incl. standard labour/equipment"));
      rows.push(line("Subcontract", `${item.name || "Repair subcontractor"} mobilisation`, item.mobilisationCost, "mobilisation", item.mobilisations, item.mobilisationMargin, "Repair subcontract mobilisation", "Subcontract", "mobilisation"));
    });
  }
  materialCalcs.forEach((calc) => rows.push(line("Materials", calc.product, calc.rate, calc.unit, calc.quantity, rates.materialMargin, calc.formula)));
  r.haulageItems.forEach((item) => rows.push(line("Haulage", item.name, item.rate, item.unit, item.quantity, item.margin, "Repair haulage input")));
  return rows;
}

function projectManagementLines(input: ProjectInput, rates: AdminRates) {
  const pm = input.projectManagement;
  if (!pm.enabled) return [];
  const visits = Math.max(0, num(pm.visits));
  const rows = [
    line("Labour", "Project manager", rates.projectManagerDayRate, "day", num(pm.days), rateMargin(rates, "projectManagerDayRate", rates.defaultMargin), "Whole-project management"),
    line("Hotel", "Project manager hotel", rates.hotel, "night", num(pm.hotelNights), rateMargin(rates, "hotel", rates.hotelMargin), "Whole-project management hotel"),
    line("Subsistence", "Project manager subsistence", rates.subsistence, "day", num(pm.hotelNights), rateMargin(rates, "subsistence", rates.subsistenceMargin), "Subsistence follows PM hotel nights")
  ];
  rows.push(...internalTravelLines(input, rates, { enabled: true, prefix: "Project manager", travelItem: "Project manager travel days", mileageItem: "Project manager mileage", source: "Whole-project management", mode: pm.travelMode, people: 1, travelDays: pm.travelDays, travelDayRate: rates.otherInternalTravelDayRate, travelDayMargin: rateMargin(rates, "otherInternalTravelDayRate", rates.travelMargin), primaryOneWay: pm.oneWayKm, secondaryOneWay: pm.secondaryOneWayKm, vehicles: pm.vehicles, journeys: visits, mileageRate: rates.mileagePerKm, mileageMargin: rateMargin(rates, "mileagePerKm", rates.travelMargin), returnFlights: pm.returnFlights, airportTransport: pm.airportTransport, airportTransferReturns: pm.airportTransferReturns, airportParkingDays: pm.airportParkingDays, destinationTransport: pm.destinationTransport, rentalVehicles: pm.rentalVehicles, rentalVehicleDays: pm.rentalVehicleDays, costKind: "operating" }));
  return rows;
}

function calculateCombinedProject(input: ProjectInput, rates: AdminRates, repairCatalog: RepairCatalog = defaultRepairCatalog): ProjectCalculations {
  const companyExchange = num(input.exchangeRateToCompanyCurrency) > 0 ? num(input.exchangeRateToCompanyCurrency) : 1;
  const groupExchange = num(input.exchangeRateToGroupCurrency) > 0 ? num(input.exchangeRateToGroupCurrency) : 1;
  const quoteRates = ratesInQuoteCurrency(rates, companyExchange);
  const fxDivisor = companyExchange;
  const quoteCatalog: RepairCatalog = { ...repairCatalog, materials: repairCatalog.materials.map((material) => ({ ...material, costPerUnit: money(material.costPerUnit / fxDivisor) })) };
  const gDays = grindingDays(input);
  const sDays = screedDays(input);
  const rDays = repairDays(input, quoteCatalog);
  const phaseSchedule = calculatePhaseSchedule(input, quoteCatalog);
  const siteDays = phaseSchedule.projectDays;
  const repairMaterialCalcs = input.includeRepairs && input.repairs.enabled ? calculateProjectRepairMaterials(input.repairs.repairLines, quoteCatalog) : [];
  const serviceLines = [
    ...grindingLines(input, quoteRates),
    ...screedLines(input, quoteRates),
    ...repairLines(input, quoteRates, repairMaterialCalcs, quoteCatalog),
    ...projectManagementLines(input, quoteRates)
  ];
  input.additionalItems.forEach((item) => serviceLines.push(line("Additional items", item.name, item.rate, item.unit, item.quantity, item.margin, "Additional item", item.plCategory ?? "Equipment")));
  const originalProposalTotal = money(serviceLines.reduce((sum, row) => sum + row.total, 0));
  const discountAmount = money(originalProposalTotal * Math.min(Math.max(input.discountPercentage, 0), 100) / 100);
  let allocatedDiscount = 0;
  const discountableRows = serviceLines.filter((row) => row.originalTotal !== 0);
  const finalDiscountableRow = discountableRows[discountableRows.length - 1];
  const proposalLines = serviceLines.map((row) => {
    const discount = row === finalDiscountableRow
      ? money(discountAmount - allocatedDiscount)
      : originalProposalTotal ? money(discountAmount * (row.originalTotal / originalProposalTotal)) : 0;
    allocatedDiscount = money(allocatedDiscount + discount);
    return { ...row, discount, total: money(row.originalTotal - discount) };
  });
  const proposalTotal = money(proposalLines.reduce((sum, row) => sum + row.total, 0));
  const baseBudgetLines = serviceLines.map((row) => ({ ...row, margin: 0, discount: 0, total: row.cost, originalTotal: row.cost }));
  const bdmBonusBudget = input.bdmBonusRequired ? money(proposalTotal * Math.max(0, num(rates.bdmBonusRate))) : 0;
  const budgetLines = bdmBonusBudget ? [...baseBudgetLines, { ...line("Labour", "BDM bonus", bdmBonusBudget, "item", 1, 0, "Optional BDM bonus", "Labour"), total: bdmBonusBudget, originalTotal: bdmBonusBudget }] : baseBudgetLines;
  const budgetCost = money(budgetLines.reduce((sum, row) => sum + row.total, 0));
  const budgetProfit = money(proposalTotal - budgetCost);
  const budgetMargin = proposalTotal ? pct(budgetProfit / proposalTotal) : 0;
  const budgetMarkup = budgetCost ? pct(budgetProfit / budgetCost) : 0;
  const services = [input.includeGrinding && input.grinding.enabled && "Grinding", input.includeScreeding && input.screeding.enabled && "Screeding", input.includeRepairs && input.repairs.enabled && "Repairs"].filter(Boolean).join(" + ") || "Draft";
  const dailyRate = money(proposalLines.filter(isOperatingLine).reduce((sum, row) => sum + row.total, 0) / Math.max(1, siteDays));
  const travelTotal = money(proposalLines.filter((row) => row.plCategory === "Travel").reduce((sum, row) => sum + row.total, 0));
  const haulageTotal = money(proposalLines.filter((row) => row.plCategory === "Haulage").reduce((sum, row) => sum + row.total, 0));
  const mobilisationRate = money(proposalLines.filter(isMobilisationLine).reduce((sum, row) => sum + row.total, 0));
  const mobilisationBudget = money(budgetLines.filter(isMobilisationLine).reduce((sum, row) => sum + row.total, 0));
  return {
    projectReference: input.projectReference,
    client: input.client,
    location: input.location,
    serviceSummary: services,
    grindingDays: gDays,
    screedDays: sDays,
    repairDays: rDays,
    siteDays,
    phaseRows: phaseSchedule.rows,
    proposalLines,
    budgetLines,
    repairMaterialCalcs,
    originalProposalTotal,
    discountAmount,
    proposalTotal,
    budgetCost,
    budgetProfit,
    budgetMargin,
    budgetMarkup,
    bdmBonusBudget,
    bdmBonusRate: Math.max(0, num(rates.bdmBonusRate)),
    proposalCompanyCurrency: money(proposalTotal * companyExchange),
    budgetCompanyCurrency: money(budgetCost * companyExchange),
    proposalGroupCurrency: money(proposalTotal * groupExchange),
    budgetGroupCurrency: money(budgetCost * groupExchange),
    dailyRate,
    mobilisationRate,
    mobilisationBudget,
    travelTotal,
    haulageTotal,
    standbyRate: 0
  };
}

function tagged(lines: Line[], workPackage: RemedialWorkPackage): Line[] {
  return lines.map((row) => ({
    ...row,
    workPackageId: workPackage.id,
    workPackageCode: workPackage.code,
    workPackageName: workPackage.name,
    commercialGroup: "package" as const
  }));
}

function commonTagged(lines: Line[]): Line[] {
  return lines.map((row) => ({ ...row, commercialGroup: "common" as const }));
}

function total(lines: Line[], key: "total" | "originalTotal" | "cost" = "total") {
  return money(lines.reduce((sum, row) => sum + num(row[key]), 0));
}

function discountedLine(row: Line, discountPercentage: number): Line {
  const discount = money(row.originalTotal * Math.min(100, Math.max(0, discountPercentage)) / 100);
  return { ...row, discount, total: money(row.originalTotal - discount) };
}

function budgetVersion(row: Line): Line {
  return { ...row, margin: 0, discount: 0, total: row.cost, originalTotal: row.cost };
}

function rateAdjustment(item: string, amount: number, source: string, costKind: Line["costKind"] = "operating"): Line {
  const value = money(amount);
  return { section: "Labour", item, rate: value, unit: "adjustment", quantity: value ? 1 : 0, cost: 0, margin: value, total: value, discount: 0, originalTotal: value, source, plCategory: "Labour", costKind };
}

function inferredCostKind(row: Line): NonNullable<Line["costKind"]> {
  if (row.costKind) return row.costKind;

  const description = `${row.item} ${row.source}`.toLowerCase();
  if (/stand[ -]?down|standby/.test(description)) return "stand_down";
  if (/project manager|whole-project management/.test(description)) return "operating";
  if (/mobilisation|mobilization|demobilisation|demobilization/.test(description)) return "mobilisation";
  if (row.plCategory === "Equipment" && /shipping|delivery|collection/.test(description)) return "mobilisation";
  if (row.plCategory === "Travel" && /grinding|screed|repair/.test(description)) return "mobilisation";
  return "operating";
}

function withInferredCostKind(row: Line): Line {
  return row.costKind ? row : { ...row, costKind: inferredCostKind(row) };
}

function isMobilisationLine(row: Line) {
  return inferredCostKind(row) === "mobilisation";
}

function isOperatingLine(row: Line) {
  return inferredCostKind(row) === "operating"
    && row.section !== "Haulage"
    && row.section !== "Reports"
    && row.section !== "Additional items";
}

export function normaliseStoredCalculations(calculations: ProjectCalculations): ProjectCalculations {
  const proposalLines = (calculations.proposalLines ?? []).map(withInferredCostKind);
  const budgetLines = (calculations.budgetLines ?? []).map(withInferredCostKind);
  return {
    ...calculations,
    proposalLines,
    budgetLines,
    mobilisationRate: total(proposalLines.filter(isMobilisationLine)),
    mobilisationBudget: total(budgetLines.filter(isMobilisationLine))
  };
}

type StandbyResult = { proposalLines: Line[]; budgetLines: Line[]; budgetRate: number; proposalRate: number };

function grindingStandby(workPackage: RemedialWorkPackage, rates: AdminRates, expectedDays: number): StandbyResult {
  const g = workPackage.grinding;
  if (!g) return { proposalLines: [], budgetLines: [], budgetRate: 0, proposalRate: 0 };
  const rows: Line[] = [];
  let budgetRate = 0;
  let proposalRate = 0;
  const add = (section: Section, item: string, budget: number, quantityPerDay: number, markup: number, plCategory: PLCategory = sectionPLCategory(section)) => {
    const rate = Math.max(0, num(budget));
    const quantity = Math.max(0, num(quantityPerDay));
    if (!rate || !quantity) return;
    budgetRate += rate * quantity;
    proposalRate += rate * quantity * (1 + Math.max(0, num(markup)));
    rows.push(line(section, item, rate, "stand-down day", quantity * expectedDays, markup, "Grinding stand-down schedule", plCategory, "stand_down"));
  };
  const productionInHouse = g.productionLabourMode === "in_house" || g.productionLabourMode === "both";
  const productionSubcontract = g.productionLabourMode === "subcontract" || g.productionLabourMode === "both";
  const surveyorInHouse = g.surveyorLabourMode === "in_house" || g.surveyorLabourMode === "both";
  const surveyorSubcontract = g.surveyorLabourMode === "subcontract" || g.surveyorLabourMode === "both";
  const productionPeople = productionInHouse ? Math.max(0, num(g.productionMen)) : 0;
  const surveyorPeople = surveyorInHouse ? Math.max(0, num(g.surveyorCount)) : 0;

  add("Labour", "Grinding production stand-down", rates.grindingStandbyProductionDayRate, productionPeople, rateMargin(rates, "grindingStandbyProductionDayRate", rates.defaultMargin), "Labour");
  add("Labour", "Grinding surveyor stand-down", rates.grindingStandbySurveyorDayRate, surveyorPeople, rateMargin(rates, "grindingStandbySurveyorDayRate", rates.defaultMargin), "Labour");
  if (g.productionHotelRequired) {
    add("Hotel", "Grinding production stand-down hotel", rates.grindingHotelNightRate, productionPeople, rateMargin(rates, "grindingHotelNightRate", rates.hotelMargin), "Hotel/Subsistence");
    add("Subsistence", "Grinding production stand-down subsistence", rates.grindingStandbySubsistenceDayRate, productionPeople, rateMargin(rates, "grindingStandbySubsistenceDayRate", rates.subsistenceMargin), "Hotel/Subsistence");
  }
  if (g.surveyorHotelRequired) {
    add("Hotel", "Grinding surveyor stand-down hotel", rates.grindingHotelNightRate, surveyorPeople, rateMargin(rates, "grindingHotelNightRate", rates.hotelMargin), "Hotel/Subsistence");
    add("Subsistence", "Grinding surveyor stand-down subsistence", rates.grindingStandbySubsistenceDayRate, surveyorPeople, rateMargin(rates, "grindingStandbySubsistenceDayRate", rates.subsistenceMargin), "Hotel/Subsistence");
  }
  const addTransport = (prefix: string, active: boolean, mode: TravelMode, vehicles: number, destination: DestinationTransport, rentalVehicles: number) => {
    if (!active) return;
    if (mode === "Drive") add("Travel", `${prefix} stand-down company vehicle`, rates.companyCar, vehicles, rateMargin(rates, "companyCar", rates.travelMargin), "Travel");
    if (mode === "Fly" && destination !== "None") {
      const key: keyof AdminRates = destination === "Rental Van" ? "rentalVan" : "rentalCar";
      add("Travel", `${prefix} stand-down ${destination.toLowerCase()}`, rates[key] as number, rentalVehicles, rateMargin(rates, key, rates.travelMargin), "Travel");
    }
  };
  addTransport("Grinding production", productionInHouse, g.productionTravelMode, g.productionVehicles, g.productionDestinationTransport, g.productionRentalVehicles);
  addTransport("Grinding surveyor", surveyorInHouse, g.surveyorTravelMode, g.surveyorVehicles, g.surveyorDestinationTransport, g.surveyorRentalVehicles);
  if (productionSubcontract) g.productionSubcontractors.forEach((item) => add("Subcontract", `${item.name || "Grinding subcontractor"} stand-down`, num(item.standbyRate), 1, num(item.standbyMargin ?? item.margin), "Subcontract"));
  if (surveyorSubcontract) g.surveyorSubcontractors.forEach((item) => add("Subcontract", `${item.name || "Grinding surveyor subcontractor"} stand-down`, num(item.standbyRate), 1, num(item.standbyMargin ?? item.margin), "Subcontract"));
  return { proposalLines: rows, budgetLines: rows.map(budgetVersion), budgetRate: money(budgetRate), proposalRate: money(proposalRate) };
}

type PackageCalculation = {
  workPackage: RemedialWorkPackage;
  calculation: ProjectCalculations;
  proposalLines: Line[];
  budgetLines: Line[];
  summary: WorkPackageCalculationSummary;
  rateSchedule?: CommercialRateSchedule;
};

function calculateWorkPackage(parent: ProjectInput, workPackage: RemedialWorkPackage, rates: AdminRates, repairCatalog: RepairCatalog): PackageCalculation {
  const packageInput = packageProjectInput(parent, workPackage);
  const calculation = calculateCombinedProject(packageInput, rates, repairCatalog);
  const keepLine = (row: Line) => workPackage.mobilisationMode === "separate"
    || !(row.costKind === "mobilisation" && row.plCategory === "Travel");
  let proposalLines = tagged(calculation.proposalLines.filter(keepLine), workPackage);
  let budgetLines = tagged(calculation.budgetLines.filter(keepLine), workPackage);
  let rateSchedule: CommercialRateSchedule | undefined;

  if (workPackage.pricingBasis === "day_rate" && workPackage.service === "Grinding") {
    const days = Math.max(0, calculation.siteDays);
    const operatingProposal = proposalLines.filter(isOperatingLine);
    const operatingBudget = budgetLines.filter(isOperatingLine);
    const calculatedProductiveProposalRate = days ? total(operatingProposal) / days : 0;
    const productiveBudgetRate = days ? total(operatingBudget) / days : 0;
    const productiveProposalRate = workPackage.productiveRateOverride ?? calculatedProductiveProposalRate;
    const productiveAdjustment = days ? money(productiveProposalRate * days - total(operatingProposal)) : 0;
    if (productiveAdjustment) proposalLines.push(...tagged([rateAdjustment("Productive day rate adjustment", productiveAdjustment, `${workPackage.code} day-rate override`)], workPackage));

    const quoteRates = ratesInQuoteCurrency(rates, num(parent.exchangeRateToCompanyCurrency) || 1);
    const rawStandby = grindingStandby(workPackage, quoteRates, workPackage.expectedStandDownDays);
    const discount = workPackage.discountPercentage ?? parent.discountPercentage;
    const standbyProposalLines = rawStandby.proposalLines.map((row) => discountedLine(row, discount));
    const discountedStandbyRate = rawStandby.proposalRate * (1 - Math.min(100, Math.max(0, discount)) / 100);
    const standbyProposalRate = workPackage.standbyRateOverride ?? discountedStandbyRate;
    const standbyAdjustment = workPackage.expectedStandDownDays
      ? money(standbyProposalRate * workPackage.expectedStandDownDays - total(standbyProposalLines))
      : 0;
    proposalLines.push(...tagged(standbyProposalLines, workPackage));
    budgetLines.push(...tagged(rawStandby.budgetLines, workPackage));
    if (standbyAdjustment) proposalLines.push(...tagged([rateAdjustment("Stand-down day rate adjustment", standbyAdjustment, `${workPackage.code} stand-down override`, "stand_down")], workPackage));

    const mobilisationProposal = total(proposalLines.filter(isMobilisationLine));
    const mobilisationBudget = total(budgetLines.filter(isMobilisationLine));
    rateSchedule = {
      workPackageId: workPackage.id,
      workPackageCode: workPackage.code,
      workPackageName: workPackage.name,
      service: workPackage.service,
      pricingBasis: workPackage.pricingBasis,
      estimatedDays: days,
      productiveBudgetRate: money(productiveBudgetRate),
      productiveProposalRate: money(productiveProposalRate),
      productiveRateOverridden: workPackage.productiveRateOverride !== null,
      mobilisationBudget,
      mobilisationProposal,
      standbyBudgetRate: rawStandby.budgetRate,
      standbyProposalRate: money(standbyProposalRate),
      standbyRateOverridden: workPackage.standbyRateOverride !== null,
      expectedStandDownDays: workPackage.expectedStandDownDays,
      overrideReason: workPackage.rateOverrideReason
    };
  }

  const packageProposal = total(proposalLines);
  const packageBudget = total(budgetLines);
  const packageProfit = packageProposal - packageBudget;
  const summary: WorkPackageCalculationSummary = {
    id: workPackage.id,
    code: workPackage.code,
    name: workPackage.name,
    service: workPackage.service,
    selected: workPackage.selected,
    pricingBasis: workPackage.pricingBasis,
    mobilisationMode: workPackage.mobilisationMode,
    days: calculation.siteDays,
    startDay: workPackage.startDay,
    proposalTotal: packageProposal,
    budgetCost: packageBudget,
    budgetMarkup: packageBudget ? pct(packageProfit / packageBudget) : 0,
    materialTypes: calculation.repairMaterialCalcs.length
  };
  return { workPackage, calculation, proposalLines, budgetLines, summary, rateSchedule };
}

function selectedRepairMaterialBudget(input: ProjectInput, activePackages: PackageCalculation[], repairCatalog: RepairCatalog) {
  const repairLines = activePackages.flatMap(({ workPackage }) => workPackage.service === "Repairs" ? workPackage.repairs?.repairLines ?? [] : []);
  if (!repairLines.length) return { calculations: [] as MaterialCalc[], lines: [] as Line[] };
  const companyExchange = num(input.exchangeRateToCompanyCurrency) > 0 ? num(input.exchangeRateToCompanyCurrency) : 1;
  const quoteCatalog: RepairCatalog = { ...repairCatalog, materials: repairCatalog.materials.map((material) => ({ ...material, costPerUnit: money(material.costPerUnit / companyExchange) })) };
  const calculations = calculateProjectRepairMaterials(repairLines, quoteCatalog);
  const lines = calculations.map((calc) => ({ ...budgetVersion(line("Materials", calc.product, calc.rate, calc.unit, calc.quantity, 0, `Consolidated selected-package procurement: ${calc.formula}`, "Materials")), commercialGroup: "package" as const }));
  return { calculations, lines };
}

function calculateSelectableProject(input: ProjectInput, rates: AdminRates, repairCatalog: RepairCatalog): ProjectCalculations {
  const packages = input.workPackages.map((workPackage) => calculateWorkPackage(input, workPackage, rates, repairCatalog));
  const commonInput: ProjectInput = {
    ...input,
    pricingMode: "combined",
    selectionConfirmed: false,
    workPackages: [],
    sharedCosts: [],
    includeGrinding: false,
    includeScreeding: false,
    includeRepairs: false,
    grinding: { ...input.grinding, enabled: false },
    screeding: { ...input.screeding, enabled: false },
    repairs: { ...input.repairs, enabled: false },
    bdmBonusRequired: false
  };
  const commonCalculation = calculateCombinedProject(commonInput, rates, repairCatalog);
  const commonProposalLines = commonTagged([...commonCalculation.proposalLines]);
  const commonBudgetLines = commonTagged([...commonCalculation.budgetLines]);
  input.sharedCosts.forEach((item) => {
    const proposal = discountedLine(line("Additional items", item.name || "Shared project cost", item.rate, item.unit, item.quantity, item.margin, "Shared project cost", item.plCategory ?? "Travel"), input.discountPercentage);
    commonProposalLines.push(...commonTagged([proposal]));
    commonBudgetLines.push(...commonTagged([budgetVersion(proposal)]));
  });

  const offeredProposalLines = [...commonProposalLines, ...packages.flatMap((item) => item.proposalLines)];
  const offeredBudgetCore = [...commonBudgetLines, ...packages.flatMap((item) => item.budgetLines)];
  const selectedPackages = packages.filter((item) => item.workPackage.selected);
  const activePackages = input.selectionConfirmed ? selectedPackages : packages;
  const commonIsActive = activePackages.length > 0;
  const activeProposalLines = [...(commonIsActive ? commonProposalLines : []), ...activePackages.flatMap((item) => item.proposalLines)];
  let activeBudgetCore = [...(commonIsActive ? commonBudgetLines : []), ...activePackages.flatMap((item) => item.budgetLines)];
  const selectedMaterials = selectedRepairMaterialBudget(input, activePackages, repairCatalog);
  if (input.selectionConfirmed && selectedMaterials.lines.length) {
    activeBudgetCore = [
      ...activeBudgetCore.filter((row) => !(row.plCategory === "Materials" && row.workPackageId && activePackages.some((item) => item.workPackage.id === row.workPackageId && item.workPackage.service === "Repairs"))),
      ...selectedMaterials.lines
    ];
  }

  const withBonus = (proposalLines: Line[], budgetLines: Line[]) => {
    const proposalValue = total(proposalLines);
    const bonus = input.bdmBonusRequired ? money(proposalValue * Math.max(0, num(rates.bdmBonusRate))) : 0;
    return bonus ? [...budgetLines, commonTagged([budgetVersion(line("Labour", "BDM bonus", bonus, "item", 1, 0, "Optional BDM bonus", "Labour"))])[0]] : budgetLines;
  };
  const offeredBudgetLines = withBonus(offeredProposalLines, offeredBudgetCore);
  const budgetLines = withBonus(activeProposalLines, activeBudgetCore);
  const proposalLines = activeProposalLines;
  const originalProposalTotal = total(proposalLines, "originalTotal");
  const discountAmount = money(proposalLines.reduce((sum, row) => sum + row.discount, 0));
  const proposalTotal = total(proposalLines);
  const budgetCost = total(budgetLines);
  const budgetProfit = money(proposalTotal - budgetCost);
  const allOptionsProposalTotal = total(offeredProposalLines);
  const allOptionsBudgetCost = total(offeredBudgetLines);
  const selectedProposalLines = [...(selectedPackages.length ? commonProposalLines : []), ...selectedPackages.flatMap((item) => item.proposalLines)];
  const selectedProposalTotal = total(selectedProposalLines);
  const selectedBudgetCore = [...(selectedPackages.length ? commonBudgetLines : []), ...selectedPackages.flatMap((item) => item.budgetLines)];
  const selectedConsolidatedMaterials = selectedRepairMaterialBudget(input, selectedPackages, repairCatalog);
  const selectedBudgetLines = selectedConsolidatedMaterials.lines.length ? [
    ...selectedBudgetCore.filter((row) => !(row.plCategory === "Materials" && row.workPackageId && selectedPackages.some((item) => item.workPackage.id === row.workPackageId && item.workPackage.service === "Repairs"))),
    ...selectedConsolidatedMaterials.lines
  ] : selectedBudgetCore;
  const selectedBudgetCost = total(withBonus(selectedProposalLines, selectedBudgetLines));

  let nextAutomaticStart = 1;
  const phaseRows = activePackages.map((item) => {
    const duration = Math.max(0, item.summary.days);
    const startDay = item.workPackage.startDay > 0 ? Math.ceil(item.workPackage.startDay) : nextAutomaticStart;
    const endDay = duration ? startDay + duration - 1 : startDay - 1;
    nextAutomaticStart = Math.max(nextAutomaticStart, endDay + 1);
    return { service: item.workPackage.service, calculatedDays: duration, inputDays: duration, startDay, endDay, concurrent: false, workPackageId: item.workPackage.id, label: `${item.workPackage.code}. ${item.workPackage.name}` };
  });
  phaseRows.forEach((row) => {
    row.concurrent = phaseRows.some((other) => other !== row && row.calculatedDays > 0 && other.calculatedDays > 0 && row.startDay <= other.endDay && other.startDay <= row.endDay);
  });
  const siteDays = phaseRows.reduce((max, row) => Math.max(max, row.endDay), 0);
  const activeServices = Array.from(new Set(activePackages.map((item) => item.workPackage.service)));
  const rateSchedules = packages.flatMap((item) => item.rateSchedule ? [item.rateSchedule] : []);
  const companyExchange = num(input.exchangeRateToCompanyCurrency) > 0 ? num(input.exchangeRateToCompanyCurrency) : 1;
  const groupExchange = num(input.exchangeRateToGroupCurrency) > 0 ? num(input.exchangeRateToGroupCurrency) : 1;
  const travelTotal = total(proposalLines.filter((row) => row.plCategory === "Travel"));
  const haulageTotal = total(proposalLines.filter((row) => row.plCategory === "Haulage"));
  const commonProposalTotal = total(commonProposalLines);
  return {
    costingModule: "remedial",
    projectReference: input.projectReference,
    client: input.client,
    location: input.location,
    serviceSummary: activeServices.join(" + ") || "Draft",
    grindingDays: activePackages.filter((item) => item.workPackage.service === "Grinding").reduce((sum, item) => sum + item.summary.days, 0),
    screedDays: activePackages.filter((item) => item.workPackage.service === "Screeding").reduce((sum, item) => sum + item.summary.days, 0),
    repairDays: activePackages.filter((item) => item.workPackage.service === "Repairs").reduce((sum, item) => sum + item.summary.days, 0),
    siteDays,
    phaseRows,
    proposalLines,
    budgetLines,
    repairMaterialCalcs: selectedMaterials.calculations,
    originalProposalTotal,
    discountAmount,
    proposalTotal,
    budgetCost,
    budgetProfit,
    budgetMargin: proposalTotal ? pct(budgetProfit / proposalTotal) : 0,
    budgetMarkup: budgetCost ? pct(budgetProfit / budgetCost) : 0,
    bdmBonusBudget: budgetLines.find((row) => row.item === "BDM bonus")?.cost ?? 0,
    bdmBonusRate: Math.max(0, num(rates.bdmBonusRate)),
    proposalCompanyCurrency: money(proposalTotal * companyExchange),
    budgetCompanyCurrency: money(budgetCost * companyExchange),
    proposalGroupCurrency: money(proposalTotal * groupExchange),
    budgetGroupCurrency: money(budgetCost * groupExchange),
    dailyRate: rateSchedules.length === 1 ? rateSchedules[0].productiveProposalRate : 0,
    mobilisationRate: total(proposalLines.filter(isMobilisationLine)),
    mobilisationBudget: total(budgetLines.filter(isMobilisationLine)),
    travelTotal,
    haulageTotal,
    standbyRate: rateSchedules.length === 1 ? rateSchedules[0].standbyProposalRate : 0,
    pricingMode: "selectable",
    selectionConfirmed: input.selectionConfirmed,
    allOptionsProposalTotal,
    selectedProposalTotal,
    commonProposalTotal,
    allOptionsBudgetCost,
    selectedBudgetCost,
    offeredProposalLines,
    offeredBudgetLines,
    packageSummaries: packages.map((item) => item.summary),
    rateSchedules
  };
}

export function calculateProject(input: ProjectInput, rates: AdminRates, repairCatalog: RepairCatalog = defaultRepairCatalog): ProjectCalculations {
  if (input.pricingMode === "selectable" && input.workPackages.length) return calculateSelectableProject(input, rates, repairCatalog);
  return calculateCombinedProject(input, rates, repairCatalog);
}

export function defaultActuals(calculations: ProjectCalculations): PLActuals {
  return {
    actualPrice: calculations.proposalTotal,
    datesRequired: "",
    startDate: "",
    endDate: "",
    saturdayWorked: false,
    sundayWorked: false,
    travelDays: 0,
    daysTakenToComplete: 0,
    siteDaysOverridden: false,
    labourInternalDays: 0,
    labourInternalRate: 0,
    surveyDays: 0,
    surveyDayRate: 0,
    surveyTravelDays: 0,
    surveyTravelRate: 0,
    bonus: 0,
    labourInternal: 0,
    labourSubcontract: 0,
    repairs: 0,
    equipmentRental: 0,
    haulage: 0,
    materials: 0,
    engineeringReport: 0,
    travel: 0,
    hotel: 0,
    subsistence: 0,
    other: 0,
    surveyorInternal: 0,
    projectManagerInternal: 0,
    labourerInternal: 0
  };
}

export function calculateWorkingDays(startDate: string, endDate: string, saturdayWorked: boolean, sundayWorked: boolean) {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return 0;
  let days = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const day = cursor.getDay();
    if (day === 0 && !sundayWorked) continue;
    if (day === 6 && !saturdayWorked) continue;
    days += 1;
  }
  return days;
}

export function calculateActualSiteDays(actuals: PLActuals) {
  return Math.max(0, calculateWorkingDays(actuals.startDate, actuals.endDate, actuals.saturdayWorked, actuals.sundayWorked) - num(actuals.travelDays));
}

export function calculatePL(calculations: ProjectCalculations, actuals: PLActuals): PLSummary {
  if (calculations.costingModule === "survey") return calculateSurveyPL(calculations, actuals);
  const budgetWhere = (predicate: (line: Line) => boolean) => money(calculations.budgetLines.filter(predicate).reduce((sum, row) => sum + row.total, 0));
  const budget = (category: PLCategory) => budgetWhere((row) => (row.plCategory ?? sectionPLCategory(row.section)) === category);
  const itemIncludes = (line: Line, text: string) => line.item.toLowerCase().includes(text);
  const engineeringBudget = budgetWhere((row) => itemIncludes(row, "engineering report"));
  const surveyDayBudget = budgetWhere((row) => (row.plCategory ?? sectionPLCategory(row.section)) === "Labour" && itemIncludes(row, "surveyor") && !itemIncludes(row, "engineering report"));
  const surveyTravelBudget = budgetWhere((row) => itemIncludes(row, "surveyor travel"));
  const labourInternalBudget = budgetWhere((row) => (row.plCategory ?? sectionPLCategory(row.section)) === "Labour" && !itemIncludes(row, "surveyor") && !itemIncludes(row, "engineering report") && !itemIncludes(row, "bdm bonus"));
  const travelBudget = budgetWhere((row) => (row.plCategory ?? sectionPLCategory(row.section)) === "Travel" && !itemIncludes(row, "surveyor travel"));
  const bonus = calculations.bdmBonusBudget > 0 ? money(num(actuals.actualPrice) * calculations.bdmBonusRate) : 0;
  const bonusBudget = budgetWhere((row) => itemIncludes(row, "bdm bonus"));
  const rows = [
    { section: "Labour Internal", item: "Labour Internal", actual: money(num(actuals.labourInternal)), budget: labourInternalBudget },
    { section: "Labour Internal", item: "Survey Days", actual: money(num(actuals.surveyDays) * num(actuals.surveyDayRate)), budget: surveyDayBudget },
    { section: "Labour Internal", item: "Survey Travel Days", actual: money(num(actuals.surveyTravelDays) * num(actuals.surveyTravelRate)), budget: surveyTravelBudget },
    { section: "Labour Internal", item: "BDM Bonus", actual: bonus, budget: bonusBudget },
    { section: "Labour Subcontract", item: "Labour Subcontract", actual: num(actuals.labourSubcontract), budget: budget("Subcontract") },
    { section: "Equipment", item: "Equipment Rental", actual: num(actuals.equipmentRental), budget: budget("Equipment") },
    { section: "Haulage", item: "Haulage", actual: num(actuals.haulage), budget: budget("Haulage") },
    { section: "Materials", item: "Materials", actual: num(actuals.materials), budget: budget("Materials") },
    { section: "Reports", item: "Engineering Report", actual: num(actuals.engineeringReport), budget: engineeringBudget },
    { section: "Travel", item: "Travel", actual: num(actuals.travel), budget: travelBudget },
    { section: "Hotel/Subsistence", item: "Hotel", actual: num(actuals.hotel), budget: budgetWhere((row) => row.section === "Hotel" || (row.section === "Additional items" && (row.plCategory ?? sectionPLCategory(row.section)) === "Hotel/Subsistence")) },
    { section: "Hotel/Subsistence", item: "Subsistence", actual: num(actuals.subsistence), budget: budgetWhere((row) => row.section === "Subsistence") },
    { section: "Other", item: "Other", actual: num(actuals.other), budget: 0 }
  ].map((row) => ({ ...row, variance: money(row.budget - row.actual) }));
  const actualCost = money(rows.reduce((sum, row) => sum + row.actual, 0));
  const actualProfit = money(actuals.actualPrice - actualCost);
  const actualMargin = actuals.actualPrice ? pct(actualProfit / actuals.actualPrice) : 0;
  const actualMarkup = actualCost ? pct(actualProfit / actualCost) : 0;
  const originalBudgetProfit = money(calculations.proposalTotal - calculations.budgetCost);
  const originalBudgetMargin = calculations.proposalTotal ? pct(originalBudgetProfit / calculations.proposalTotal) : 0;
  const originalBudgetMarkup = calculations.budgetCost ? pct(originalBudgetProfit / calculations.budgetCost) : 0;
  const budgetProfit = money(actuals.actualPrice - calculations.budgetCost);
  const budgetMargin = actuals.actualPrice ? pct(budgetProfit / actuals.actualPrice) : 0;
  const budgetMarkup = calculations.budgetCost ? pct(budgetProfit / calculations.budgetCost) : 0;
  const calculatedActualDays = calculateActualSiteDays(actuals);
  const enteredActualDays = num(actuals.daysTakenToComplete);
  const actualDays = actuals.siteDaysOverridden || (enteredActualDays > 0 && enteredActualDays !== calculatedActualDays) ? enteredActualDays : calculatedActualDays;
  const started = Boolean(actuals.completedAt || actuals.startDate || actuals.endDate || actuals.datesRequired || actuals.travelDays || actuals.daysTakenToComplete || rows.some((row) => row.actual !== 0) || actuals.actualPrice !== calculations.proposalTotal);
  const programmeStatus = !started ? "P&L NOT STARTED" : actualDays <= calculations.siteDays + 0.1 ? "PROJECT COMPLETED ON TIME" : "PROJECT RUN OVER TIME";
  return { rows, actualCost, actualProfit, actualMargin, actualMarkup, originalBudgetProfit, originalBudgetMargin, originalBudgetMarkup, budgetProfit, budgetMargin, budgetMarkup, programmeStatus, started };
}

function calculateSurveyPL(calculations: ProjectCalculations, actuals: PLActuals): PLSummary {
  const budgetFor = (predicate: (line: Line) => boolean) => money(calculations.budgetLines.filter(predicate).reduce((sum, line) => sum + line.total, 0));
  const named = (...names: string[]) => budgetFor((line) => names.includes(line.item));
  const category = (value: PLCategory) => budgetFor((line) => (line.plCategory ?? sectionPLCategory(line.section)) === value);
  const rows = [
    { section: "Labour Internal", item: "Surveyor", actual: num(actuals.surveyorInternal), budget: named("Surveyor", "Surveyor Travel", "Weekend Surveyor") },
    { section: "Labour Internal", item: "Project Manager", actual: num(actuals.projectManagerInternal), budget: named("Project Manager", "Project Manager Travel") },
    { section: "Labour Internal", item: "Labourer", actual: num(actuals.labourerInternal), budget: named("Labourer", "Labourer Travel") },
    { section: "Labour Internal", item: "Reports", actual: num(actuals.engineeringReport), budget: named("Engineering Report", "Error Plan") },
    { section: "Labour Subcontract", item: "Labour Subcontract", actual: num(actuals.labourSubcontract), budget: category("Subcontract") },
    { section: "Equipment", item: "Equipment Rental", actual: num(actuals.equipmentRental), budget: category("Equipment") },
    { section: "Haulage", item: "Haulage", actual: num(actuals.haulage), budget: category("Haulage") },
    { section: "Materials", item: "Materials", actual: num(actuals.materials), budget: category("Materials") },
    { section: "Travel", item: "Travel", actual: num(actuals.travel), budget: category("Travel") },
    { section: "Hotel/Subsistence", item: "Hotel", actual: num(actuals.hotel), budget: budgetFor((line) => line.section === "Hotel") },
    { section: "Hotel/Subsistence", item: "Subsistence", actual: num(actuals.subsistence), budget: budgetFor((line) => line.section === "Subsistence") },
    { section: "Other", item: "Other", actual: num(actuals.other), budget: 0 }
  ].map((row) => ({ ...row, actual: money(row.actual), budget: money(row.budget), variance: money(row.budget - row.actual) }));
  const actualCost = money(rows.reduce((sum, row) => sum + row.actual, 0));
  const actualProfit = money(num(actuals.actualPrice) - actualCost);
  const actualMargin = actuals.actualPrice ? pct(actualProfit / actuals.actualPrice) : 0;
  const actualMarkup = actualCost ? pct(actualProfit / actualCost) : 0;
  const originalBudgetProfit = money(calculations.proposalTotal - calculations.budgetCost);
  const originalBudgetMargin = calculations.proposalTotal ? pct(originalBudgetProfit / calculations.proposalTotal) : 0;
  const originalBudgetMarkup = calculations.budgetCost ? pct(originalBudgetProfit / calculations.budgetCost) : 0;
  const budgetProfit = money(num(actuals.actualPrice) - calculations.budgetCost);
  const budgetMargin = actuals.actualPrice ? pct(budgetProfit / actuals.actualPrice) : 0;
  const budgetMarkup = calculations.budgetCost ? pct(budgetProfit / calculations.budgetCost) : 0;
  const calculatedActualDays = calculateActualSiteDays(actuals);
  const enteredActualDays = num(actuals.daysTakenToComplete);
  const actualDays = actuals.siteDaysOverridden || (enteredActualDays > 0 && enteredActualDays !== calculatedActualDays) ? enteredActualDays : calculatedActualDays;
  const started = Boolean(actuals.completedAt || actuals.startDate || actuals.endDate || actuals.travelDays || actuals.daysTakenToComplete || rows.some((row) => row.actual !== 0) || actuals.actualPrice !== calculations.proposalTotal);
  const programmeStatus = !started ? "P&L NOT STARTED" : actualDays <= calculations.siteDays + 0.1 ? "PROJECT COMPLETED ON TIME" : "PROJECT RUN OVER TIME";
  return { rows, actualCost, actualProfit, actualMargin, actualMarkup, originalBudgetProfit, originalBudgetMargin, originalBudgetMarkup, budgetProfit, budgetMargin, budgetMarkup, programmeStatus, started };
}

export function searchRowTone(record: { accountsStatus: string; actuals?: PLActuals; calculations: ProjectCalculations }) {
  if (record.accountsStatus !== "Actuals Saved" || !record.actuals) return "yellow";
  const summary = calculatePL(record.calculations, record.actuals);
  const exactMarkup = summary.actualCost ? (summary.actualProfit / summary.actualCost) * 100 : 0;
  return exactMarkup >= 25 ? "green" : "red";
}
