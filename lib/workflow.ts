import type { ProjectStatus } from "./types";

export const activeProjectStatuses: Exclude<ProjectStatus, "Quoted">[] = [
  "Draft",
  "Ready for Review",
  "Approved Costing",
  "Won",
  "Lost",
  "Handover Issued",
  "Completed",
  "Closed"
];

export function normaliseProjectStatus(status: unknown): Exclude<ProjectStatus, "Quoted"> {
  if (status === "Quoted") return "Approved Costing";
  return activeProjectStatuses.includes(status as Exclude<ProjectStatus, "Quoted">)
    ? status as Exclude<ProjectStatus, "Quoted">
    : "Draft";
}

export function statusIsLocked(status: ProjectStatus) {
  return !["Draft", "Ready for Review"].includes(normaliseProjectStatus(status));
}

export function allowedStatusTransitions(status: ProjectStatus): Exclude<ProjectStatus, "Quoted">[] {
  const current = normaliseProjectStatus(status);
  const transitions: Record<Exclude<ProjectStatus, "Quoted">, Exclude<ProjectStatus, "Quoted">[]> = {
    "Draft": ["Draft", "Ready for Review"],
    "Ready for Review": ["Draft", "Ready for Review", "Approved Costing"],
    "Approved Costing": ["Approved Costing", "Won", "Lost"],
    "Won": ["Won", "Handover Issued", "Completed"],
    "Lost": ["Lost"],
    "Handover Issued": ["Handover Issued", "Completed"],
    "Completed": ["Completed", "Closed"],
    "Closed": ["Closed"]
  };
  return transitions[current];
}
