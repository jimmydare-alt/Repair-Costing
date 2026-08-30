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
  const dayRateProject = input.pricingBasis === "day_rate";
  const subcontractQuantity = subcontracted ? (dayRateProject ? days : input.subcontractSurveyCost > 0 ? 1 : 0) : 0;
  const expectedStandDownDays = dayRateProject ? safe(input.expectedStandDownDays) : 0;
  const standbyPeople = subcontracted ? 0 : surveyors + labourers;
  const standbyTransportQuantity = subcontracted ? 0 : safe(input.numberOfCars);
  const standbyProposalLines: Line[] = [];
  let standbyBudgetPerDay = 0;
  let standbyProposalPerDay = 0;
  const addStandby = (section: Section, item: string, budgetRate: number, quantityPerDay: number, markup: number, plCategory: PLCategory) => {
    if (budgetRate <= 0 || quantityPerDay <= 0) return;
    standbyBudgetPerDay += budgetRate * quantityPerDay;
    standbyProposalPerDay += budgetRate * quantityPerDay * (1 + Math.max(0, markup));
    standbyProposalLines.push(proposalLine(section, item, budgetRate, "stand-down day", quantityPerDay * expectedStandDownDays, markup, plCategory));
  };
  if (dayRateProject && subcontracted) addStandby("Subcontract", "Subcontracted Survey Stand-down", input.subcontractStandbyCost, 1, input.subcontractStandbyMarkup, "Subcontract");
  if (dayRateProject && !subcontracted) {
    addStandby("Labour", "Surveyor Stand-down", rates.standbySurveyorBudgetDayRate, surveyors, rates.standbySurveyorMarkup, "Labour");
    addStandby("Labour", "Labourer Stand-down", rates.standbyLabourerBudgetDayRate, labourers, rates.standbyLabourerMarkup, "Labour");
    if (input.hotelRequired) {
      addStandby("Hotel", "Stand-down Hotel", rates.hotelBudgetNightRate, standbyPeople, rates.hotelMarkup, "Hotel/Subsistence");
      addStandby("Subsistence", "Stand-down Subsistence", rates.standbySubsistenceBudgetDayRate, standbyPeople, rates.standbySubsistenceMarkup, "Hotel/Subsistence");
    }
    if (input.travelMode === "Drive") addStandby("Travel", "Stand-down Company Car", rates.companyCarBudgetDayRate, standbyTransportQuantity, rates.companyCarMarkup, "Travel");
    if (input.travelMode === "Fly") addStandby("Travel", "Stand-down Rental Car", rates.carRentalBudgetDayRate, standbyTransportQuantity, rates.carRentalMarkup, "Travel");
  }

  const proposalLines: Line[] = [
    proposalLine("Labour", "Surveyor", rates.surveyorBudgetDayRate, "day", surveyorDays, surveyorMarkup, "Labour"),
    proposalLine("Labour", "Labourer", rates.labourerBudgetDayRate, "day", labourerDays, rates.labourerMarkup, "Labour"),
    proposalLine("Labour", "Project Manager", rates.projectManagerBudgetDayRate, "day", pmDays, rates.projectManagerMarkup, "Labour"),
    proposalLine("Labour", "Weekend Surveyor", rates.weekendBudgetDayRate, "day", weekendSurveyorDays, rates.weekendMarkup, "Labour"),
    proposalLine("Subcontract", dayRateProject ? "Subcontracted Survey Productive Day" : "Subcontracted Survey Package", safe(input.subcontractSurveyCost), dayRateProject ? "day" : "item", subcontractQuantity, safe(input.subcontractSurveyMarkup), "Subcontract"),
    proposalLine("Subcontract", "Subcontracted Survey Mobilisation", safe(input.subcontractMobilisationCost), "item", dayRateProject && subcontracted && input.subcontractMobilisationCost > 0 ? 1 : 0, safe(input.subcontractMobilisationMarkup), "Subcontract"),
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
    ...input.additionalItems.map((item) => proposalLine("Additional items", item.name, item.rate, item.unit, item.quantity, item.markup, item.plCategory)),
    ...standbyProposalLines
  ];

  const productiveBudgetRate = dayRateProject
    ? subcontracted
      ? safe(input.subcontractSurveyCost)
      : money(
        rates.surveyorBudgetDayRate * surveyors
        + rates.labourerBudgetDayRate * labourers
        + (days ? rates.weekendBudgetDayRate * weekendSurveyorDays / days : 0)
        + (input.hotelRequired ? rates.hotelBudgetNightRate * standbyPeople : 0)
        + (input.hotelRequired ? rates.subsistenceBudgetDayRate * standbyPeople : 0)
        + rates.equipmentRentalBudgetDayRate * safe(input.numberOfProfs)
        + (input.travelMode === "Drive" ? rates.companyCarBudgetDayRate * safe(input.numberOfCars) : rates.carRentalBudgetDayRate * safe(input.numberOfCars))
      )
    : 0;
  const calculatedProductiveProposalRate = dayRateProject
    ? subcontracted
      ? money(safe(input.subcontractSurveyCost) * (1 + safe(input.subcontractSurveyMarkup)))
      : money(
        rates.surveyorBudgetDayRate * (1 + surveyorMarkup) * surveyors
        + rates.labourerBudgetDayRate * (1 + rates.labourerMarkup) * labourers
        + (days ? rates.weekendBudgetDayRate * (1 + rates.weekendMarkup) * weekendSurveyorDays / days : 0)
        + (input.hotelRequired ? rates.hotelBudgetNightRate * (1 + rates.hotelMarkup) * standbyPeople : 0)
        + (input.hotelRequired ? rates.subsistenceBudgetDayRate * (1 + rates.subsistenceMarkup) * standbyPeople : 0)
        + rates.equipmentRentalBudgetDayRate * (1 + rates.equipmentRentalMarkup) * safe(input.numberOfProfs)
        + (input.travelMode === "Drive" ? rates.companyCarBudgetDayRate * (1 + rates.companyCarMarkup) * safe(input.numberOfCars) : rates.carRentalBudgetDayRate * (1 + rates.carRentalMarkup) * safe(input.numberOfCars))
      )
    : 0;
  const calculatedStandbyBudgetRate = money(standbyBudgetPerDay);
  const calculatedStandbyProposalRate = money(standbyProposalPerDay);
  const discountFactor = 1 - Math.min(100, safe(input.discountPercentage)) / 100;
  const productiveProposalRate = input.productiveRateOverride ?? money(calculatedProductiveProposalRate * discountFactor);
  const standbyProposalRate = input.standbyRateOverride ?? money(calculatedStandbyProposalRate * discountFactor);
  const productiveTargetBeforeDiscount = discountFactor > 0 ? productiveProposalRate / discountFactor : productiveProposalRate;
  const standbyTargetBeforeDiscount = discountFactor > 0 ? standbyProposalRate / discountFactor : standbyProposalRate;
  if (dayRateProject && days && input.productiveRateOverride !== null) proposalLines.push(proposalLine("Labour", "Productive day rate adjustment", 0, "adjustment", 1, 0, "Labour", money((productiveTargetBeforeDiscount - calculatedProductiveProposalRate) * days)));
  if (dayRateProject && expectedStandDownDays && input.standbyRateOverride !== null) proposalLines.push(proposalLine("Labour", "Stand-down day rate adjustment", 0, "adjustment", 1, 0, "Labour", money((standbyTargetBeforeDiscount - calculatedStandbyProposalRate) * expectedStandDownDays)));

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
  const surveyPackageSell = discountedLines.filter((item) => !item.item.includes("Project Manager") && item.section !== "Reports" && item.section !== "Additional items" && !item.item.includes("Stand-down")).reduce((sum, item) => sum + item.total, 0);
  const surveyPackageBudget = budgetLines.filter((item) => !item.item.includes("Project Manager") && item.section !== "Reports" && item.section !== "Additional items" && !item.item.includes("Stand-down")).reduce((sum, item) => sum + item.total, 0);
  const dailyRate = dayRateProject ? money(productiveProposalRate) : money(discountedLines.filter((item) => ["Labour", "Hotel", "Subsistence", "Equipment"].includes(item.section)).reduce((sum, item) => sum + (item.quantity ? item.total / item.quantity : 0), 0));
  const mobilisationRate = dayRateProject ? money(Math.max(0, surveyPackageSell - productiveProposalRate * days)) : money(discountedLines.filter((item) => ["Travel", "Haulage", "Reports", "Additional items"].includes(item.section)).reduce((sum, item) => sum + item.total, 0));
  const mobilisationBudget = dayRateProject ? money(Math.max(0, surveyPackageBudget - productiveBudgetRate * days)) : 0;
  const standbyRate = dayRateProject ? money(standbyProposalRate) : 0;
  const details = { surveyType: input.surveyType, calculatedDayRequirement, calculatedSiteDays, siteDaysOverridden: hasSiteDaysOverride && days !== calculatedSiteDays, totalDaysOnSite: days, hotelNights, chargeableDistance: distance, distanceUnit: input.distanceUnit, surveyorDays, projectManagerDays: pmDays, labourerDays, surveyorTravelDays, projectManagerTravelDays: pmTravelDays, labourerTravelDays };

  const result: ProjectCalculations = {
    costingModule: "survey", projectReference: input.projectReference, client: input.client, location: input.location,
    serviceSummary: `Survey - ${input.surveyType}`, grindingDays: 0, screedDays: 0, repairDays: 0, siteDays: days,
    phaseRows: [], proposalLines: discountedLines, budgetLines, repairMaterialCalcs: [], originalProposalTotal,
    discountAmount, proposalTotal, budgetCost, budgetProfit, budgetMargin, budgetMarkup, bdmBonusBudget: 0, bdmBonusRate: 0,
    proposalCompanyCurrency: proposalTotal, budgetCompanyCurrency: budgetCost, proposalGroupCurrency: proposalTotal,
    budgetGroupCurrency: budgetCost, dailyRate, mobilisationRate, travelTotal: money(discountedLines.filter((item) => item.plCategory === "Travel").reduce((sum, item) => sum + item.total, 0)),
    haulageTotal: money(discountedLines.filter((item) => item.plCategory === "Haulage").reduce((sum, item) => sum + item.total, 0)), standbyRate,
    rateSchedules: dayRateProject ? [{ workPackageName: `Survey - ${input.surveyType}`, service: "Survey", pricingBasis: "day_rate", estimatedDays: days, productiveBudgetRate, productiveProposalRate: dailyRate, productiveRateOverridden: input.productiveRateOverride !== null, mobilisationBudget, mobilisationProposal: mobilisationRate, standbyBudgetRate: calculatedStandbyBudgetRate, standbyProposalRate: standbyRate, standbyRateOverridden: input.standbyRateOverride !== null, expectedStandDownDays, overrideReason: input.rateOverrideReason }] : [],
    survey: details
  };
  return result as SurveyCalculationResult;
}
