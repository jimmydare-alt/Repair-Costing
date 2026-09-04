import type { CurrencyCode } from "../../company";
import type { DistanceUnit, OfficeCount } from "../../types";
import type { SurveyAdminRates, SurveyInput } from "./types";
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
  dailyOutputProfRunsOnly: 1000
};

export function createEmptySurveyInput(currency: CurrencyCode = "EUR", distanceUnit: DistanceUnit = "km", officeCount: OfficeCount = 1): SurveyInput {
  return {
    projectReference: "", client: "", location: "", revision: "1", costedBy: "", quoteCurrency: currency, distanceUnit, officeCount,
    surveyType: "AutoStore", autoStoreArea: 0, fminRuns: 0, exotecRuns: 0, exotecArea: 0, roboticsArea: 0,
    levelSurveyArea: 0, profRunsOnly: 0, surveyorSupply: "In-house", subcontractSurveyCost: 0,
    subcontractSurveyMarkup: 0, subcontractMobilisationCost: 0, subcontractMobilisationMarkup: 0,
    subcontractStandbyCost: 0, subcontractStandbyMarkup: 0, pricingBasis: "fixed", expectedStandDownDays: 0,
    productiveRateOverride: null, standbyRateOverride: null, rateOverrideReason: "",
    projectManagerRequired: false, surveyorsOnSite: 0, additionalDays: 0, siteDaysOverride: null,
    labourerRequired: false, numberOfLabourers: 0, hotelRequired: false, weekendDaysWorked: 0,
    weekendDaysNotWorked: 0, numberOfProfs: 0, primaryOfficeDistanceOneWay: 0, secondaryOfficeDistanceOneWay: 0,
    driveTimeOneWayDays: 0, travelMode: "Drive", numberOfCars: 0, airportTransport: "N/A", surveyReport: false,
    errorPlan: false, potentialRemedials: false, equipmentShippingRequired: false, additionalFlights: 0,
    additionalItems: [], discountPercentage: 0, markupOverrideReason: ""
  };
}

export function normaliseSurveyRates(saved?: Partial<SurveyAdminRates>): SurveyAdminRates {
  return { ...defaultSurveyRates, ...(saved ?? {}) };
}

export function normaliseSurveyInput(saved: Partial<SurveyInput> | undefined, currency: CurrencyCode = "EUR", distanceUnit: DistanceUnit = "km", officeCount: OfficeCount = 1): SurveyInput {
  const inferredOfficeCount: OfficeCount = saved?.officeCount === 2 || (!saved?.officeCount && Number(saved?.secondaryOfficeDistanceOneWay) > 0) ? 2 : officeCount;
  const empty = createEmptySurveyInput(currency, distanceUnit, inferredOfficeCount);
  return clearInactiveSurveyQuantities({
    ...empty,
    ...(saved ?? {}),
    quoteCurrency: saved?.quoteCurrency ?? currency,
    distanceUnit: saved?.distanceUnit ?? distanceUnit,
    officeCount: inferredOfficeCount,
    additionalItems: Array.isArray(saved?.additionalItems) ? saved.additionalItems.map((item, index) => ({ ...item, id: item.id ?? `survey-extra-${index}` })) : []
  });
}
