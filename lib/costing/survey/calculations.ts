import type { Line, PLCategory, ProjectCalculations, Section } from "../../types";
import { distanceRateUnit } from "../../company";
import { defaultSurveyRates, normaliseSurveyRates } from "./defaults";
import type { SurveyAdminRates, SurveyCalculationResult, SurveyInput } from "./types";
import { isSurveyQuantityActive } from "./rules";
import { officeJourneyDistance } from "../../travel";

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const safe = (value: number) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const output = (value: number, fallback: number) => value > 0 ? value : fallback;

function rawSurveyDays(input: SurveyInput, rates: SurveyAdminRates) {
  return (isSurveyQuantityActive(input.surveyType, "autoStoreArea") ? safe(input.autoStoreArea) / output(rates.dailyOutputAutoStoreArea, defaultSurveyRates.dailyOutputAutoStoreArea) : 0)
    + (isSurveyQuantityActive(input.surveyType, "fminRuns") ? safe(input.fminRuns) / output(rates.dailyOutputFminRuns, defaultSurveyRates.dailyOutputFminRuns) : 0)
    + (isSurveyQuantityActive(input.surveyType, "exotecRuns") ? safe(input.exotecRuns) / output(rates.dailyOutputExotecRuns, defaultSurveyRates.dailyOutputExotecRuns) : 0)
    + (isSurveyQuantityActive(input.surveyType, "exotecArea") ? safe(input.exotecArea) / output(rates.dailyOutputExotecArea, defaultSurveyRates.dailyOutputExotecArea) : 0)
    + (isSurveyQuantityActive(input.surveyType, "roboticsArea") ? safe(input.roboticsArea) / output(rates.dailyOutputRoboticsArea, defaultSurveyRates.dailyOutputRoboticsArea) : 0)
    + (isSurveyQuantityActive(input.surveyType, "levelSurveyArea") ? safe(input.levelSurveyArea) / output(rates.dailyOutputLevelSurveyArea, defaultSurveyRates.dailyOutputLevelSurveyArea) : 0)
    + (isSurveyQuantityActive(input.surveyType, "profRunsOnly") ? safe(input.profRunsOnly) / output(rates.dailyOutputProfRunsOnly, defaultSurveyRates.dailyOutputProfRunsOnly) : 0)
    + safe(input.additionalDays);
}

export function calculateSurveyDayRequirement(input: SurveyInput, rates?: Partial<SurveyAdminRates>) {
  const merged = normaliseSurveyRates(rates);
  const raw = rawSurveyDays(input, merged);
  return raw > 0 ? money(raw / Math.max(1, safe(input.surveyorsOnSite))) : 0;
}

export function calculateSurveySiteDays(input: SurveyInput, rates?: Partial<SurveyAdminRates>) {
  const requirement = calculateSurveyDayRequirement(input, rates);
  return requirement > 0 ? Math.ceil(requirement) : 0;
}

export function calculateSurveyDistance(input: SurveyInput) {
  const roundTripDistance = officeJourneyDistance(input.officeCount, input.primaryOfficeDistanceOneWay, input.secondaryOfficeDistanceOneWay);
  return money(roundTripDistance * safe(input.numberOfCars));
}

function budgetLine(section: Section, item: string, rate: number, unit: string, quantity: number, plCategory: PLCategory): Line {
  const cost = money(safe(rate) * safe(quantity));
  return { section, item, rate: safe(rate), unit, quantity: safe(quantity), cost, margin: 0, total: cost, discount: 0, originalTotal: cost, source: "Survey costing engine", plCategory };
}

function proposalLine(section: Section, item: string, budgetRate: number, unit: string, quantity: number, markup: number, plCategory: PLCategory, sellRate?: number): Line {
  const cost = money(safe(budgetRate) * safe(quantity));
  const total = money((sellRate === undefined ? safe(budgetRate) * (1 + safe(markup)) : safe(sellRate)) * safe(quantity));
  return { section, item, rate: safe(budgetRate), unit, quantity: safe(quantity), cost, margin: money(total - cost), total, discount: 0, originalTotal: total, source: "Survey costing engine", plCategory };
}

export function calculateSurveyProject(input: SurveyInput, savedRates?: Partial<SurveyAdminRates>): SurveyCalculationResult {
  const rates = normaliseSurveyRates(savedRates);
  const subcontracted = input.surveyorSupply === "Subcontracted";
  const pmRequired = Boolean(input.projectManagerRequired);
  const travelPackageRequired = !subcontracted || pmRequired;
  const surveyors = safe(input.surveyorsOnSite);
  const labourers = input.labourerRequired ? safe(input.numberOfLabourers) : 0;
  const calculatedDayRequirement = calculateSurveyDayRequirement(input, rates);
  const calculatedSiteDays = calculateSurveySiteDays(input, rates);
  const hasSiteDaysOverride = input.siteDaysOverride !== null && Number.isFinite(Number(input.siteDaysOverride));
  const days = hasSiteDaysOverride ? Math.max(0, Math.round(Number(input.siteDaysOverride))) : calculatedSiteDays;
  const surveyorDays = subcontracted ? 0 : days * surveyors;
  const pmDays = pmRequired ? days : 0;
  const labourerDays = subcontracted ? 0 : days * labourers;
  const travelDaysEach = input.travelMode === "Drive" ? Math.ceil(safe(input.driveTimeOneWayDays)) * 2 : 2;
  const surveyorTravelDays = subcontracted ? 0 : travelDaysEach * surveyors;
  const pmTravelDays = pmRequired ? travelDaysEach : 0;
  const labourerTravelDays = subcontracted ? 0 : travelDaysEach * labourers;
  const surveyorHotelNights = !subcontracted && input.hotelRequired ? (days + 1 + safe(input.weekendDaysNotWorked)) * surveyors : 0;
  const pmHotelNights = pmRequired && input.hotelRequired ? days + 1 + safe(input.weekendDaysNotWorked) : 0;
  const labourerHotelNights = !subcontracted && input.hotelRequired ? (days + 1 + safe(input.weekendDaysNotWorked)) * labourers : 0;
  const hotelNights = Math.ceil(surveyorHotelNights + pmHotelNights + labourerHotelNights);
  const surveyorSubsistenceDays = !subcontracted && input.hotelRequired ? surveyorHotelNights : 0;
  const pmSubsistenceDays = pmRequired && input.hotelRequired ? pmHotelNights : 0;
  const labourerSubsistenceDays = !subcontracted && input.hotelRequired ? labourerHotelNights : 0;
  const distance = travelPackageRequired && input.travelMode === "Drive" ? calculateSurveyDistance(input) : 0;
  const flights = travelPackageRequired && input.travelMode === "Fly"
    ? (subcontracted ? 0 : surveyors + labourers) + (pmRequired ? 1 : 0) + safe(input.additionalFlights)
    : 0;
  const airportDays = travelPackageRequired && input.travelMode === "Fly" && input.airportTransport === "Drive" ? days + safe(input.weekendDaysNotWorked) + 2 : 0;
  const airportReturns = travelPackageRequired && input.travelMode === "Fly" && input.airportTransport === "Uber" ? 1 : 0;
  const carDays = travelPackageRequired && input.travelMode === "Drive" ? (input.hotelRequired ? travelDaysEach + days + safe(input.weekendDaysNotWorked) : days) * safe(input.numberOfCars) : 0;
  const rentalDays = travelPackageRequired && input.travelMode === "Fly" ? (days + safe(input.weekendDaysNotWorked) + 2) * safe(input.numberOfCars) : 0;
  const weekendSurveyorDays = subcontracted ? 0 : safe(input.weekendDaysWorked) * surveyors;
  const shippingQty = input.equipmentShippingRequired || (travelPackageRequired && input.travelMode === "Fly") ? 2 * safe(input.numberOfProfs) : 0;
  const equipmentDays = days * safe(input.numberOfProfs);
  const surveyorMarkup = input.potentialRemedials ? rates.surveyorRemedialsMarkup : rates.surveyorMarkup;

  const proposalLines: Line[] = [
    proposalLine("Labour", "Surveyor", rates.surveyorBudgetDayRate, "day", surveyorDays, surveyorMarkup, "Labour"),
    proposalLine("Labour", "Labourer", rates.labourerBudgetDayRate, "day", labourerDays, rates.labourerMarkup, "Labour"),
    proposalLine("Labour", "Project Manager", rates.projectManagerBudgetDayRate, "day", pmDays, rates.projectManagerMarkup, "Labour"),
    proposalLine("Labour", "Weekend Surveyor", rates.weekendBudgetDayRate, "day", weekendSurveyorDays, rates.weekendMarkup, "Labour"),
    proposalLine("Subcontract", "Subcontracted Survey Package", safe(input.subcontractSurveyCost), "item", subcontracted && input.subcontractSurveyCost > 0 ? 1 : 0, safe(input.subcontractSurveyMarkup), "Subcontract"),
    proposalLine("Labour", "Surveyor Travel", rates.surveyorTravelBudgetDayRate, "day", surveyorTravelDays, rates.surveyorTravelMarkup, "Labour"),
    proposalLine("Labour", "Labourer Travel", rates.labourerTravelBudgetDayRate, "day", labourerTravelDays, rates.labourerTravelMarkup, "Labour"),
    proposalLine("Labour", "Project Manager Travel", rates.projectManagerTravelBudgetDayRate, "day", pmTravelDays, rates.projectManagerTravelMarkup, "Labour"),
    proposalLine("Travel", input.distanceUnit === "miles" ? "Mileage" : "Kilometres", rates.distanceBudgetRate, distanceRateUnit(input.distanceUnit), distance, rates.distanceMarkup, "Travel"),
    proposalLine("Travel", "Return Flight", rates.returnFlightBudgetRate, "flight", flights, rates.returnFlightMarkup, "Travel"),
    proposalLine("Travel", "Return Airport Transfer", rates.airportUberBudgetRate, "return", airportReturns, rates.airportTransportMarkup, "Travel"),
    proposalLine("Travel", "Airport Parking", rates.airportParkingBudgetDayRate, "day", airportDays, rates.airportTransportMarkup, "Travel"),
    proposalLine("Hotel", "Surveyor Hotel", rates.hotelBudgetNightRate, "night", surveyorHotelNights, rates.hotelMarkup, "Hotel/Subsistence"),
    proposalLine("Hotel", "Project Manager Hotel", rates.hotelBudgetNightRate, "night", pmHotelNights, rates.hotelMarkup, "Hotel/Subsistence"),
    proposalLine("Hotel", "Labourer Hotel", rates.hotelBudgetNightRate, "night", labourerHotelNights, rates.hotelMarkup, "Hotel/Subsistence"),
    proposalLine("Haulage", "Equipment Shipping", rates.equipmentShippingBudgetRate, "one way", shippingQty, rates.equipmentShippingMarkup, "Haulage"),
    proposalLine("Travel", "Company Car", rates.companyCarBudgetDayRate, "day", carDays, rates.companyCarMarkup, "Travel"),
    proposalLine("Travel", "Car Rental", rates.carRentalBudgetDayRate, "day", rentalDays, rates.carRentalMarkup, "Travel"),
    proposalLine("Equipment", "Equipment Rental", rates.equipmentRentalBudgetDayRate, "prof day", equipmentDays, rates.equipmentRentalMarkup, "Equipment"),
    proposalLine("Subsistence", "Surveyor Subsistence", rates.subsistenceBudgetDayRate, "day", surveyorSubsistenceDays, rates.subsistenceMarkup, "Hotel/Subsistence"),
    proposalLine("Subsistence", "Project Manager Subsistence", rates.subsistenceBudgetDayRate, "day", pmSubsistenceDays, rates.subsistenceMarkup, "Hotel/Subsistence"),
    proposalLine("Subsistence", "Labourer Subsistence", rates.subsistenceBudgetDayRate, "day", labourerSubsistenceDays, rates.subsistenceMarkup, "Hotel/Subsistence"),
    proposalLine("Reports", "Engineering Report", rates.engineeringReportBudgetRate, "item", input.surveyReport ? 1 : 0, rates.engineeringReportMarkup, "Labour"),
    proposalLine("Reports", "Error Plan", rates.errorPlanBudgetRate, "item", input.errorPlan ? 1 : 0, rates.errorPlanMarkup, "Labour"),
    ...input.additionalItems.map((item) => proposalLine("Additional items", item.name, item.rate, item.unit, item.quantity, item.markup, item.plCategory))
  ];

  const budgetLines = proposalLines.map((item) => budgetLine(item.section, item.item, item.rate, item.unit, item.quantity, item.plCategory));
  const originalProposalTotal = money(proposalLines.reduce((sum, item) => sum + item.total, 0));
  const discountPercentage = Math.min(100, safe(input.discountPercentage));
  const discountAmount = money(originalProposalTotal * discountPercentage / 100);
  const discountedLines = proposalLines.map((item) => {
    const discount = originalProposalTotal ? money(discountAmount * item.originalTotal / originalProposalTotal) : 0;
    return { ...item, discount, total: money(item.originalTotal - discount) };
  });
  const proposalTotal = money(discountedLines.reduce((sum, item) => sum + item.total, 0));
  const budgetCost = money(budgetLines.reduce((sum, item) => sum + item.total, 0));
  const budgetProfit = money(proposalTotal - budgetCost);
  const budgetMargin = proposalTotal ? money(budgetProfit / proposalTotal * 100) : 0;
  const budgetMarkup = budgetCost ? money(budgetProfit / budgetCost * 100) : 0;
  const dailyRate = money(discountedLines.filter((item) => ["Labour", "Hotel", "Subsistence", "Equipment"].includes(item.section)).reduce((sum, item) => sum + (item.quantity ? item.total / item.quantity : 0), 0));
  const mobilisationRate = money(discountedLines.filter((item) => ["Travel", "Haulage", "Reports", "Additional items"].includes(item.section)).reduce((sum, item) => sum + item.total, 0));
  const standbyRate = money(rates.hotelBudgetNightRate * (1 + rates.hotelMarkup) + rates.subsistenceBudgetDayRate * (1 + rates.subsistenceMarkup));
  const details = { surveyType: input.surveyType, calculatedDayRequirement, calculatedSiteDays, siteDaysOverridden: hasSiteDaysOverride && days !== calculatedSiteDays, totalDaysOnSite: days, hotelNights, chargeableDistance: distance, distanceUnit: input.distanceUnit, surveyorDays, projectManagerDays: pmDays, labourerDays, surveyorTravelDays, projectManagerTravelDays: pmTravelDays, labourerTravelDays };

  const result: ProjectCalculations = {
    costingModule: "survey", projectReference: input.projectReference, client: input.client, location: input.location,
    serviceSummary: `Survey - ${input.surveyType}`, grindingDays: 0, screedDays: 0, repairDays: 0, siteDays: days,
    phaseRows: [], proposalLines: discountedLines, budgetLines, repairMaterialCalcs: [], originalProposalTotal,
    discountAmount, proposalTotal, budgetCost, budgetProfit, budgetMargin, budgetMarkup, bdmBonusBudget: 0, bdmBonusRate: 0,
    proposalCompanyCurrency: proposalTotal, budgetCompanyCurrency: budgetCost, proposalGroupCurrency: proposalTotal,
    budgetGroupCurrency: budgetCost, dailyRate, mobilisationRate, travelTotal: money(discountedLines.filter((item) => item.plCategory === "Travel").reduce((sum, item) => sum + item.total, 0)),
    haulageTotal: money(discountedLines.filter((item) => item.plCategory === "Haulage").reduce((sum, item) => sum + item.total, 0)), standbyRate, survey: details
  };
  return result as SurveyCalculationResult;
}
