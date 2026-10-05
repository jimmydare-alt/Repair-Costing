import type { CommercialRateSchedule, Line, PackagePricingBasis, PLCategory, ProjectCalculations, Section } from "../../types";
import { distanceRateUnit } from "../../company";
import { normaliseQaRates } from "./defaults";
import type { QaAdminRates, QaArea, QaAreaCalculation, QaCalculationResult, QaInput, QaRateDefinition, QaRateKey, QaRateOverride, QaVisit } from "./types";

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const safe = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export function qaRatesInQuoteCurrency(savedRates: Partial<QaAdminRates> | undefined, companyCurrencyPerQuoteCurrency: number) {
  const rates = normaliseQaRates(savedRates);
  const divisor = Number(companyCurrencyPerQuoteCurrency) > 0 ? Number(companyCurrencyPerQuoteCurrency) : 1;
  return {
    rates: Object.fromEntries(Object.entries(rates.rates).map(([key, rate]) => [key, { ...rate, budgetRate: rate.budgetRate / divisor }])) as QaAdminRates["rates"]
  };
}

function usesDelivery(mode: QaArea["designDeliveryMode"], delivery: QaRateDefinition["delivery"]) {
  return mode === "both" || (mode === "in_house" && delivery === "internal") || (mode === "subcontract" && delivery === "subcontract");
}

function resolvedRate(definition: QaRateDefinition, override?: QaRateOverride) {
  return {
    budgetRate: override?.budgetRate == null ? definition.budgetRate : safe(override.budgetRate),
    markup: override?.markup == null ? definition.markup : safe(override.markup)
  };
}

function line(definition: QaRateDefinition, quantity: number, area: QaArea, override?: QaRateOverride, label?: string): Line {
  const resolved = resolvedRate(definition, override);
  const cost = money(resolved.budgetRate * safe(quantity));
  const total = money(cost * (1 + resolved.markup));
  return {
    section: definition.section,
    item: label ?? `${area.name} - ${definition.label}`,
    rate: resolved.budgetRate,
    unit: definition.unit,
    quantity: safe(quantity),
    cost,
    margin: money(total - cost),
    total,
    discount: 0,
    originalTotal: total,
    source: override && (override.budgetRate !== null || override.markup !== null) ? `QA project override: ${override.reason || "reason not entered"}` : "QA admin rate",
    plCategory: definition.plCategory,
    workPackageId: area.id,
    workPackageName: area.name,
    commercialGroup: "package",
    costKind: definition.group === "travel" ? "mobilisation" : definition.key.includes("StandDown") ? "stand_down" : "operating"
  };
}

function visitQuantities(visit: QaVisit): Partial<Record<QaRateKey, number>> {
  const prefix = visit.delivery === "subcontract" ? "subcontract" : "internal";
  return {
    [`${prefix}SupervisionDay` as QaRateKey]: safe(visit.siteDays) * Math.max(1, safe(visit.people)),
    [`${prefix}TravelDay` as QaRateKey]: safe(visit.travelDays) * Math.max(1, safe(visit.people)),
    [`${prefix}HotelNight` as QaRateKey]: safe(visit.hotelNights) * Math.max(1, safe(visit.people)),
    [`${prefix}SubsistenceDay` as QaRateKey]: safe(visit.subsistenceDays) * Math.max(1, safe(visit.people)),
    [`${prefix}VehicleDay` as QaRateKey]: safe(visit.vehicleDays) * safe(visit.vehicles),
    [`${prefix}Distance` as QaRateKey]: safe(visit.oneWayDistance) * 2 * safe(visit.vehicles),
    [`${prefix}EquipmentTransport` as QaRateKey]: safe(visit.equipmentTransportTrips)
  };
}

export function calculateQaProgrammeDefaults(input: QaInput) {
  const programme = input.programme;
  if (!programme) return null;
  const visits = Math.max(1, Math.round(safe(programme.visits)));
  const totalTravelDays = money(safe(programme.travelDaysEachWay) * 2 * visits);
  const calculatedHotelNightsPerPerson = programme.hotelRequired
    ? money(safe(programme.siteDays) + visits + safe(programme.nonSupervisionDays) + safe(programme.standDownDays))
    : 0;
  const calculatedSubsistenceDaysPerPerson = programme.hotelRequired
    ? money(safe(programme.siteDays) + totalTravelDays + safe(programme.nonSupervisionDays) + safe(programme.standDownDays))
    : 0;
  const hotelNightsPerPerson = programme.hotelNightsOverride ?? calculatedHotelNightsPerPerson;
  const subsistenceDaysPerPerson = programme.subsistenceDaysOverride ?? calculatedSubsistenceDaysPerPerson;
  return {
    siteDays: safe(programme.siteDays),
    visits,
    totalTravelDays,
    calculatedHotelNightsPerPerson,
    hotelNightsPerPerson: safe(hotelNightsPerPerson),
    hotelNightsOverridden: programme.hotelNightsOverride !== null && safe(programme.hotelNightsOverride) !== calculatedHotelNightsPerPerson,
    calculatedSubsistenceDaysPerPerson,
    subsistenceDaysPerPerson: safe(subsistenceDaysPerPerson),
    subsistenceDaysOverridden: programme.subsistenceDaysOverride !== null && safe(programme.subsistenceDaysOverride) !== calculatedSubsistenceDaysPerPerson,
    vehicleDays: money(safe(programme.siteDays) + totalTravelDays + safe(programme.nonSupervisionDays) + safe(programme.standDownDays)),
    chargeableDistance: money(safe(programme.oneWayDistance) * 2 * Math.max(1, safe(programme.vehicles)) * visits)
  };
}

function proposalLineFromAdditional(item: QaInput["additionalItems"][number]): Line {
  const cost = money(safe(item.budgetRate) * safe(item.quantity));
  const total = money(cost * (1 + safe(item.markup)));
  return {
    section: "Additional items", item: item.name, rate: safe(item.budgetRate), unit: item.unit, quantity: safe(item.quantity),
    cost, margin: money(total - cost), total, discount: 0, originalTotal: total, source: "QA project item", plCategory: item.plCategory
  };
}

function guidedQuantity(area: QaArea, definition: QaRateDefinition) {
  const people = definition.delivery === "internal" ? Math.max(1, safe(area.internalPeople)) : Math.max(1, safe(area.subcontractPeople));
  if (definition.group === "design") return safe(area.quantities[definition.key]);
  if (definition.key.endsWith("SupervisionDay")) return safe(area.siteDays);
  if (definition.key.endsWith("NonSupervisionDay")) return safe(area.nonSupervisionDays);
  if (definition.key.endsWith("StandDownDay")) return safe(area.standDownDays);
  if (definition.key.endsWith("TravelDay")) return safe(area.travelDays) * people;
  if (definition.key.endsWith("HotelNight")) return safe(area.hotelNights) * people;
  if (definition.key.endsWith("SubsistenceDay")) return safe(area.subsistenceDays) * people;
  if (definition.key.endsWith("VehicleDay")) return safe(area.vehicleDays) * Math.max(1, safe(area.vehicles));
  if (definition.key.endsWith("Distance")) return safe(area.oneWayDistance) * 2 * Math.max(1, safe(area.vehicles));
  if (definition.key.endsWith("EquipmentTransport")) return safe(area.equipmentTransportTrips);
  return safe(area.quantities[definition.key]);
}

function budgetFromProposal(item: Line): Line {
  return { ...item, margin: 0, total: item.cost, originalTotal: item.cost, discount: 0 };
}

function areaLines(area: QaArea, rates: QaAdminRates, travelIncludedElsewhere: boolean, projectProgramme: boolean) {
  const lines: Line[] = [];
  Object.values(rates.rates).forEach((definition) => {
    const relevant = definition.group === "design"
      ? area.designReviewRequired && usesDelivery(area.designDeliveryMode, definition.delivery)
      : definition.group === "supervision"
        ? area.supervisionRequired && usesDelivery(area.supervisionDeliveryMode, definition.delivery)
        : (area.designReviewRequired && usesDelivery(area.designDeliveryMode, definition.delivery)) || (area.supervisionRequired && usesDelivery(area.supervisionDeliveryMode, definition.delivery));
    if (!relevant || (projectProgramme && definition.group !== "design") || (travelIncludedElsewhere && definition.group === "travel")) return;
    let quantity = area.guidedSchedule ? guidedQuantity(area, definition) : safe(area.quantities[definition.key]);
    if (definition.group === "supervision" && definition.unit === "person day") {
      quantity *= definition.delivery === "internal" ? Math.max(1, safe(area.internalPeople)) : Math.max(1, safe(area.subcontractPeople));
    }
    if (quantity > 0) lines.push(line(definition, quantity, area, area.rateOverrides[definition.key]));
  });

  if (!projectProgramme) area.extraVisits.forEach((visit) => {
    const quantities = visitQuantities(visit);
    Object.entries(quantities).forEach(([key, quantity]) => {
      const definition = rates.rates[key as QaRateKey];
      if (!definition || safe(quantity) <= 0 || (travelIncludedElsewhere && definition.group === "travel")) return;
      lines.push(line(definition, safe(quantity), area, area.rateOverrides[key as QaRateKey], `${area.name} - ${visit.name} - ${definition.label}`));
    });
  });
  return lines;
}

function programmeLines(input: QaInput, rates: QaAdminRates, travelIncludedElsewhere: boolean) {
  const programme = calculateQaProgrammeDefaults(input);
  if (!programme || !input.programme || !input.siteSupervisionIncluded) return [];
  const lines: Line[] = [];
  const rateOverrides = input.programme.rateOverrides ?? {};
  const deliveries: QaRateDefinition["delivery"][] = ["internal", "subcontract"];
  deliveries.forEach((delivery) => {
    const sourceArea = input.areas.find((area) => area.supervisionRequired && usesDelivery(area.supervisionDeliveryMode, delivery));
    if (!sourceArea) return;
    const prefix = delivery === "internal" ? "internal" : "subcontract";
    const people = delivery === "internal" ? input.programme!.internalPeople : input.programme!.subcontractPeople;
    const quantities: Partial<Record<QaRateKey, number>> = {
      [`${prefix}SupervisionDay` as QaRateKey]: programme.siteDays * Math.max(1, safe(people)),
      [`${prefix}NonSupervisionDay` as QaRateKey]: safe(input.programme!.nonSupervisionDays) * Math.max(1, safe(people)),
      [`${prefix}StandDownDay` as QaRateKey]: safe(input.programme!.standDownDays) * Math.max(1, safe(people)),
      [`${prefix}TravelDay` as QaRateKey]: programme.totalTravelDays * Math.max(1, safe(people)),
      [`${prefix}HotelNight` as QaRateKey]: programme.hotelNightsPerPerson * Math.max(1, safe(people)),
      [`${prefix}SubsistenceDay` as QaRateKey]: programme.subsistenceDaysPerPerson * Math.max(1, safe(people)),
      [`${prefix}VehicleDay` as QaRateKey]: programme.vehicleDays * Math.max(1, safe(input.programme!.vehicles)),
      [`${prefix}Distance` as QaRateKey]: programme.chargeableDistance,
      [`${prefix}EquipmentTransport` as QaRateKey]: programme.visits
    };
    Object.entries(quantities).forEach(([key, quantity]) => {
      const definition = rates.rates[key as QaRateKey];
      if (!definition || safe(quantity) <= 0 || (travelIncludedElsewhere && definition.group === "travel")) return;
      const programmeArea = { ...sourceArea, id: "qa-programme", name: "QA Programme", rateOverrides };
      lines.push(line(definition, safe(quantity), programmeArea, rateOverrides[key as QaRateKey], `QA Programme - ${definition.label}`));
    });
  });
  return lines;
}

function schedule(area: QaArea, name: string, basis: PackagePricingBasis, lines: Line[], days: number): CommercialRateSchedule {
  const budget = money(lines.reduce((sum, item) => sum + item.cost, 0));
  const proposal = money(lines.reduce((sum, item) => sum + item.total, 0));
  const divisor = basis === "day_rate" ? Math.max(1, days) : 1;
  const overrides = Object.values(area.rateOverrides).filter((item) => item && (item.budgetRate !== null || item.markup !== null));
  return {
    workPackageId: area.id,
    workPackageName: `${area.name} - ${name}`,
    service: "QA",
    pricingBasis: basis,
    estimatedDays: days,
    productiveBudgetRate: money(budget / divisor),
    productiveProposalRate: money(proposal / divisor),
    productiveRateOverridden: overrides.length > 0,
    mobilisationBudget: 0,
    mobilisationProposal: 0,
    standbyBudgetRate: 0,
    standbyProposalRate: 0,
    standbyRateOverridden: false,
    expectedStandDownDays: 0,
    overrideReason: overrides.map((item) => item?.reason).filter(Boolean).join("; ")
  };
}

export function calculateQaProject(input: QaInput, savedRates?: Partial<QaAdminRates>): QaCalculationResult {
  const companyExchange = Number(input.exchangeRateToCompanyCurrency) > 0 ? Number(input.exchangeRateToCompanyCurrency) : 1;
  const groupExchange = Number(input.exchangeRateToGroupCurrency) > 0 ? Number(input.exchangeRateToGroupCurrency) : 1;
  const rates = qaRatesInQuoteCurrency(savedRates, companyExchange);
  const travelIncludedElsewhere = Boolean(input.sharedTravelOwnerProjectId);
  const projectProgramme = Boolean(input.programme);
  const proposalLines = input.areas.flatMap((area) => areaLines(area, rates, travelIncludedElsewhere, projectProgramme));
  proposalLines.push(...programmeLines(input, rates, travelIncludedElsewhere));
  proposalLines.push(...input.additionalItems.filter((item) => item.name.trim() && item.quantity > 0).map(proposalLineFromAdditional));

  const originalProposalBeforeAdjustment = money(proposalLines.reduce((sum, item) => sum + item.total, 0));
  const discountPercentage = Math.min(100, safe(input.discountPercentage));
  const discountAmount = money(originalProposalBeforeAdjustment * discountPercentage / 100);
  const discountedLines = proposalLines.map((item) => {
    const discount = originalProposalBeforeAdjustment ? money(discountAmount * item.originalTotal / originalProposalBeforeAdjustment) : 0;
    return { ...item, discount, total: money(item.originalTotal - discount) };
  });
  const adjustment = Number.isFinite(Number(input.proposalAdjustment)) ? Number(input.proposalAdjustment) : 0;
  if (adjustment !== 0) {
    discountedLines.push({
      section: "Additional items", item: `Proposal Adjustment${input.proposalAdjustmentReason ? ` - ${input.proposalAdjustmentReason}` : ""}`,
      rate: 0, unit: "adjustment", quantity: 1, cost: 0, margin: money(adjustment), total: money(adjustment), discount: 0,
      originalTotal: money(adjustment), source: "QA final proposal adjustment", plCategory: "Labour", commercialGroup: "common"
    });
  }
  const budgetLines = proposalLines.map(budgetFromProposal);
  const proposalTotal = money(discountedLines.reduce((sum, item) => sum + item.total, 0));
  const budgetCost = money(budgetLines.reduce((sum, item) => sum + item.total, 0));
  const budgetProfit = money(proposalTotal - budgetCost);
  const budgetMargin = proposalTotal ? money(budgetProfit / proposalTotal * 100) : 0;
  const budgetMarkup = budgetCost ? money(budgetProfit / budgetCost * 100) : 0;
  const areaDetails: QaAreaCalculation[] = input.areas.map((area) => {
    const areaProposalLines = discountedLines.filter((item) => item.workPackageId === area.id);
    const designKeys = new Set(Object.values(rates.rates).filter((item) => item.group === "design").map((item) => item.label));
    const designLines = areaProposalLines.filter((item) => Array.from(designKeys).some((label) => item.item.endsWith(label)));
    const travelKeys = new Set(Object.values(rates.rates).filter((item) => item.group === "travel").map((item) => item.label));
    const travelLines = areaProposalLines.filter((item) => Array.from(travelKeys).some((label) => item.item.endsWith(label)));
    const supervisionLines = areaProposalLines.filter((item) => !designLines.includes(item) && !travelLines.includes(item));
    const designBudgetLines = budgetLines.filter((item) => item.workPackageId === area.id && Array.from(designKeys).some((label) => item.item.endsWith(label)));
    const travelBudgetLines = budgetLines.filter((item) => item.workPackageId === area.id && Array.from(travelKeys).some((label) => item.item.endsWith(label)));
    const supervisionBudgetLines = budgetLines.filter((item) => item.workPackageId === area.id && !designBudgetLines.includes(item) && !travelBudgetLines.includes(item));
    const internalDays = !projectProgramme && area.supervisionRequired && usesDelivery(area.supervisionDeliveryMode, "internal") ? (area.guidedSchedule ? safe(area.siteDays) : safe(area.quantities.internalSupervisionDay)) : 0;
    const subcontractDays = !projectProgramme && area.supervisionRequired && usesDelivery(area.supervisionDeliveryMode, "subcontract") ? (area.guidedSchedule ? safe(area.siteDays) : safe(area.quantities.subcontractSupervisionDay)) : 0;
    const visitDays = projectProgramme ? 0 : area.extraVisits.reduce((sum, visit) => sum + safe(visit.siteDays), 0);
    const supervisionDays = projectProgramme && area.supervisionRequired ? safe(input.programme?.siteDays) : Math.max(internalDays, subcontractDays) + visitDays;
    return {
      id: area.id,
      name: area.name,
      areaM2: safe(area.areaM2),
      designReviewProposal: money(designLines.reduce((sum, item) => sum + item.total, 0)),
      designReviewBudget: money(designBudgetLines.reduce((sum, item) => sum + item.total, 0)),
      supervisionProposal: money(supervisionLines.reduce((sum, item) => sum + item.total, 0)),
      supervisionBudget: money(supervisionBudgetLines.reduce((sum, item) => sum + item.total, 0)),
      travelProposal: money(travelLines.reduce((sum, item) => sum + item.total, 0)),
      travelBudget: money(travelBudgetLines.reduce((sum, item) => sum + item.total, 0)),
      supervisionDays,
      productivityM2PerDay: supervisionDays > 0 ? money(safe(area.areaM2) / supervisionDays) : 0
    };
  });
  const siteDays = projectProgramme ? safe(input.programme?.siteDays) : money(areaDetails.reduce((sum, area) => sum + area.supervisionDays, 0));
  const rateSchedules = input.areas.flatMap((area) => {
    const lines = discountedLines.filter((item) => item.workPackageId === area.id);
    const designLabels = new Set(Object.values(rates.rates).filter((item) => item.group === "design").map((item) => item.label));
    const designLines = lines.filter((item) => Array.from(designLabels).some((label) => item.item.endsWith(label)));
    const travelLabels = new Set(Object.values(rates.rates).filter((item) => item.group === "travel").map((item) => item.label));
    const travelLines = lines.filter((item) => Array.from(travelLabels).some((label) => item.item.endsWith(label)));
    const supervisionLines = lines.filter((item) => !designLines.includes(item) && !travelLines.includes(item));
    const details = areaDetails.find((item) => item.id === area.id)!;
    return [
      ...(area.designReviewRequired ? [schedule(area, "Design Review", area.designPricingBasis, designLines, 0)] : []),
      ...(!projectProgramme && area.supervisionRequired ? [schedule(area, "Site Supervision", area.supervisionPricingBasis, supervisionLines, details.supervisionDays)] : [])
    ];
  });
  if (projectProgramme && input.siteSupervisionIncluded) {
    const programmeArea = input.areas.find((area) => area.supervisionRequired) ?? input.areas[0];
    const programmeCostLines = discountedLines.filter((item) => item.workPackageId === "qa-programme");
    if (programmeArea) rateSchedules.push(schedule({ ...programmeArea, id: "qa-programme", name: "QA Programme", rateOverrides: input.programme!.rateOverrides ?? {} }, "Site Supervision", programmeArea.supervisionPricingBasis, programmeCostLines, siteDays));
  }
  const mobilisationLines = discountedLines.filter((item) => item.costKind === "mobilisation");
  const mobilisationBudgetLines = budgetLines.filter((item) => item.costKind === "mobilisation");
  const details = {
    areas: areaDetails,
    designReviewProposal: money(areaDetails.reduce((sum, item) => sum + item.designReviewProposal, 0)),
    designReviewBudget: money(areaDetails.reduce((sum, item) => sum + item.designReviewBudget, 0)),
    supervisionProposal: money(discountedLines.filter((item) => item.workPackageId === "qa-programme" && item.costKind !== "mobilisation").reduce((sum, item) => sum + item.total, 0) + areaDetails.reduce((sum, item) => sum + item.supervisionProposal, 0)),
    supervisionBudget: money(budgetLines.filter((item) => item.workPackageId === "qa-programme" && item.costKind !== "mobilisation").reduce((sum, item) => sum + item.total, 0) + areaDetails.reduce((sum, item) => sum + item.supervisionBudget, 0)),
    travelProposal: money(discountedLines.filter((item) => item.workPackageId === "qa-programme" && item.costKind === "mobilisation").reduce((sum, item) => sum + item.total, 0) + areaDetails.reduce((sum, item) => sum + item.travelProposal, 0)),
    travelBudget: money(budgetLines.filter((item) => item.workPackageId === "qa-programme" && item.costKind === "mobilisation").reduce((sum, item) => sum + item.total, 0) + areaDetails.reduce((sum, item) => sum + item.travelBudget, 0)),
    overrideCount: input.areas.reduce((sum, area) => sum + Object.values(area.rateOverrides).filter((item) => item && (item.budgetRate !== null || item.markup !== null)).length, 0)
      + Object.values(input.programme?.rateOverrides ?? {}).filter((item) => item && (item.budgetRate !== null || item.markup !== null)).length,
    linkedProjectIds: input.linkedProjectIds,
    programme: calculateQaProgrammeDefaults(input) ?? undefined
  };
  const result: ProjectCalculations = {
    costingModule: "qa",
    projectReference: input.projectReference,
    client: input.client,
    location: input.location,
    serviceSummary: `QA - ${input.areas.length} area${input.areas.length === 1 ? "" : "s"}`,
    grindingDays: 0, screedDays: 0, repairDays: 0, siteDays,
    phaseRows: [], proposalLines: discountedLines, budgetLines, repairMaterialCalcs: [],
    originalProposalTotal: money(originalProposalBeforeAdjustment + adjustment), discountAmount, proposalTotal, budgetCost,
    budgetProfit, budgetMargin, budgetMarkup, bdmBonusBudget: 0, bdmBonusRate: 0,
    proposalCompanyCurrency: money(proposalTotal * companyExchange), budgetCompanyCurrency: money(budgetCost * companyExchange), proposalGroupCurrency: money(proposalTotal * groupExchange), budgetGroupCurrency: money(budgetCost * groupExchange),
    dailyRate: money(rateSchedules.filter((item) => item.pricingBasis === "day_rate").reduce((sum, item) => sum + item.productiveProposalRate, 0)),
    mobilisationRate: money(mobilisationLines.reduce((sum, item) => sum + item.total, 0)),
    mobilisationBudget: money(mobilisationBudgetLines.reduce((sum, item) => sum + item.total, 0)),
    travelTotal: money(discountedLines.filter((item) => item.plCategory === "Travel").reduce((sum, item) => sum + item.total, 0)),
    haulageTotal: money(discountedLines.filter((item) => item.plCategory === "Haulage").reduce((sum, item) => sum + item.total, 0)),
    standbyRate: money(discountedLines.filter((item) => item.costKind === "stand_down").reduce((sum, item) => sum + item.total, 0)),
    rateSchedules,
    qa: details
  };
  return result as QaCalculationResult;
}

export function qaRateUnit(rate: QaRateDefinition, distanceUnit: QaInput["distanceUnit"]) {
  return rate.key.endsWith("Distance") ? distanceRateUnit(distanceUnit) : rate.unit;
}
