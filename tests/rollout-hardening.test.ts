import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateProject } from "@/lib/calculations";
import { errorMessage, errorReference } from "@/lib/monitoring";
import { defaultRepairCatalog } from "@/lib/repairCatalog";
import { defaultRates, emptyInput } from "@/lib/rates";
import { projectToRow, rowToProject } from "@/lib/storage";
import type { ProjectRecord } from "@/lib/types";

describe("rollout hardening", () => {
  it("creates a support reference without leaking the error text into it", () => {
    expect(errorReference(new Date("2026-08-24T12:00:00.000Z"), "a1b2c3d4-e5f6")).toBe("ERR-20260824-A1B2C3");
    expect(errorMessage(new Error("Save failed"))).toBe("Save failed");
    expect(errorMessage({ confidential: "input" })).toBe("An unexpected application error occurred.");
  });

  it("round-trips an active pricing snapshot without changing exact totals", () => {
    const inputs = {
      ...emptyInput,
      projectReference: "RECOVERY-001",
      client: "Recovery Test Client",
      includeGrinding: true,
      grinding: {
        ...emptyInput.grinding,
        enabled: true,
        estimatedDays: 5,
        productionLabourMode: "subcontract" as const,
        productionSubcontractors: [{
          name: "Grinding contractor",
          priceType: "day" as const,
          rate: 1800,
          days: 5,
          margin: 0.3,
          mobilisationCost: 0,
          mobilisations: 0,
          mobilisationMargin: 0.3
        }],
        surveyorLabourMode: "in_house" as const,
        surveyorCount: 1,
        surveyorDays: 5
      }
    };
    const calculations = calculateProject(inputs, defaultRates, defaultRepairCatalog);
    const project: ProjectRecord = {
      id: "recovery-project",
      companyId: "00000000-0000-0000-0000-000000000010",
      createdAt: "2026-08-24T12:00:00.000Z",
      createdBy: "00000000-0000-0000-0000-000000000011",
      status: "Draft",
      accountsStatus: "Not Required",
      inputs,
      calculations,
      rateSnapshot: defaultRates,
      repairCatalogSnapshot: defaultRepairCatalog,
      calculationVersion: "remedial-5.1",
      revisions: [],
      notes: [],
      changeLog: [],
      timeEntries: []
    };

    const row = projectToRow(project, project.createdBy!);
    const restored = rowToProject({ ...row, created_at: project.createdAt });

    expect(restored.inputs).toEqual(project.inputs);
    expect(restored.calculations).toEqual(project.calculations);
    expect(restored.calculations.proposalTotal).toBe(calculations.proposalTotal);
    expect(restored.calculations.budgetCost).toBe(calculations.budgetCost);
    expect(restored.rateSnapshot).toEqual(defaultRates);
    expect(restored.repairCatalogSnapshot).toEqual(defaultRepairCatalog);
    expect(restored.calculationVersion).toBe("remedial-5.1");
  });

  it("retains recycle-bin metadata when an archived database row is reloaded", () => {
    const calculations = calculateProject(emptyInput, defaultRates, defaultRepairCatalog);
    const restored = rowToProject({
      id: "archived-project",
      company_id: "00000000-0000-0000-0000-000000000010",
      created_at: "2026-08-24T12:00:00.000Z",
      deleted_at: "2026-08-24T13:00:00.000Z",
      deleted_by: "00000000-0000-0000-0000-000000000011",
      deletion_reason: "Duplicate project",
      status: "Draft",
      accounts_status: "Not Required",
      inputs: emptyInput,
      calculations,
      revisions: []
    });

    expect(restored.deletedAt).toBe("2026-08-24T13:00:00.000Z");
    expect(restored.deletedBy).toBe("00000000-0000-0000-0000-000000000011");
    expect(restored.deletionReason).toBe("Duplicate project");
    expect(restored.calculations).toEqual(calculations);
  });

  it("keeps PDFKit external so its standard font assets are available in production", () => {
    const nextConfig = readFileSync("next.config.mjs", "utf8");
    expect(nextConfig).toContain('serverComponentsExternalPackages: ["pdfkit"]');
  });
});
