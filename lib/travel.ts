import type { OfficeCount } from "./types";

const safe = (value: number) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export function officeJourneyDistance(officeCount: OfficeCount, primaryOneWay: number, secondaryOneWay = 0) {
  const primary = safe(primaryOneWay);
  const secondary = safe(secondaryOneWay);
  if (officeCount === 2 && primary > 0 && secondary > 0) return primary + secondary;
  return (primary || secondary) * 2;
}

export function chargeableJourneyDistance(officeCount: OfficeCount, primaryOneWay: number, secondaryOneWay: number, vehicles: number, journeys = 1) {
  return officeJourneyDistance(officeCount, primaryOneWay, secondaryOneWay) * safe(vehicles) * safe(journeys);
}

export function effectiveReturnFlights(enteredFlights: number, people: number) {
  const entered = safe(enteredFlights);
  return entered > 0 ? entered : safe(people);
}
