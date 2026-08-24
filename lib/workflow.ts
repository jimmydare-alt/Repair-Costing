import type { ProjectStatus } from "./types";

export type ActiveProjectStatus = "Draft" | "Costing Complete" | "Won" | "Lost" | "Handover Issued" | "Completed" | "Closed";

export const activeProjectStatuses: ActiveProjectStatus[] = [
  "Draft",
  "Costing Complete",
  "Won",
  "Lost",
  "Handover Issued",
  "Completed",
  "Closed"
];

export function normaliseProjectStatus(status: unknown): ActiveProjectStatus {
  if (status === "Quoted" || status === "Approved Costing") return "Costing Complete";
  if (status === "Ready for Review") return "Draft";
  return activeProjectStatuses.includes(status as ActiveProjectStatus)
    ? status as ActiveProjectStatus
    : "Draft";
}

export function statusIsLocked(status: ProjectStatus) {
  return normaliseProjectStatus(status) !== "Draft";
}

export function allowedStatusTransitions(_status: ProjectStatus): ActiveProjectStatus[] {
  return [...activeProjectStatuses];
}
