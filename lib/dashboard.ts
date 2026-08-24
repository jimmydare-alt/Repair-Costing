import type { ProjectRecord } from "./types";
import { normaliseProjectStatus } from "./workflow";

export type DashboardFilters = {
  query: string;
  module: "All" | "survey" | "remedial";
  status: string;
  service: string;
};

export const emptyDashboardFilters: DashboardFilters = {
  query: "",
  module: "All",
  status: "All",
  service: "All"
};

export function filterDashboardProjects(projects: ProjectRecord[], filters: DashboardFilters) {
  const query = filters.query.trim().toLowerCase();
  return projects.filter((project) => {
    const costingModule = project.inputs.costingModule ?? "remedial";
    const searchText = [
      project.inputs.projectReference,
      project.inputs.client,
      project.inputs.location,
      project.inputs.costedBy,
      project.calculations.serviceSummary
    ].join(" ").toLowerCase();
    return (!query || searchText.includes(query))
      && (filters.module === "All" || costingModule === filters.module)
      && (filters.status === "All" || normaliseProjectStatus(project.status) === filters.status)
      && (filters.service === "All" || project.calculations.serviceSummary.toLowerCase().includes(filters.service.toLowerCase()));
  });
}
