import { emptyInput } from "../../rates";
import type { CurrencyCode } from "../../company";
import type { DistanceUnit, OfficeCount, ProjectInput } from "../../types";
import { createEmptyQaInput, normaliseQaInput } from "./defaults";
import type { QaInput } from "./types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createQaProjectInput(currency: CurrencyCode, distanceUnit: DistanceUnit, qa?: Partial<QaInput>, officeCount: OfficeCount = 1): ProjectInput {
  const qaInput = normaliseQaInput(qa ?? createEmptyQaInput(currency, distanceUnit, officeCount), currency, distanceUnit, officeCount);
  return {
    ...clone(emptyInput),
    costingModule: "qa",
    distanceUnit: qaInput.distanceUnit,
    officeCount: qaInput.officeCount,
    projectReference: qaInput.projectReference,
    client: qaInput.client,
    location: qaInput.location,
    revision: qaInput.revision,
    costedBy: qaInput.costedBy,
    projectType: "QA",
    quoteCurrency: qaInput.quoteCurrency,
    qa: qaInput,
    linkedProjectIds: qaInput.linkedProjectIds
  };
}

export function syncQaProjectInput(input: ProjectInput, qa: QaInput): ProjectInput {
  return {
    ...input,
    costingModule: "qa",
    distanceUnit: qa.distanceUnit,
    officeCount: qa.officeCount,
    projectReference: qa.projectReference,
    client: qa.client,
    location: qa.location,
    revision: qa.revision,
    costedBy: qa.costedBy,
    projectType: "QA",
    quoteCurrency: qa.quoteCurrency,
    qa,
    linkedProjectIds: qa.linkedProjectIds
  };
}
