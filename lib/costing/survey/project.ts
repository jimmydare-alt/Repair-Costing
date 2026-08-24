import { emptyInput } from "../../rates";
import type { CurrencyCode } from "../../company";
import type { DistanceUnit, OfficeCount, ProjectInput } from "../../types";
import { createEmptySurveyInput, normaliseSurveyInput } from "./defaults";
import type { SurveyInput } from "./types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createSurveyProjectInput(currency: CurrencyCode, distanceUnit: DistanceUnit, survey?: Partial<SurveyInput>, officeCount: OfficeCount = 1): ProjectInput {
  const surveyInput = normaliseSurveyInput(survey ?? createEmptySurveyInput(currency, distanceUnit, officeCount), currency, distanceUnit, officeCount);
  return {
    ...clone(emptyInput),
    costingModule: "survey",
    distanceUnit: surveyInput.distanceUnit,
    officeCount: surveyInput.officeCount,
    projectReference: surveyInput.projectReference,
    client: surveyInput.client,
    location: surveyInput.location,
    revision: surveyInput.revision,
    costedBy: surveyInput.costedBy,
    projectType: "Survey",
    quoteCurrency: surveyInput.quoteCurrency,
    survey: surveyInput
  };
}

export function syncSurveyProjectInput(input: ProjectInput, survey: SurveyInput): ProjectInput {
  return {
    ...input,
    costingModule: "survey",
    distanceUnit: survey.distanceUnit,
    officeCount: survey.officeCount,
    projectReference: survey.projectReference,
    client: survey.client,
    location: survey.location,
    revision: survey.revision,
    costedBy: survey.costedBy,
    projectType: "Survey",
    quoteCurrency: survey.quoteCurrency,
    survey
  };
}
