import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { calculateQaProject } from "@/lib/costing/qa/calculations";
import { createEmptyQaInput, defaultQaRates, normaliseQaInput } from "@/lib/costing/qa/defaults";
import { createQaProjectInput } from "@/lib/costing/qa/project";
import { defaultRates } from "@/lib/rates";
import { projectToRow, rowToProject } from "@/lib/storage";
import type { ProjectRecord } from "@/lib/types";

function qaInput() {
  const input = createEmptyQaInput("EUR", "km");
  input.projectReference = "QA-001";
  input.client = "Example Client";
  input.location = "Madrid";
  input.areas[0] = {
    ...input.areas[0],
    name: "Warehouse A",
    areaM2: 12000,
    quantities: {
      internalOfficeWork: 1,
      internalMeeting: 2,
      internalSupervisionDay: 4,
      internalTravelDay: 2,
      internalHotelNight: 4,
      internalDistance: 600
    }
  };
  return input;
}

describe("separate QA costing module", () => {
  it("registers QA disabled by default and enables it only for Eurostick/CGFE", () => {
    const sql = readFileSync("supabase/migrations/015_qa_costing_module.sql", "utf8");
    expect(sql).toContain("'qa_costing'");
    expect(sql).toContain("module.id, false");
    expect(sql).toContain("lower(company.name) like 'eurostick%'");
    expect(sql).toContain("lower(company.name) like '%cgfe%'");
  });

  it("starts blank and does not create a preset cost", () => {
    const result = calculateQaProject(createEmptyQaInput("EUR", "km"), defaultQaRates);
    expect(result.proposalTotal).toBe(0);
    expect(result.budgetCost).toBe(0);
    expect(result.siteDays).toBe(0);
  });

  it("keeps Design Review and Site Supervision as separate prices", () => {
    const result = calculateQaProject(qaInput(), defaultQaRates);
    expect(result.qa.designReviewBudget).toBe(6800);
    expect(result.qa.supervisionBudget).toBe(2720);
    expect(result.qa.travelBudget).toBe(2100);
    expect(result.qa.areas[0].supervisionDays).toBe(4);
    expect(result.qa.areas[0].productivityM2PerDay).toBe(3000);
    expect(result.rateSchedules?.map((item) => item.service)).toEqual(["QA", "QA"]);
  });

  it("uses only the selected delivery route and keeps subcontract lines in Subcontract P&L", () => {
    const input = qaInput();
    input.areas[0] = {
      ...input.areas[0],
      designDeliveryMode: "subcontract",
      supervisionDeliveryMode: "subcontract",
      quantities: { ...input.areas[0].quantities, subcontractOfficeWork: 1, subcontractSupervisionDay: 3, subcontractTravelDay: 2, subcontractHotelNight: 3 }
    };
    const result = calculateQaProject(input, defaultQaRates);
    expect(result.proposalLines.some((line) => line.item.includes("Internal"))).toBe(false);
    expect(result.proposalLines.every((line) => line.plCategory === "Subcontract")).toBe(true);
    expect(result.qa.areas[0].supervisionDays).toBe(3);
  });

  it("applies and identifies a project rate override without changing admin defaults", () => {
    const input = qaInput();
    input.areas[0].rateOverrides.internalSupervisionDay = { budgetRate: 750, markup: 0.2, reason: "Night access" };
    const result = calculateQaProject(input, defaultQaRates);
    const line = result.proposalLines.find((item) => item.item.endsWith("Internal Supervision Day"));
    expect(line?.cost).toBe(3000);
    expect(line?.total).toBe(3600);
    expect(line?.source).toContain("Night access");
    expect(result.qa.overrideCount).toBe(1);
    expect(defaultQaRates.rates.internalSupervisionDay.budgetRate).toBe(680);
  });

  it("adds repeat visits with their full associated costs", () => {
    const input = qaInput();
    input.areas[0].extraVisits = [{ id: "visit-1", name: "Return inspection", delivery: "internal", people: 2, siteDays: 1, travelDays: 1, hotelNights: 1, subsistenceDays: 1, vehicleDays: 2, oneWayDistance: 100, vehicles: 1, equipmentTransportTrips: 1 }];
    const result = calculateQaProject(input, defaultQaRates);
    const visitLines = result.proposalLines.filter((line) => line.item.includes("Return inspection"));
    expect(visitLines.find((line) => line.item.endsWith("Internal Supervision Day"))?.quantity).toBe(2);
    expect(visitLines.find((line) => line.item.endsWith("Internal Distance"))?.quantity).toBe(200);
    expect(result.qa.areas[0].supervisionDays).toBe(5);
  });

  it("removes QA travel and stay when a linked costing owns shared travel", () => {
    const input = { ...qaInput(), linkedProjectIds: ["survey-1"], sharedTravelOwnerProjectId: "survey-1" };
    const result = calculateQaProject(input, defaultQaRates);
    expect(result.proposalLines.some((line) => line.costKind === "mobilisation")).toBe(false);
    expect(result.mobilisationRate).toBe(0);
    expect(result.qa.designReviewBudget).toBe(6800);
  });

  it("allows a Design Review-only area to carry its own travel without adding supervision", () => {
    const input = qaInput();
    input.areas[0].supervisionRequired = false;
    const result = calculateQaProject(input, defaultQaRates);
    expect(result.qa.supervisionBudget).toBe(0);
    expect(result.qa.travelBudget).toBe(2100);
    expect(result.qa.areas[0].supervisionDays).toBe(0);
    expect(result.mobilisationRate).toBe(2100);
  });

  it("round-trips QA inputs and historical calculations without remedial normalisation", () => {
    const qa = normaliseQaInput(qaInput());
    const inputs = createQaProjectInput("EUR", "km", qa);
    const calculations = calculateQaProject(qa, defaultQaRates);
    const project: ProjectRecord = { id: "qa-project", companyId: "company", createdAt: "2026-09-29T00:00:00.000Z", status: "Draft", accountsStatus: "Not Required", inputs, calculations, rateSnapshot: { ...defaultRates, qaRates: defaultQaRates } };
    const restored = rowToProject(projectToRow(project, "00000000-0000-0000-0000-000000000001"));
    expect(restored.inputs.costingModule).toBe("qa");
    expect(restored.inputs.qa?.areas[0].name).toBe("Warehouse A");
    expect(restored.calculations.proposalTotal).toBe(calculations.proposalTotal);
    expect(restored.calculations.qa?.areas[0].productivityM2PerDay).toBe(3000);
  });
});
