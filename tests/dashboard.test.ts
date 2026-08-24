import { describe, expect, it } from "vitest";
import { emptyDashboardFilters, filterDashboardProjects } from "@/lib/dashboard";
import { calculateProject } from "@/lib/calculations";
import { defaultRates, emptyInput } from "@/lib/rates";
import type { ProjectRecord } from "@/lib/types";

function project(id: string, reference: string, client: string, service: "Grinding" | "Repairs", status: ProjectRecord["status"]): ProjectRecord {
  const inputs = service === "Grinding"
    ? { ...emptyInput, projectReference: reference, client, location: "Berlin", costedBy: "Estimator One", includeGrinding: true, grinding: { ...emptyInput.grinding, enabled: true } }
    : { ...emptyInput, projectReference: reference, client, location: "Munich", costedBy: "Estimator Two", includeRepairs: true, repairs: { ...emptyInput.repairs, enabled: true } };
  return { id, createdAt: "2026-08-24T00:00:00.000Z", status, accountsStatus: "Not Required", inputs, calculations: calculateProject(inputs, defaultRates), revisions: [] };
}

describe("dashboard project filters", () => {
  const projects = [project("1", "GR-101", "Kardex", "Grinding", "Draft"), project("2", "RP-202", "Element", "Repairs", "Won")];

  it("returns every project when filters are clear", () => {
    expect(filterDashboardProjects(projects, emptyDashboardFilters)).toHaveLength(2);
  });

  it("searches identity, location, estimator and service text", () => {
    expect(filterDashboardProjects(projects, { ...emptyDashboardFilters, query: "kardex" }).map((item) => item.id)).toEqual(["1"]);
    expect(filterDashboardProjects(projects, { ...emptyDashboardFilters, query: "munich" }).map((item) => item.id)).toEqual(["2"]);
    expect(filterDashboardProjects(projects, { ...emptyDashboardFilters, query: "estimator one" }).map((item) => item.id)).toEqual(["1"]);
  });

  it("combines module, status and service filters", () => {
    expect(filterDashboardProjects(projects, { query: "", module: "remedial", status: "Won", service: "Repairs" }).map((item) => item.id)).toEqual(["2"]);
    expect(filterDashboardProjects(projects, { query: "", module: "survey", status: "All", service: "All" })).toHaveLength(0);
  });
});
