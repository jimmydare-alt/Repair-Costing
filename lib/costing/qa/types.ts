import type { CurrencyCode } from "../../company";
import type { DistanceUnit, LabourMode, Line, OfficeCount, PackagePricingBasis, PLCategory, ProjectCalculations, Section, TravelMode } from "../../types";

export type QaRateKey =
  | "internalDesignReviewHour"
  | "internalDesignMeetingHour"
  | "subcontractDesignReviewHour"
  | "subcontractDesignMeetingHour"
  | "internalOfficeWork"
  | "internalMeeting"
  | "internalConferenceCall"
  | "internalReportReview"
  | "subcontractOfficeWork"
  | "subcontractMeeting"
  | "subcontractConferenceCall"
  | "subcontractReportReview"
  | "internalSupervisionDay"
  | "internalNonSupervisionDay"
  | "internalStandDownDay"
  | "internalTravelDay"
  | "internalHotelNight"
  | "internalSubsistenceDay"
  | "internalVehicleDay"
  | "internalDistance"
  | "internalEquipmentTransport"
  | "subcontractSupervisionDay"
  | "subcontractNonSupervisionDay"
  | "subcontractStandDownDay"
  | "subcontractTravelDay"
  | "subcontractHotelNight"
  | "subcontractSubsistenceDay"
  | "subcontractVehicleDay"
  | "subcontractDistance"
  | "subcontractEquipmentTransport";

export type QaRateDefinition = {
  key: QaRateKey;
  label: string;
  unit: string;
  budgetRate: number;
  markup: number;
  section: Section;
  plCategory: PLCategory;
  delivery: "internal" | "subcontract";
  group: "design" | "supervision" | "travel";
  legacy?: boolean;
};

export type QaAdminRates = {
  rates: Record<QaRateKey, QaRateDefinition>;
};

export type QaRateOverride = {
  budgetRate: number | null;
  markup: number | null;
  reason: string;
};

export type QaVisit = {
  id: string;
  name: string;
  delivery: "internal" | "subcontract";
  people: number;
  siteDays: number;
  travelDays: number;
  hotelNights: number;
  subsistenceDays: number;
  vehicleDays: number;
  oneWayDistance: number;
  vehicles: number;
  equipmentTransportTrips: number;
};

export type QaProgramme = {
  siteDays: number;
  visits: number;
  travelDaysEachWay: number;
  nonSupervisionDays: number;
  standDownDays: number;
  internalPeople: number;
  subcontractPeople: number;
  hotelRequired: boolean;
  hotelNightsOverride: number | null;
  subsistenceDaysOverride: number | null;
  oneWayDistance: number;
  vehicles: number;
  rateOverrides: Partial<Record<QaRateKey, QaRateOverride>>;
};

export type QaArea = {
  id: string;
  name: string;
  areaM2: number;
  designReviewRequired: boolean;
  supervisionRequired: boolean;
  designPricingBasis: PackagePricingBasis;
  supervisionPricingBasis: PackagePricingBasis;
  designDeliveryMode: LabourMode;
  supervisionDeliveryMode: LabourMode;
  internalPeople: number;
  subcontractPeople: number;
  guidedSchedule: boolean;
  siteDays: number;
  nonSupervisionDays: number;
  standDownDays: number;
  travelDays: number;
  hotelNights: number;
  subsistenceDays: number;
  vehicleDays: number;
  oneWayDistance: number;
  vehicles: number;
  equipmentTransportTrips: number;
  quantities: Partial<Record<QaRateKey, number>>;
  rateOverrides: Partial<Record<QaRateKey, QaRateOverride>>;
  extraVisits: QaVisit[];
};

export type QaAdditionalItem = {
  id: string;
  name: string;
  budgetRate: number;
  quantity: number;
  unit: string;
  markup: number;
  plCategory: PLCategory;
};

export type QaInput = {
  projectReference: string;
  client: string;
  location: string;
  revision: string;
  costedBy: string;
  quoteCurrency: CurrencyCode;
  exchangeRateToCompanyCurrency: number;
  exchangeRateToGroupCurrency: number;
  exchangeRateLockedAt?: string;
  distanceUnit: DistanceUnit;
  officeCount: OfficeCount;
  surveyIncluded: boolean;
  surveyDeliveryMode: "independent" | "qa_assisted";
  qaAssistedAdditionalSurveyDays: number;
  designReviewIncluded: boolean;
  siteSupervisionIncluded: boolean;
  visitMode: "separate" | "shared";
  sharedTravelOwner: "survey" | "qa";
  programme: QaProgramme | null;
  areas: QaArea[];
  additionalItems: QaAdditionalItem[];
  discountPercentage: number;
  proposalAdjustment: number;
  proposalAdjustmentReason: string;
  linkedProjectIds: string[];
  sharedTravelOwnerProjectId: string;
};

export type QaAreaCalculation = {
  id: string;
  name: string;
  areaM2: number;
  designReviewProposal: number;
  designReviewBudget: number;
  supervisionProposal: number;
  supervisionBudget: number;
  travelProposal: number;
  travelBudget: number;
  supervisionDays: number;
  productivityM2PerDay: number;
};

export type QaCalculationDetails = {
  areas: QaAreaCalculation[];
  designReviewProposal: number;
  designReviewBudget: number;
  supervisionProposal: number;
  supervisionBudget: number;
  travelProposal: number;
  travelBudget: number;
  overrideCount: number;
  linkedProjectIds: string[];
  surveyIncluded?: boolean;
  visitMode?: "separate" | "shared";
  sharedTravelOwner?: "survey" | "qa";
  programme?: {
    siteDays: number;
    visits: number;
    totalTravelDays: number;
    calculatedHotelNightsPerPerson: number;
    hotelNightsPerPerson: number;
    hotelNightsOverridden: boolean;
    calculatedSubsistenceDaysPerPerson: number;
    subsistenceDaysPerPerson: number;
    subsistenceDaysOverridden: boolean;
    chargeableDistance: number;
  };
  surveyProposal?: number;
  surveyBudget?: number;
};

export type QaCalculationResult = ProjectCalculations & {
  costingModule: "qa";
  qa: QaCalculationDetails;
  proposalLines: Line[];
  budgetLines: Line[];
};

export const QA_RATE_KEYS: QaRateKey[] = [
  "internalDesignReviewHour", "internalDesignMeetingHour", "subcontractDesignReviewHour", "subcontractDesignMeetingHour",
  "internalOfficeWork", "internalMeeting", "internalConferenceCall", "internalReportReview",
  "subcontractOfficeWork", "subcontractMeeting", "subcontractConferenceCall", "subcontractReportReview",
  "internalSupervisionDay", "internalNonSupervisionDay", "internalStandDownDay", "internalTravelDay",
  "internalHotelNight", "internalSubsistenceDay", "internalVehicleDay", "internalDistance", "internalEquipmentTransport",
  "subcontractSupervisionDay", "subcontractNonSupervisionDay", "subcontractStandDownDay", "subcontractTravelDay",
  "subcontractHotelNight", "subcontractSubsistenceDay", "subcontractVehicleDay", "subcontractDistance", "subcontractEquipmentTransport"
];

export type QaTravelMode = TravelMode;
