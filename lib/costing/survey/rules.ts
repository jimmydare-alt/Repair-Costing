import type { SurveyInput, SurveyType } from "./types";

export type SurveyQuantityKey =
  | "autoStoreArea"
  | "fminRuns"
  | "exotecRuns"
  | "exotecArea"
  | "roboticsArea"
  | "levelSurveyArea"
  | "profRunsOnly";

export const surveyQuantityKeys: SurveyQuantityKey[] = [
  "autoStoreArea",
  "fminRuns",
  "exotecRuns",
  "exotecArea",
  "roboticsArea",
  "levelSurveyArea",
  "profRunsOnly"
];

export const surveyFields: Record<SurveyType, SurveyQuantityKey[]> = {
  AutoStore: ["autoStoreArea"],
  Fmin: ["fminRuns"],
  Exotec: ["exotecRuns", "exotecArea"],
  Robotics: ["roboticsArea", "fminRuns"],
  "Level Survey Only": ["levelSurveyArea"],
  "Prof Runs Only": ["profRunsOnly"],
  Bespoke: [...surveyQuantityKeys]
};

export const surveyFieldDetails: Record<SurveyQuantityKey, { label: string; unit: string }> = {
  autoStoreArea: { label: "AutoStore Area", unit: "m2" },
  fminRuns: { label: "Fmin Runs", unit: "m" },
  exotecRuns: { label: "Exotec Runs", unit: "m" },
  exotecArea: { label: "Exotec Area", unit: "m2" },
  roboticsArea: { label: "Robotics Area", unit: "m2" },
  levelSurveyArea: { label: "Level Survey Area", unit: "m2" },
  profRunsOnly: { label: "Prof Runs Only", unit: "m" }
};

export function isSurveyQuantityActive(surveyType: SurveyType, key: SurveyQuantityKey) {
  return surveyFields[surveyType].includes(key);
}

export function clearInactiveSurveyQuantities(input: SurveyInput): SurveyInput {
  const next = { ...input };
  for (const key of surveyQuantityKeys) {
    if (!isSurveyQuantityActive(input.surveyType, key)) next[key] = 0;
  }
  return next;
}

export function changeSurveyType(input: SurveyInput, surveyType: SurveyType): SurveyInput {
  const next = { ...input, surveyType, siteDaysOverride: null };
  for (const key of surveyQuantityKeys) next[key] = 0;
  return next;
}
