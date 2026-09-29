import type { CurrencyCode } from "../../company";
import type { DistanceUnit, OfficeCount, PLCategory, Section } from "../../types";
import type { QaAdminRates, QaArea, QaInput, QaRateDefinition, QaRateKey, QaVisit } from "./types";
import { QA_RATE_KEYS } from "./types";

type RateSeed = [QaRateKey, string, string, number, Section, PLCategory, "internal" | "subcontract", "design" | "supervision" | "travel"];

// The starting rates mirror the supplied Eurostick/FACE QA workbook. The workbook
// combines hotel, subsistence and vehicle at EUR 200; that value starts in Hotel
// while the other two components remain visible at zero for completion in Admin.
const workbookRateSeeds: RateSeed[] = [
  ["internalOfficeWork", "Internal Office Work", "item", 4800, "Labour", "Labour", "internal", "design"],
  ["internalMeeting", "Internal Meeting Attendance", "meeting", 1000, "Labour", "Labour", "internal", "design"],
  ["internalConferenceCall", "Internal Conference Call", "call", 120, "Labour", "Labour", "internal", "design"],
  ["internalReportReview", "Internal Report / Calculation Review", "item", 800, "Reports", "Labour", "internal", "design"],
  ["subcontractOfficeWork", "Subcontract Office Work", "item", 5040, "Subcontract", "Subcontract", "subcontract", "design"],
  ["subcontractMeeting", "Subcontract Meeting Attendance", "meeting", 3725, "Subcontract", "Subcontract", "subcontract", "design"],
  ["subcontractConferenceCall", "Subcontract Conference Call", "call", 175, "Subcontract", "Subcontract", "subcontract", "design"],
  ["subcontractReportReview", "Subcontract Report / Calculation Review", "item", 3000, "Subcontract", "Subcontract", "subcontract", "design"],
  ["internalSupervisionDay", "Internal Supervision Day", "person day", 680, "Labour", "Labour", "internal", "supervision"],
  ["internalNonSupervisionDay", "Internal Non-Supervision Day", "person day", 500, "Labour", "Labour", "internal", "supervision"],
  ["internalStandDownDay", "Internal Stand-Down Day", "person day", 0, "Labour", "Labour", "internal", "supervision"],
  ["internalTravelDay", "Internal Travel Day", "person day", 500, "Labour", "Labour", "internal", "travel"],
  ["internalHotelNight", "Internal Hotel", "night", 200, "Hotel", "Hotel/Subsistence", "internal", "travel"],
  ["internalSubsistenceDay", "Internal Subsistence", "person day", 0, "Subsistence", "Hotel/Subsistence", "internal", "travel"],
  ["internalVehicleDay", "Internal Vehicle", "vehicle day", 0, "Travel", "Travel", "internal", "travel"],
  ["internalDistance", "Internal Distance", "distance unit", 0.5, "Travel", "Travel", "internal", "travel"],
  ["internalEquipmentTransport", "Internal Equipment Transport", "trip", 0, "Haulage", "Haulage", "internal", "travel"],
  ["subcontractSupervisionDay", "Subcontract Supervision Day", "person day", 1075, "Subcontract", "Subcontract", "subcontract", "supervision"],
  ["subcontractNonSupervisionDay", "Subcontract Non-Supervision Day", "person day", 0, "Subcontract", "Subcontract", "subcontract", "supervision"],
  ["subcontractStandDownDay", "Subcontract Stand-Down Day", "person day", 535, "Subcontract", "Subcontract", "subcontract", "supervision"],
  ["subcontractTravelDay", "Subcontract Travel Day", "person day", 785, "Subcontract", "Subcontract", "subcontract", "travel"],
  ["subcontractHotelNight", "Subcontract Hotel", "night", 200, "Subcontract", "Subcontract", "subcontract", "travel"],
  ["subcontractSubsistenceDay", "Subcontract Subsistence", "person day", 0, "Subcontract", "Subcontract", "subcontract", "travel"],
  ["subcontractVehicleDay", "Subcontract Vehicle", "vehicle day", 0, "Subcontract", "Subcontract", "subcontract", "travel"],
  ["subcontractDistance", "Subcontract Distance", "distance unit", 0.5, "Subcontract", "Subcontract", "subcontract", "travel"],
  ["subcontractEquipmentTransport", "Subcontract Equipment Transport", "trip", 1500, "Subcontract", "Subcontract", "subcontract", "travel"]
];

function rate(seed: RateSeed): QaRateDefinition {
  const [key, label, unit, budgetRate, section, plCategory, delivery, group] = seed;
  return { key, label, unit, budgetRate, markup: 0, section, plCategory, delivery, group };
}

export const defaultQaRates: QaAdminRates = {
  rates: Object.fromEntries(workbookRateSeeds.map((seed) => [seed[0], rate(seed)])) as Record<QaRateKey, QaRateDefinition>
};

export function createEmptyQaArea(index = 1): QaArea {
  return {
    id: `qa-area-${index}`,
    name: `QA Area ${index}`,
    areaM2: 0,
    designReviewRequired: true,
    supervisionRequired: true,
    designPricingBasis: "fixed",
    supervisionPricingBasis: "day_rate",
    designDeliveryMode: "in_house",
    supervisionDeliveryMode: "in_house",
    internalPeople: 1,
    subcontractPeople: 1,
    quantities: {},
    rateOverrides: {},
    extraVisits: []
  };
}

export function createEmptyQaVisit(index = 1, delivery: "internal" | "subcontract" = "internal"): QaVisit {
  return {
    id: `qa-visit-${Date.now()}-${index}`,
    name: `Extra Visit ${index}`,
    delivery,
    people: 1,
    siteDays: 1,
    travelDays: 0,
    hotelNights: 0,
    subsistenceDays: 0,
    vehicleDays: 0,
    oneWayDistance: 0,
    vehicles: 1,
    equipmentTransportTrips: 0
  };
}

export function createEmptyQaInput(currency: CurrencyCode = "EUR", distanceUnit: DistanceUnit = "km", officeCount: OfficeCount = 1): QaInput {
  return {
    projectReference: "",
    client: "",
    location: "",
    revision: "1",
    costedBy: "",
    quoteCurrency: currency,
    distanceUnit,
    officeCount,
    areas: [createEmptyQaArea()],
    additionalItems: [],
    discountPercentage: 0,
    proposalAdjustment: 0,
    proposalAdjustmentReason: "",
    linkedProjectIds: [],
    sharedTravelOwnerProjectId: ""
  };
}

function safe(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

export function normaliseQaRates(saved?: Partial<QaAdminRates>): QaAdminRates {
  const savedRates: Partial<Record<QaRateKey, Partial<QaRateDefinition>>> = saved?.rates ?? {};
  const rates = {} as Record<QaRateKey, QaRateDefinition>;
  QA_RATE_KEYS.forEach((key) => {
    const fallback = defaultQaRates.rates[key];
    const value = savedRates[key];
    rates[key] = {
      ...fallback,
      ...(value ?? {}),
      key,
      budgetRate: safe(value?.budgetRate, fallback.budgetRate),
      markup: safe(value?.markup, fallback.markup)
    };
  });
  return { rates };
}

export function normaliseQaInput(saved: Partial<QaInput> | undefined, currency: CurrencyCode = "EUR", distanceUnit: DistanceUnit = "km", officeCount: OfficeCount = 1): QaInput {
  const empty = createEmptyQaInput(currency, distanceUnit, officeCount);
  const sourceAreas = Array.isArray(saved?.areas) && saved.areas.length ? saved.areas : empty.areas;
  return {
    ...empty,
    ...(saved ?? {}),
    quoteCurrency: saved?.quoteCurrency ?? currency,
    distanceUnit: saved?.distanceUnit ?? distanceUnit,
    officeCount: saved?.officeCount === 2 ? 2 : officeCount,
    areas: sourceAreas.map((area, index) => ({
      ...createEmptyQaArea(index + 1),
      ...area,
      id: String(area.id || `qa-area-${index + 1}`),
      name: String(area.name || `QA Area ${index + 1}`),
      areaM2: safe(area.areaM2),
      internalPeople: Math.max(1, safe(area.internalPeople, 1)),
      subcontractPeople: Math.max(1, safe(area.subcontractPeople, 1)),
      quantities: Object.fromEntries(Object.entries(area.quantities ?? {}).map(([key, value]) => [key, safe(value)])),
      rateOverrides: Object.fromEntries(Object.entries(area.rateOverrides ?? {}).map(([key, value]) => [key, {
        budgetRate: value?.budgetRate == null ? null : safe(value.budgetRate),
        markup: value?.markup == null ? null : safe(value.markup),
        reason: String(value?.reason ?? "")
      }])),
      extraVisits: Array.isArray(area.extraVisits) ? area.extraVisits.map((visit, visitIndex) => ({
        ...createEmptyQaVisit(visitIndex + 1, visit.delivery === "subcontract" ? "subcontract" : "internal"),
        ...visit,
        id: String(visit.id || `qa-visit-${index}-${visitIndex}`),
        people: Math.max(1, safe(visit.people, 1)),
        siteDays: safe(visit.siteDays),
        travelDays: safe(visit.travelDays),
        hotelNights: safe(visit.hotelNights),
        subsistenceDays: safe(visit.subsistenceDays),
        vehicleDays: safe(visit.vehicleDays),
        oneWayDistance: safe(visit.oneWayDistance),
        vehicles: safe(visit.vehicles),
        equipmentTransportTrips: safe(visit.equipmentTransportTrips)
      })) : []
    })),
    additionalItems: Array.isArray(saved?.additionalItems) ? saved.additionalItems.map((item, index) => ({
      ...item,
      id: String(item.id || `qa-extra-${index}`),
      budgetRate: safe(item.budgetRate),
      quantity: safe(item.quantity),
      markup: safe(item.markup)
    })) : [],
    linkedProjectIds: Array.isArray(saved?.linkedProjectIds) ? saved.linkedProjectIds.map(String) : [],
    proposalAdjustment: Number.isFinite(Number(saved?.proposalAdjustment)) ? Number(saved?.proposalAdjustment) : 0
  };
}
