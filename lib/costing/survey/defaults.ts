import type { CurrencyCode } from "../../company";
import type { DistanceUnit, OfficeCount } from "../../types";
import type { SurveyAdminRates, SurveyEquipmentCatalogItem, SurveyInput } from "./types";
import { clearInactiveSurveyQuantities } from "./rules";

export const defaultSurveyRates: SurveyAdminRates = {
  surveyorBudgetDayRate: 550,
  surveyorMarkup: 1200 / 550 - 1,
  surveyorRemedialsMarkup: 950 / 550 - 1,
  surveyorTravelBudgetDayRate: 550,
  surveyorTravelMarkup: 650 / 550 - 1,
  labourerBudgetDayRate: 380,
  labourerMarkup: 0.2,
  labourerTravelBudgetDayRate: 380,
  labourerTravelMarkup: 0.2,
  projectManagerBudgetDayRate: 650,
  projectManagerMarkup: 0.2,
  projectManagerTravelBudgetDayRate: 650,
  projectManagerTravelMarkup: 0.2,
  weekendBudgetDayRate: 350,
  weekendMarkup: 0,
  distanceBudgetRate: 0.45,
  distanceMarkup: 0.2,
  returnFlightBudgetRate: 450,
  returnFlightMarkup: 0.52,
  airportUberBudgetRate: 140,
  airportParkingBudgetDayRate: 20,
  airportTransportMarkup: 0.2,
  hotelBudgetNightRate: 130,
  hotelMarkup: 0.5,
  equipmentShippingBudgetRate: 450,
  equipmentShippingMarkup: 0.2,
  companyCarBudgetDayRate: 55,
  companyCarMarkup: 0.2,
  carRentalBudgetDayRate: 90,
  carRentalMarkup: 0,
  equipmentRentalBudgetDayRate: 180,
  equipmentRentalMarkup: 0.2,
  subsistenceBudgetDayRate: 55,
  subsistenceMarkup: 0.25,
  engineeringReportBudgetRate: 500,
  engineeringReportMarkup: 0.2,
  errorPlanBudgetRate: 500,
  errorPlanMarkup: 0.3,
  defaultSubcontractMarkup: 0.2,
  standbySurveyorBudgetDayRate: 600,
  standbySurveyorMarkup: 1 / 3,
  standbyLabourerBudgetDayRate: 600,
  standbyLabourerMarkup: 1 / 3,
  standbySubsistenceBudgetDayRate: 55,
  standbySubsistenceMarkup: 0.25,
  dailyOutputAutoStoreArea: 1000,
  dailyOutputFminRuns: 1000,
  dailyOutputExotecRuns: 1000,
  dailyOutputExotecArea: 4000,
  dailyOutputRoboticsArea: 10000,
  dailyOutputLevelSurveyArea: 4000,
  dailyOutputProfRunsOnly: 1000,
  equipmentCatalog: [{
    id: "profiler-equipment",
    name: "Profiler Equipment",
    purchaseCost: 0,
    recoveryUnits: 0,
    budgetRate: 180,
    markup: 0.2,
    chargingBasis: "site_day",
    active: true,
    checklistNotes: "Confirm the profiler and associated survey accessories are dispatched."
  }]
};

export function createEmptySurveyInput(currency: CurrencyCode = "EUR", distanceUnit: DistanceUnit = "km", officeCount: OfficeCount = 1): SurveyInput {
  return {
    projectReference: "", client: "", location: "", revision: "1", costedBy: "", quoteCurrency: currency,
    exchangeRateToCompanyCurrency: 1, exchangeRateToGroupCurrency: 1, exchangeRateLockedAt: undefined, distanceUnit, officeCount,
    surveyType: "AutoStore", autoStoreArea: 0, fminRuns: 0, exotecRuns: 0, exotecArea: 0, roboticsArea: 0,
    levelSurveyArea: 0, profRunsOnly: 0, surveyorSupply: "In-house", subcontractSurveyCost: 0,
    subcontractSurveyMarkup: 0, subcontractMobilisationCost: 0, subcontractMobilisationMarkup: 0,
    subcontractStandbyCost: 0, subcontractStandbyMarkup: 0, pricingBasis: "fixed", expectedStandDownDays: 0,
    productiveRateOverride: null, standbyRateOverride: null, rateOverrideReason: "",
    projectManagerRequired: false, surveyorsOnSite: 0, additionalDays: 0, siteDaysOverride: null,
    labourerRequired: false, numberOfLabourers: 0, hotelRequired: false, weekendDaysWorked: 0,
    weekendDaysNotWorked: 0, numberOfProfs: 0, selectedEquipment: [], primaryOfficeDistanceOneWay: 0, secondaryOfficeDistanceOneWay: 0,
    driveTimeOneWayDays: 0, travelMode: "Drive", numberOfCars: 0, numberOfCarsOverridden: false, airportTransport: "N/A", surveyReport: false,
    errorPlan: false, potentialRemedials: false, equipmentShippingRequired: false, additionalFlights: 0,
    additionalItems: [], discountPercentage: 0, markupOverrideReason: ""
  };
}

export function normaliseSurveyRates(saved?: Partial<SurveyAdminRates>): SurveyAdminRates {
  const savedCatalog = saved?.equipmentCatalog;
  return {
    ...defaultSurveyRates,
    ...(saved ?? {}),
    equipmentCatalog: Array.isArray(savedCatalog)
      ? savedCatalog.map((item, index) => normaliseEquipment(item, index))
      : defaultSurveyRates.equipmentCatalog.map((item) => ({ ...item }))
  };
}

function normaliseEquipment(item: Partial<SurveyEquipmentCatalogItem>, index: number): SurveyEquipmentCatalogItem {
  const purchaseCost = Math.max(0, Number(item.purchaseCost) || 0);
  const recoveryUnits = Math.max(0, Number(item.recoveryUnits) || 0);
  const calculatedRate = recoveryUnits > 0 ? purchaseCost / recoveryUnits : 0;
  return {
    id: String(item.id || `survey-equipment-${index}`),
    name: String(item.name || "Survey equipment"),
    purchaseCost,
    recoveryUnits,
    budgetRate: Math.max(0, Number.isFinite(Number(item.budgetRate)) ? Number(item.budgetRate) : calculatedRate),
    markup: Math.max(0, Number(item.markup) || 0),
    chargingBasis: item.chargingBasis === "deployment" ? "deployment" : "site_day",
    active: item.active !== false,
    checklistNotes: String(item.checklistNotes || "")
  };
}

export function normaliseSurveyInput(saved: Partial<SurveyInput> | undefined, currency: CurrencyCode = "EUR", distanceUnit: DistanceUnit = "km", officeCount: OfficeCount = 1): SurveyInput {
  const inferredOfficeCount: OfficeCount = saved?.officeCount === 2 || (!saved?.officeCount && Number(saved?.secondaryOfficeDistanceOneWay) > 0) ? 2 : officeCount;
  const empty = createEmptySurveyInput(currency, distanceUnit, inferredOfficeCount);
  const numberOfCarsOverridden = Boolean(saved?.numberOfCarsOverridden);
  const savedCars = Math.max(0, Number(saved?.numberOfCars) || 0);
  const hasDriveDistance = (saved?.travelMode ?? empty.travelMode) === "Drive" && (Number(saved?.primaryOfficeDistanceOneWay) > 0 || Number(saved?.secondaryOfficeDistanceOneWay) > 0);
  return clearInactiveSurveyQuantities({
    ...empty,
    ...(saved ?? {}),
    quoteCurrency: saved?.quoteCurrency ?? currency,
    exchangeRateToCompanyCurrency: Number(saved?.exchangeRateToCompanyCurrency) > 0 ? Number(saved?.exchangeRateToCompanyCurrency) : 1,
    exchangeRateToGroupCurrency: Number(saved?.exchangeRateToGroupCurrency) > 0 ? Number(saved?.exchangeRateToGroupCurrency) : 1,
    exchangeRateLockedAt: saved?.exchangeRateLockedAt ? String(saved.exchangeRateLockedAt) : undefined,
    distanceUnit: saved?.distanceUnit ?? distanceUnit,
    officeCount: inferredOfficeCount,
    selectedEquipment: Array.isArray(saved?.selectedEquipment)
      ? saved.selectedEquipment
        .map((item) => ({ equipmentId: String(item.equipmentId || ""), quantity: Math.max(0, Number(item.quantity) || 0) }))
        .filter((item) => item.equipmentId && item.quantity > 0)
      : [],
    numberOfCars: !numberOfCarsOverridden && savedCars === 0 && hasDriveDistance ? 1 : savedCars,
    numberOfCarsOverridden,
    additionalItems: Array.isArray(saved?.additionalItems) ? saved.additionalItems.map((item, index) => ({ ...item, id: item.id ?? `survey-extra-${index}` })) : []
  });
}
