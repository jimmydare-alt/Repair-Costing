import { defaultRepairCatalog, materialById, repairTypeByCode } from "./repairCatalog";
import type { AdminRates, Line, MaterialCalc, PLActuals, PLCategory, PLSummary, ProjectCalculations, ProjectInput, RepairCatalog, RepairLineItem, RepairMaterial, RepairMaterialInput, Section } from "./types";

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

function line(section: Section, item: string, rate: number, unit: string, quantity: number, marginRate: number, source: string, plCategory: PLCategory = sectionPLCategory(section)): Line {
  const cost = money(num(rate) * num(quantity));
  const margin = money(cost * num(marginRate));
  const total = money(cost + margin);
  return { section, item, rate: num(rate), unit, quantity: num(quantity), cost, margin, total, discount: 0, originalTotal: total, source, plCategory };
}

function rateMargin(rates: AdminRates, key: keyof AdminRates, fallback: number) {
  return num(rates.rateMargins?.[String(key)] ?? fallback);
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

export function grindingDays(input: ProjectInput) {
  return input.includeGrinding && input.grinding.enabled ? num(input.grinding.estimatedDays) || num(input.grinding.weeks) * num(input.grinding.daysPerWeek) : 0;
}

export function screedDays(input: ProjectInput) {
  return input.includeScreeding && input.screeding.enabled ? (num(input.screeding.totalDaysOnSite) || input.screeding.teams.reduce((sum, team) => sum + (team.enabled ? num(team.daysProgrammed) : 0), 0)) : 0;
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

const materialRates: Record<string, number> = {
  "CoGri Rapid Mender": 90.25,
  "CoGri Rapid Mender XT Pro 23kg": 80,
  "CoGri Rapid Mender XT Pro 46kg": 160,
  "CoGri Arris Repair Mortar (RBP)": 36,
  "CoGri Bondcoat (RBP)": 27,
  "CoGri Rapid Seal 60/75 (600ml)": 18,
  "CoGri Rapid Seal 60/75 (37.8ltr)": 640,
  "CoGri LV Rapid (600ml)": 21,
  "Arbo MP20 (380ml)": 5.5,
  "CoGri FastPrime (5ltr)": 55,
  "CoGri FfIT Topping": 18,
  "CoGri FfIT Base": 18
};

export function calculateRepairMaterial(input: RepairMaterialInput): MaterialCalc {
  const length = num(input.lengthM);
  const width = num(input.widthMm);
  const depth = num(input.depthMm);
  const area = num(input.areaM2);
  const thickness = num(input.thicknessMm);
  const rate = materialRates[input.product] ?? 0;
  let quantity = 0;
  let formula = "";
  if (input.product === "CoGri Rapid Mender") {
    quantity = Math.ceil((length * width * depth) / 1000 / 9) * 1.1;
    formula = "ROUNDUP((Length*Width*Depth)/1000/9,0)*1.1";
  } else if (input.product === "CoGri Rapid Mender XT Pro 23kg") {
    quantity = Math.ceil((length * width * depth) / 1000 / 12) * 1.1;
    formula = "ROUNDUP((Length*Width*Depth)/1000/12,0)*1.1";
  } else if (input.product === "CoGri Rapid Mender XT Pro 46kg") {
    quantity = Math.ceil((length * width * depth) / 1000 / 24) * 1.1;
    formula = "ROUNDUP((Length*Width*Depth)/1000/24,0)*1.1";
  } else if (input.product === "CoGri Arris Repair Mortar (RBP)") {
    quantity = Math.ceil((length * width * depth) / 1000 / 7) * 1.1;
    formula = "ROUNDUP((Length*Width*Depth)/1000/7,0)*1.1";
  } else if (input.product === "CoGri Bondcoat (RBP)") {
    quantity = Math.ceil((width / 100 * depth / 100 * length) / 5) * 1.1;
    formula = "ROUNDUP((Width/100*Depth/100*Length)/5,0)*1.1";
  } else if (input.product === "CoGri Rapid Seal 60/75 (37.8ltr)") {
    quantity = Math.ceil(((length * width * depth) / 1000 * 1.2) / 37.8);
    formula = "ROUNDUP(((Length*Width*Depth)/1000*1.2)/37.8,0)";
  } else if (input.product === "Arbo MP20 (380ml)") {
    quantity = Math.ceil(((length * width * depth) / 1000 * 1.1) / 0.38);
    formula = "ROUNDUP(((Length*Width*Depth)/1000*1.1)/0.38,0)";
  } else if (input.product === "CoGri FastPrime (5ltr)") {
    quantity = Math.ceil((((0.14 * area) / 2) * 1.1 * 1.05) / 5);
    formula = "ROUNDUP((((0.14*Area)/2)*1.1*1.05)/5,0)";
  } else if (input.product === "CoGri FfIT Topping" || input.product === "CoGri FfIT Base") {
    const density = input.product === "CoGri FfIT Topping" ? 1.74 : 1.814;
    quantity = Math.ceil(((density * area * thickness) / 25) * 1.1 * 1.05);
    formula = "ROUNDUP(((Density*Area*Thickness)/25)*1.1*1.05,0)";
  } else {
    quantity = Math.ceil(((length * width * depth) / 1000 * 1.1) / 0.6);
    formula = "ROUNDUP(((Length*Width*Depth)/1000*1.1)/0.6,0)";
  }
  return { product: input.product, quantity: money(quantity), unit: "units", rate, cost: money(quantity * rate), formula };
}

function calculateCatalogueMaterial(repairLine: RepairLineItem, material: RepairMaterial, selection?: RepairLineItem["materialSelections"][number]): MaterialCalc {
  const length = num(repairLine.lengthM);
  const width = num(selection?.widthMm) || num(repairLine.widthMm);
  const depth = num(selection?.depthMm) || num(repairLine.depthMm);
  const area = num(repairLine.areaM2);
  const thickness = num(repairLine.thicknessMm);
  const each = num(repairLine.eachQty);
  const holeVolume = holeVolumeLitres(repairLine);
  const coverage = Math.max(num(material.coveragePerUnit), 0.0001);
  const waste = Math.max(num(material.wasteFactor), 0);
  let quantity = 0;
  let formula = "";
  if (material.calcMethod === "volume_lwd") {
    const baseVolumeLitres = length && width && depth ? (length * width * depth) / 1000 : area && thickness ? area * thickness : holeVolume;
    const required = volumeRequirement(baseVolumeLitres, material) * waste;
    quantity = Math.ceil(required / coverage);
    formula = length && width && depth ? `${repairLine.repairTypeCode}: ROUNDUP(((Length*Width*Depth)/1000*Waste)/Coverage per unit,0)` : area && thickness ? `${repairLine.repairTypeCode}: ROUNDUP((Area*Thickness*Waste)/Coverage per unit,0)` : `${repairLine.repairTypeCode}: ROUNDUP((Each*PI*(Hole diameter/2)^2*Hole depth/1000000*Waste)/Coverage per unit,0)`;
  } else if (material.calcMethod === "area_thickness") {
    if (material.id === "fastprime-5") {
      quantity = Math.ceil((((0.14 * area) / 2) * waste) / coverage);
      formula = `${repairLine.repairTypeCode}: ROUNDUP((((0.14*Area)/2)*Waste)/Coverage per unit,0)`;
    } else if (material.id === "bondcoat-rbp") {
      quantity = Math.ceil(((width / 100 * depth / 100 * length) * waste) / coverage);
      formula = `${repairLine.repairTypeCode}: ROUNDUP(((Width/100*Depth/100*Length)*Waste)/Coverage per unit,0)`;
    } else {
      const density = material.densityKgPerL ?? 1;
      const areaVolumeLitres = area && thickness ? area * thickness : holeVolume;
      const required = material.measuredUnitType === "kg" ? density * areaVolumeLitres : volumeRequirement(areaVolumeLitres, material);
      quantity = Math.ceil((required * waste) / coverage);
      formula = area && thickness
        ? material.measuredUnitType === "kg" ? `${repairLine.repairTypeCode}: ROUNDUP(((Density*Area*Thickness)*Waste)/Coverage per unit,0)` : `${repairLine.repairTypeCode}: ROUNDUP((Area*Thickness*Waste)/Coverage per unit,0)`
        : material.measuredUnitType === "kg" ? `${repairLine.repairTypeCode}: ROUNDUP((Density*Each*PI*(Hole diameter/2)^2*Hole depth/1000000*Waste)/Coverage per unit,0)` : `${repairLine.repairTypeCode}: ROUNDUP((Each*PI*(Hole diameter/2)^2*Hole depth/1000000*Waste)/Coverage per unit,0)`;
    }
  } else if (material.calcMethod === "linear") {
    quantity = Math.ceil((length * waste) / coverage);
    formula = `${repairLine.repairTypeCode}: ROUNDUP((Length*Waste)/Coverage per unit,0)`;
  } else if (material.calcMethod === "each") {
    quantity = Math.ceil((each * waste) / coverage);
    formula = `${repairLine.repairTypeCode}: ROUNDUP((Each*Waste)/Coverage per unit,0)`;
  } else {
    quantity = Math.ceil((num(repairLine.manualMaterialQty) * waste) / coverage);
    formula = `${repairLine.repairTypeCode}: ROUNDUP((Manual quantity*Waste)/Coverage per unit,0)`;
  }
  return { product: `${repairLine.repairTypeCode} - ${material.name}`, quantity: money(quantity), unit: "full units", rate: material.costPerUnit, cost: money(quantity * material.costPerUnit), formula };
}

export function calculateRepairLineMaterials(repairLine: RepairLineItem, repairCatalog: RepairCatalog = defaultRepairCatalog): MaterialCalc[] {
  const type = repairTypeByCode(repairLine.repairTypeCode, repairCatalog);
  const selections = new Map(repairLine.materialSelections.map((selection) => [selection.materialId, selection]));
  const selected = new Set(repairLine.materialSelections.filter((selection) => selection.selected).map((selection) => selection.materialId));
  return type.materialRules
    .filter((rule) => rule.role === "required" || selected.has(rule.materialId))
    .map((rule) => materialById(rule.materialId, repairCatalog))
    .filter((material): material is RepairMaterial => Boolean(material))
    .map((material) => calculateCatalogueMaterial(repairLine, material, selections.get(material.id)))
    .filter((calc) => calc.quantity > 0 || calc.cost > 0);
}

function travelLines(input: ProjectInput, rates: AdminRates, people: number, siteDays: number) {
  if (input.travelMode === "None") return [];
  const drive = input.travelMode === "Drive";
  const hasDriveTravel = drive && num(input.distanceKmOneWay) > 0;
  const hasFlyTravel = !drive;
  const travelDays = hasDriveTravel ? ceil(input.driveTimeDaysOneWay) * 2 * people : hasFlyTravel ? 2 * people : 0;
  const mileageQty = hasDriveTravel ? num(input.distanceKmOneWay) * 2 * Math.max(1, num(input.vehicles)) : 0;
  const flightQty = drive ? input.additionalFlights : people + input.additionalFlights;
  const airportQty = input.airportTransport === "Uber" ? 1 : input.airportTransport === "Drive" ? siteDays + 1 : 0;
  return [
    line("Travel", "Project travel day rate", rates.surveyorTravelDayRate, "day", travelDays, rateMargin(rates, "surveyorTravelDayRate", 0), "Project-wide travel tab"),
    line("Travel", "Project mileage (round trip)", rates.mileagePerKm, "km", mileageQty, rateMargin(rates, "mileagePerKm", rates.travelMargin), "Travel tab one-way km x 2 x vehicles"),
    line("Travel", "Return flight", rates.returnFlight, "flight", flightQty, rateMargin(rates, "returnFlight", rates.flightMargin), "Return flight rows"),
    line("Travel", "Airport transport", input.airportTransport === "Uber" ? rates.airportUberReturn : rates.airportParkingPerDay, input.airportTransport === "Uber" ? "return" : "day", airportQty, input.airportTransport === "Uber" ? rateMargin(rates, "airportUberReturn", rates.travelMargin) : rateMargin(rates, "airportParkingPerDay", rates.travelMargin), "Hidden airport transport rows"),
    line("Travel", "Company car / vehicle", rates.companyCar, "day", hasDriveTravel ? (siteDays + 2) * Math.max(1, input.vehicles) : 0, rateMargin(rates, "companyCar", rates.travelMargin), "Project-wide vehicle allowance")
  ];
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
  const productionHotelNights = g.productionHotelRequired ? num(g.productionHotelNights) * productionMen : 0;
  const surveyorHotelNights = g.surveyorHotelRequired ? num(g.surveyorHotelNights) * surveyorCount : 0;
  const productionKm = num(g.productionOneWayKm) * 2 * Math.max(1, num(g.productionVehicles));
  const surveyorKm = num(g.surveyorOneWayKm) * 2 * Math.max(1, num(g.surveyorVehicles));
  const rows: Line[] = [
    line("Labour", "Surveyor labour", rates.surveyorDayRate, "surveyor day", useSurveyorInHouse ? surveyorCount * surveyorDays : 0, rateMargin(rates, "surveyorDayRate", 0), "Grinding surveyor labour"),
    line("Labour", "Surveyor weekend extra", rates.productionWeekendDayRate, "surveyor day", useSurveyorInHouse ? surveyorCount * num(g.surveyorWeekendDays) : 0, rateMargin(rates, "productionWeekendDayRate", rates.defaultMargin), "Grinding surveyor weekend allowance"),
    line("Labour", "Surveyor night-shift allowance", rates.productionNightShiftAllowance, "surveyor night", useSurveyorInHouse && g.nightShiftRequired ? surveyorCount * num(g.surveyorNightShifts || g.nightShifts) : 0, rateMargin(rates, "productionNightShiftAllowance", rates.defaultMargin), "Grinding surveyor night shift allowance"),
    line("Travel", "Surveyor travel", rates.surveyorTravelDayRate, "surveyor day", useSurveyorInHouse ? surveyorCount * num(g.surveyorTravelDays) : 0, rateMargin(rates, "surveyorTravelDayRate", 0), "Grinding surveyor travel days"),
    line("Travel", "Surveyor mileage", rates.mileagePerKm, "km", useSurveyorInHouse ? surveyorKm : 0, rateMargin(rates, "mileagePerKm", rates.travelMargin), "Grinding surveyor one-way km x 2 x vehicles"),
    line("Hotel", "Surveyor hotel", rates.hotel, "night", useSurveyorInHouse ? surveyorHotelNights : 0, rateMargin(rates, "hotel", rates.hotelMargin), "Grinding surveyor hotel nights x surveyors"),
    line("Subsistence", "Surveyor subsistence", rates.subsistence, "day", useSurveyorInHouse ? surveyorHotelNights : 0, rateMargin(rates, "subsistence", rates.subsistenceMargin), "Grinding surveyor subsistence follows hotel nights"),
    line("Labour", "Grinding production labour", rates.productionLabourDayRate, "man day", useProductionInHouse ? productionMen * productionDays : 0, rateMargin(rates, "productionLabourDayRate", rates.defaultMargin), "Grinding production labour"),
    line("Labour", "Grinding production weekend extra", rates.productionWeekendDayRate, "man day", useProductionInHouse ? productionMen * num(g.productionWeekendDays || Math.max(0, num(g.weekendDaysPerWeek))) : 0, rateMargin(rates, "productionWeekendDayRate", rates.defaultMargin), "Grinding production weekend allowance"),
    line("Labour", "Grinding production night-shift allowance", rates.productionNightShiftAllowance, "man night", useProductionInHouse && g.nightShiftRequired ? productionMen * num(g.productionNightShifts || g.nightShifts) : 0, rateMargin(rates, "productionNightShiftAllowance", rates.defaultMargin), "Grinding production night shift allowance"),
    line("Travel", "Grinding production travel", rates.productionLabourTravelDayRate, "man day", useProductionInHouse ? productionMen * num(g.productionTravelDays) : 0, rateMargin(rates, "productionLabourTravelDayRate", rates.travelMargin), "Grinding production travel days"),
    line("Travel", "Grinding production mileage", rates.mileagePerKm, "km", useProductionInHouse ? productionKm : 0, rateMargin(rates, "mileagePerKm", rates.travelMargin), "Grinding production one-way km x 2 x vehicles"),
    line("Hotel", "Grinding hotel production", rates.hotel, "night", useProductionInHouse ? productionHotelNights : 0, rateMargin(rates, "hotel", rates.hotelMargin), "Grinding production hotel nights x men"),
    line("Subsistence", "Grinding subsistence production", rates.subsistence, "day", useProductionInHouse ? productionHotelNights : 0, rateMargin(rates, "subsistence", rates.subsistenceMargin), "Grinding production subsistence follows hotel nights"),
    line("Reports", "Engineering report", rates.engineeringReport, "item", useSurveyorInHouse && g.engineeringReport ? 1 : 0, rateMargin(rates, "engineeringReport", 0), "Grinding Proposal!B31:H31")
  ];
  if (useSurveyorSubcontract) {
    g.surveyorSubcontractors.forEach((item) => {
      const qty = item.priceType === "day" ? item.days || surveyorDays : item.rate ? 1 : 0;
      rows.push(line("Subcontract", item.name || "Grinding surveyor subcontractor", item.rate, item.priceType, qty, item.margin, "Grinding surveyor subcontract labour"));
      rows.push(line("Subcontract", `${item.name || "Grinding surveyor subcontractor"} mobilisation`, item.mobilisationCost, "mobilisation", item.mobilisations, item.mobilisationMargin, "Grinding surveyor subcontract mobilisation"));
    });
  }
  if (useProductionSubcontract) {
    const activeSubcontractors = g.productionSubcontractors.filter((item) => item.rate > 0 || item.mobilisationCost > 0);
    const subcontractors = activeSubcontractors.length ? activeSubcontractors : [{ name: "Grinding subcontractor", priceType: g.subcontractPriceType, rate: g.subcontractRate, days, margin: rates.subcontractMargin, mobilisationCost: g.subcontractMobilisation, mobilisations: g.subcontractMobilisation ? 1 : 0, mobilisationMargin: rates.subcontractMargin }];
    subcontractors.forEach((item) => {
      const qty = item.priceType === "day" ? item.days || days : item.rate ? 1 : 0;
      rows.push(line("Subcontract", item.name || "Grinding subcontractor", item.rate, item.priceType, qty, item.margin, "Grinding subcontract labour incl. standard labour/equipment"));
      rows.push(line("Subcontract", `${item.name || "Grinding subcontractor"} mobilisation`, item.mobilisationCost, "mobilisation", item.mobilisations, item.mobilisationMargin, "Grinding subcontract mobilisation"));
    });
  }
  rows.push(
    line("Equipment", "10000 watt generator", rates.grindingSmallGeneratorDayRate, "day", useProductionInHouse && g.generatorRequired ? days : 0, rateMargin(rates, "grindingSmallGeneratorDayRate", rates.equipmentMargin), "Grinding Proposal!B38:H38"),
    line("Equipment", "Large generator rental", g.largeGeneratorRate, "day", useProductionInHouse && g.largeGeneratorRequired ? days : 0, rates.equipmentMargin, "Grinding Proposal!B39:H39"),
    line("Equipment", "Large generator delivery", g.largeGeneratorDelivery, "item", useProductionInHouse && g.largeGeneratorRequired ? 1 : 0, rates.equipmentMargin, "Grinding Proposal!B40:H40"),
    line("Equipment", "Large generator collection", g.largeGeneratorCollection, "item", useProductionInHouse && g.largeGeneratorRequired ? 1 : 0, rates.equipmentMargin, "Grinding Proposal!B41:H41"),
    line("Equipment", "Grinders", rates.grindingGrinderDayRate, "grinder day", useProductionInHouse ? productionMen * days : 0, rateMargin(rates, "grindingGrinderDayRate", rates.equipmentMargin), "Grinding Proposal!B42:H42"),
    line("Equipment", "Planers", rates.grindingPlanerDayRate, "planer day", useProductionInHouse && g.gasPlaners ? g.gasPlaners * days : 0, rateMargin(rates, "grindingPlanerDayRate", rates.equipmentMargin), "Grinding Proposal!B45:H45"),
    line("Equipment", "Vacuums", rates.grindingDustVacuumDayRate, "vacuum day", useProductionInHouse && g.dustVacuums ? g.dustVacuums * days : 0, rateMargin(rates, "grindingDustVacuumDayRate", rates.equipmentMargin), "Grinding Proposal!B46:H46"),
    line("Equipment", "Extension cords", rates.grindingExtensionCordsDayRate, "day", useProductionInHouse && g.extensionCordsRequired ? days : 0, rateMargin(rates, "grindingExtensionCordsDayRate", rates.equipmentMargin), "Grinding Proposal!B47:H47"),
    line("Materials", "Grinding segments", rates.grindingSegmentsDayRate, "grinder day", useProductionInHouse && g.grindingSegmentsRequired ? productionMen * days : 0, rateMargin(rates, "grindingSegmentsDayRate", rates.equipmentMargin), "Grinding Proposal!B48:H48"),
    line("Materials", "Grinding consumables", rates.grindingConsumablesDayRate, "grinder day", useProductionInHouse && g.consumablesRequired ? productionMen * days : 0, rateMargin(rates, "grindingConsumablesDayRate", rates.equipmentMargin), "Grinding Proposal!B49:H49"),
    line("Equipment", "Grinding equipment shipping", g.equipmentShipping, "round trip", useProductionInHouse && g.equipmentShipping ? 1 : 0, rates.equipmentMargin, "Grinding Proposal!B50:H50")
  );
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
  const productionHotelNights = s.productionHotelRequired ? num(s.productionHotelNights) * productionMen : 0;
  const surveyorHotelNights = s.surveyorHotelRequired || s.hotelRequired ? num(s.surveyorHotelNights || Math.ceil(days + days / Math.max(1, s.daysPerWeek) + 1)) * surveyors : 0;
  const productionKm = num(s.productionOneWayKm) * 2 * Math.max(1, num(s.productionVehicles));
  const surveyorKm = num(s.surveyorOneWayKm) * 2 * Math.max(1, num(s.surveyorVehicles));
  const toolDays = useProductionInHouse ? days : 0;
  const grinderCount = Math.max(0, num(s.propaneGrinders));
  const rows: Line[] = [
    line("Labour", "Screed surveyor labour", rates.surveyorDayRate, "surveyor day", useSurveyorInHouse ? surveyors * surveyorDays : 0, rateMargin(rates, "surveyorDayRate", 0), "Screed surveyor labour"),
    line("Labour", "Screed surveyor weekend extra", rates.productionWeekendDayRate, "surveyor day", useSurveyorInHouse ? surveyors * num(s.surveyorWeekendDays || s.weekendDaysPerWeek) : 0, rateMargin(rates, "productionWeekendDayRate", rates.defaultMargin), "Screed surveyor weekend allowance"),
    line("Labour", "Screed surveyor night-shift allowance", rates.productionNightShiftAllowance, "surveyor night", useSurveyorInHouse && s.nightShiftRequired ? surveyors * num(s.surveyorNightShifts || s.nightShifts) : 0, rateMargin(rates, "productionNightShiftAllowance", rates.defaultMargin), "Screed surveyor night shift allowance"),
    line("Travel", "Screed surveyor travel", rates.surveyorTravelDayRate, "surveyor day", useSurveyorInHouse ? surveyors * num(s.surveyorTravelDays) : 0, rateMargin(rates, "surveyorTravelDayRate", 0), "Screed surveyor travel days"),
    line("Travel", "Screed surveyor mileage", rates.mileagePerKm, "km", useSurveyorInHouse ? surveyorKm : 0, rateMargin(rates, "mileagePerKm", rates.travelMargin), "Screed surveyor one-way km x 2 x vehicles"),
    line("Hotel", "Screed surveyor hotel", rates.hotel, "night", useSurveyorInHouse ? surveyorHotelNights : 0, rateMargin(rates, "hotel", rates.hotelMargin), "Screed surveyor hotel nights x surveyors"),
    line("Subsistence", "Screed surveyor subsistence", rates.subsistence, "day", useSurveyorInHouse ? surveyorHotelNights : 0, rateMargin(rates, "subsistence", rates.subsistenceMargin), "Screed surveyor subsistence follows hotel nights"),
    line("Reports", "Screed engineering report", rates.engineeringReport, "item", useSurveyorInHouse && s.engineeringReport ? 1 : 0, rateMargin(rates, "engineeringReport", 0), "Screed engineering report"),
    line("Labour", "Screed production labour", rates.productionLabourDayRate, "man day", useProductionInHouse ? productionMen * productionDays : 0, rateMargin(rates, "productionLabourDayRate", rates.defaultMargin), "Screed production labour"),
    line("Labour", "Screed production weekend extra", rates.productionWeekendDayRate, "man day", useProductionInHouse ? productionMen * num(s.productionWeekendDays || s.weekendDaysPerWeek) : 0, rateMargin(rates, "productionWeekendDayRate", rates.defaultMargin), "Screed production weekend allowance"),
    line("Labour", "Screed production night-shift allowance", rates.productionNightShiftAllowance, "man night", useProductionInHouse && s.nightShiftRequired ? productionMen * num(s.productionNightShifts || s.nightShifts) : 0, rateMargin(rates, "productionNightShiftAllowance", rates.defaultMargin), "Screed production night shift allowance"),
    line("Travel", "Screed production travel", rates.productionLabourTravelDayRate, "man day", useProductionInHouse ? productionMen * num(s.productionTravelDays) : 0, rateMargin(rates, "productionLabourTravelDayRate", rates.travelMargin), "Screed production travel days"),
    line("Travel", "Screed production mileage", rates.mileagePerKm, "km", useProductionInHouse ? productionKm : 0, rateMargin(rates, "mileagePerKm", rates.travelMargin), "Screed production one-way km x 2 x vehicles"),
    line("Hotel", "Screed production hotel", rates.hotel, "night", useProductionInHouse ? productionHotelNights : 0, rateMargin(rates, "hotel", rates.hotelMargin), "Screed production hotel nights x men"),
    line("Subsistence", "Screed production subsistence", rates.subsistence, "day", useProductionInHouse ? productionHotelNights : 0, rateMargin(rates, "subsistence", rates.subsistenceMargin), "Screed production subsistence follows hotel nights")
  ];
  if (useSurveyorSubcontract) {
    s.surveyorSubcontractors.forEach((item) => {
      const qty = item.priceType === "day" ? item.days || surveyorDays : item.rate ? 1 : 0;
      rows.push(line("Subcontract", item.name || "Screed surveyor subcontractor", item.rate, item.priceType, qty, item.margin, "Screed surveyor subcontract labour"));
      rows.push(line("Subcontract", `${item.name || "Screed surveyor subcontractor"} mobilisation`, item.mobilisationCost, "mobilisation", item.mobilisations, item.mobilisationMargin, "Screed surveyor subcontract mobilisation"));
    });
  }
  if (useProductionSubcontract) {
    s.teams.forEach((team, index) => {
      const scope = [team.scabble && "scabble", team.prep && "prep", team.screed && "screed", team.grind && "grind"].filter(Boolean).join(", ");
      const label = `Screed subcontractor ${index + 1}${team.contractorName ? ` - ${team.contractorName}` : ""}`;
      rows.push(line("Subcontract", `${label} mobilisation`, team.mobilisation, "mobilisation", team.enabled && team.mobilisation ? 1 : 0, rates.subcontractMargin, `Screed subcontract mobilisation${scope ? ` (${scope})` : ""}`));
      rows.push(line("Subcontract", `${label} price on site`, team.rate, team.priceType, team.enabled ? (team.priceType === "day" ? team.daysProgrammed || days : 1) : 0, rates.subcontractMargin, `Screed subcontract rate${scope ? ` (${scope})` : ""}`));
    });
  }
  rows.push(
    line("Materials", "Screed material", s.screedMaterialRate, "bags", s.screedMaterialBags, s.screedMaterialMargin, "Screed Proposal!B48:H48"),
    line("Materials", "Primer", s.primerRate, "units", s.primerUnits, s.primerMargin, "Screed Proposal!B49:H49"),
    line("Materials", "Sand", s.sandRate, "bags", s.sandBags, s.sandMargin, "Screed Proposal!B50:H50"),
    line("Materials", "Shipping of materials", s.materialShipping, "return", s.materialShipping ? 1 : 0, rates.materialMargin, "Screed Proposal!B51:H51"),
    line("Equipment", "Screed generator", rates.screedSmallGeneratorDayRate, "day", useProductionInHouse ? s.generatorDays : 0, rateMargin(rates, "screedSmallGeneratorDayRate", rates.equipmentMargin), "Screed generator"),
    line("Equipment", "Screed large generator rental", s.largeGeneratorRate, "day", useProductionInHouse && s.largeGeneratorRequired ? Math.ceil(days) : 0, rates.equipmentMargin, "Screed large generator"),
    line("Equipment", "Screed large generator delivery", s.largeGeneratorDelivery, "item", useProductionInHouse && s.largeGeneratorRequired ? 1 : 0, rates.equipmentMargin, "Screed large generator delivery"),
    line("Equipment", "Screed large generator collection", s.largeGeneratorCollection, "item", useProductionInHouse && s.largeGeneratorRequired ? 1 : 0, rates.equipmentMargin, "Screed large generator collection"),
    line("Equipment", "Screed grinders", rates.screedDiamondGrinderPropaneDayRate, "grinder day", useProductionInHouse ? grinderCount * toolDays : 0, rateMargin(rates, "screedDiamondGrinderPropaneDayRate", rates.equipmentMargin), "Screed grinders"),
    line("Equipment", "Screed planers", rates.screedGasPlanerDayRate, "planer day", useProductionInHouse ? s.gasPlaners * toolDays : 0, rateMargin(rates, "screedGasPlanerDayRate", rates.equipmentMargin), "Screed planers"),
    line("Equipment", "Screed vacuums", rates.screedDustVacuumDayRate, "vacuum day", useProductionInHouse ? s.dustVacuums * toolDays : 0, rateMargin(rates, "screedDustVacuumDayRate", rates.equipmentMargin), "Screed vacuums"),
    line("Equipment", "Screed extension cords", rates.screedExtensionCordSetDayRate, "set day", useProductionInHouse ? s.extensionCordSets * toolDays : 0, rateMargin(rates, "screedExtensionCordSetDayRate", rates.equipmentMargin), "Screed extension cords"),
    line("Materials", "Screed grinding segments", rates.screedGrindingSegmentsDayRate, "grinder day", useProductionInHouse && s.grindingSegmentsRequired ? grinderCount * toolDays : 0, rateMargin(rates, "screedGrindingSegmentsDayRate", rates.equipmentMargin), "Screed grinding segments"),
    line("Materials", "Screed consumables", rates.screedConsumablesDayRate, "grinder day", useProductionInHouse && s.consumablesRequired ? Math.max(1, grinderCount) * toolDays : 0, rateMargin(rates, "screedConsumablesDayRate", rates.equipmentMargin), "Screed consumables"),
    line("Equipment", "Screed equipment shipping", s.equipmentShipping, "round trip", useProductionInHouse && s.equipmentShipping ? 1 : 0, rates.equipmentMargin, "Screed equipment shipping")
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
  const mobilisationKm = Math.max(0, r.mobilisationOneWayKm ?? 0) * 2 * Math.max(1, r.mobilisationVehicles ?? 1);
  const hotelRoomNights = r.hotelRequired ? r.hotelNights * inHouseMen : 0;
  const rows = [
    line("Labour", "In-house repair production labour", rates.productionLabourDayRate, "man day", inHouseMen * inHouseDays, rateMargin(rates, "productionLabourDayRate", rates.defaultMargin), "Repair labour mode + repair type output rates"),
    line("Labour", "Repair weekend extra", rates.productionWeekendDayRate, "man day", useInHouse && r.weekendRequired ? inHouseMen * r.weekendDays : 0, rateMargin(rates, "productionWeekendDayRate", rates.defaultMargin), "In-house repair weekend allowance per man per weekend day"),
    line("Labour", "Repair night-shift allowance", rates.productionNightShiftAllowance, "man night", useInHouse && r.nightShiftRequired ? inHouseMen * r.nightShiftHours : 0, rateMargin(rates, "productionNightShiftAllowance", rates.defaultMargin), "In-house repair night shift allowance per man per night"),
    line("Travel", "Repair production travel", rates.productionLabourTravelDayRate, "man day", useInHouse ? inHouseMen * r.travelDays : 0, rateMargin(rates, "productionLabourTravelDayRate", rates.travelMargin), "In-house repair mobilisation"),
    line("Hotel", "Repair hotel", rates.hotel, "room night", useInHouse ? hotelRoomNights : 0, rateMargin(rates, "hotel", rates.hotelMargin), "Hotel nights per team x in-house men"),
    line("Subsistence", "Repair subsistence", rates.subsistence, "day", useInHouse ? hotelRoomNights : 0, rateMargin(rates, "subsistence", rates.subsistenceMargin), "Follows hotel nights: nights per team x in-house men"),
    line("Travel", "Repair fuel", rates.repairFuelPerKm, "km", useInHouse ? mobilisationKm : 0, rateMargin(rates, "repairFuelPerKm", rates.travelMargin), "One-way km x 2 x vehicles")
  ];
  if (useSubcontract) {
    r.repairSubcontractors.forEach((item) => {
      const labourQty = item.priceType === "day" ? item.days : item.rate ? 1 : 0;
      rows.push(line("Subcontract", item.name || "Repair subcontractor", item.rate, item.priceType, labourQty, item.margin, "Repair subcontract labour incl. standard labour/equipment"));
      rows.push(line("Subcontract", `${item.name || "Repair subcontractor"} mobilisation`, item.mobilisationCost, "mobilisation", item.mobilisations, item.mobilisationMargin, "Repair subcontract mobilisation"));
    });
  }
  materialCalcs.forEach((calc) => rows.push(line("Materials", calc.product, calc.rate, calc.unit, calc.quantity, rates.materialMargin, calc.formula)));
  r.haulageItems.forEach((item) => rows.push(line("Haulage", item.name, item.rate, item.unit, item.quantity, item.margin, "Joint Repair haulage rows")));
  return rows;
}

export function calculateProject(input: ProjectInput, rates: AdminRates, repairCatalog: RepairCatalog = defaultRepairCatalog): ProjectCalculations {
  const gDays = grindingDays(input);
  const sDays = screedDays(input);
  const rDays = repairDays(input, repairCatalog);
  const siteDays = Math.max(gDays, sDays, rDays);
  const people = Math.max(1, input.grinding.surveyorCount || input.screeding.surveyors || input.repairs.labourMen || 1);
  const catalogueMaterialCalcs = input.includeRepairs && input.repairs.enabled ? input.repairs.repairLines.flatMap((repairLine) => calculateRepairLineMaterials(repairLine, repairCatalog)) : [];
  const repairMaterialCalcs = catalogueMaterialCalcs;
  const serviceLines = [
    ...grindingLines(input, rates),
    ...screedLines(input, rates),
    ...repairLines(input, rates, repairMaterialCalcs, repairCatalog),
    ...travelLines(input, rates, people, siteDays)
  ];
  input.additionalItems.forEach((item) => serviceLines.push(line("Additional items", item.name, item.rate, item.unit, item.quantity, item.margin, "Additional item", item.plCategory ?? "Equipment")));
  const originalProposalTotal = money(serviceLines.reduce((sum, row) => sum + row.total, 0));
  const discountAmount = money(originalProposalTotal * Math.min(Math.max(input.discountPercentage, 0), 100) / 100);
  const proposalLines = serviceLines.map((row) => {
    const discount = originalProposalTotal ? money(discountAmount * (row.originalTotal / originalProposalTotal)) : 0;
    return { ...row, discount, total: money(row.originalTotal - discount) };
  });
  const budgetLines = serviceLines.map((row) => ({ ...row, margin: 0, discount: 0, total: row.cost, originalTotal: row.cost }));
  const proposalTotal = money(proposalLines.reduce((sum, row) => sum + row.total, 0));
  const budgetCost = money(budgetLines.reduce((sum, row) => sum + row.total, 0));
  const budgetProfit = money(proposalTotal - budgetCost);
  const budgetMargin = proposalTotal ? pct(budgetProfit / proposalTotal) : 0;
  const services = [input.includeGrinding && input.grinding.enabled && "Grinding", input.includeScreeding && input.screeding.enabled && "Screeding", input.includeRepairs && input.repairs.enabled && "Repairs"].filter(Boolean).join(" + ") || "Draft";
  const dailyRate = money(proposalLines.filter((row) => !["Travel", "Subcontract", "Haulage", "Reports", "Additional items"].includes(row.section)).reduce((sum, row) => sum + row.total, 0) / Math.max(1, siteDays));
  const mobilisationRate = money(proposalLines.filter((row) => ["Travel", "Subcontract", "Haulage", "Reports"].includes(row.section)).reduce((sum, row) => sum + row.total, 0));
  return {
    projectReference: input.projectReference,
    client: input.client,
    location: input.location,
    serviceSummary: services,
    grindingDays: gDays,
    screedDays: sDays,
    repairDays: rDays,
    siteDays,
    proposalLines,
    budgetLines,
    repairMaterialCalcs,
    originalProposalTotal,
    discountAmount,
    proposalTotal,
    budgetCost,
    budgetProfit,
    budgetMargin,
    dailyRate,
    mobilisationRate,
    standbyRate: money(rates.hotel * (1 + rateMargin(rates, "hotel", rates.hotelMargin)) + rates.subsistence * (1 + rateMargin(rates, "subsistence", rates.subsistenceMargin)))
  };
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
    daysTakenToComplete: calculations.siteDays,
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
    other: 0
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
  const budgetWhere = (predicate: (line: Line) => boolean) => money(calculations.budgetLines.filter(predicate).reduce((sum, row) => sum + row.total, 0));
  const budget = (category: PLCategory) => budgetWhere((row) => (row.plCategory ?? sectionPLCategory(row.section)) === category);
  const itemIncludes = (line: Line, text: string) => line.item.toLowerCase().includes(text);
  const engineeringBudget = budgetWhere((row) => itemIncludes(row, "engineering report"));
  const surveyDayBudget = budgetWhere((row) => itemIncludes(row, "surveyor labour") || itemIncludes(row, "screed surveyor labour"));
  const surveyTravelBudget = budgetWhere((row) => itemIncludes(row, "surveyor travel"));
  const labourInternalBudget = budgetWhere((row) => (row.plCategory ?? sectionPLCategory(row.section)) === "Labour" && !itemIncludes(row, "surveyor") && !itemIncludes(row, "engineering report"));
  const travelBudget = budgetWhere((row) => (row.plCategory ?? sectionPLCategory(row.section)) === "Travel" && !itemIncludes(row, "surveyor travel"));
  const bonus = money(num(actuals.actualPrice) * 0.01);
  const rows = [
    { section: "Labour Internal", item: "Labour Internal", actual: money(num(actuals.labourInternal) + num(actuals.repairs)), budget: labourInternalBudget },
    { section: "Labour Internal", item: "Survey Days", actual: money(num(actuals.surveyDays || actuals.labourInternalDays) * num(actuals.surveyDayRate || actuals.labourInternalRate)), budget: surveyDayBudget },
    { section: "Labour Internal", item: "Survey Travel Days", actual: money(num(actuals.surveyTravelDays) * num(actuals.surveyTravelRate)), budget: surveyTravelBudget },
    { section: "Labour Internal", item: "Bonus", actual: bonus, budget: bonus },
    { section: "Labour Subcontract", item: "Labour Subcontract", actual: num(actuals.labourSubcontract), budget: budget("Subcontract") },
    { section: "Equipment", item: "Equipment Rental", actual: num(actuals.equipmentRental), budget: budget("Equipment") },
    { section: "Haulage", item: "Haulage", actual: num(actuals.haulage), budget: budget("Haulage") },
    { section: "Materials", item: "Materials", actual: num(actuals.materials), budget: budget("Materials") },
    { section: "Reports", item: "Engineering Report", actual: num(actuals.engineeringReport), budget: engineeringBudget },
    { section: "Travel", item: "Travel", actual: num(actuals.travel), budget: travelBudget },
    { section: "Hotel/Subsistence", item: "Hotel", actual: num(actuals.hotel), budget: budgetWhere((row) => row.section === "Hotel") },
    { section: "Hotel/Subsistence", item: "Subsistence", actual: num(actuals.subsistence), budget: budgetWhere((row) => row.section === "Subsistence") },
    { section: "Other", item: "Other", actual: num(actuals.other), budget: 0 }
  ].map((row) => ({ ...row, variance: money(row.budget - row.actual) }));
  const actualCost = money(rows.reduce((sum, row) => sum + row.actual, 0));
  const actualProfit = money(actuals.actualPrice - actualCost);
  const actualMargin = actuals.actualPrice ? pct(actualProfit / actuals.actualPrice) : 0;
  const budgetProfit = money(actuals.actualPrice - calculations.budgetCost);
  const budgetMargin = actuals.actualPrice ? pct(budgetProfit / actuals.actualPrice) : 0;
  const actualDays = num(actuals.daysTakenToComplete) || calculateActualSiteDays(actuals);
  const programmeStatus = actualDays <= calculations.siteDays + 0.1 ? "PROJECT COMPLETED ON TIME" : "PROJECT RUN OVER TIME";
  return { rows, actualCost, actualProfit, actualMargin, budgetProfit, budgetMargin, programmeStatus };
}

export function searchRowTone(record: { accountsStatus: string; actuals?: PLActuals; calculations: ProjectCalculations }) {
  if (record.accountsStatus !== "Actuals Saved" || !record.actuals) return "yellow";
  return calculatePL(record.calculations, record.actuals).actualMargin >= 25 ? "green" : "red";
}
