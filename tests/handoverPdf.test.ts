import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateProject } from "@/lib/calculations";
import { renderHandoverPdf } from "@/lib/handoverPdf";
import { defaultRates, validationInput } from "@/lib/rates";
import type { ProjectRecord } from "@/lib/types";

function validationProject(): ProjectRecord {
  return {
    id: "handover-preview",
    companyId: "face-gmbh",
    createdAt: "2026-08-24T09:00:00.000Z",
    status: "Costing Complete",
    accountsStatus: "Not Required",
    inputs: {
      ...validationInput,
      projectReference: "FACE-VAL-001",
      client: "Validation Distribution GmbH",
      location: "Hamburg Logistics Campus, Building 4",
      projectType: "Warehouse floor remediation and screed installation",
      costedBy: "James Dare",
      revision: "3"
    },
    calculations: calculateProject(validationInput, defaultRates)
  };
}

describe("handover PDF", () => {
  it("renders a branded, multi-page delivery pack from the saved project costing", async () => {
    const logo = await readFile(join(process.cwd(), "public", "face-logo.png"));
    const pdf = await renderHandoverPdf({
      project: validationProject(),
      company: { name: "FACE Consultants GmbH", primaryColour: "#0067a6", darkColour: "#07182f", logo },
      generatedAt: new Date("2026-08-24T10:30:00.000Z"),
      generatedBy: "james.dare@cogrigroup.com"
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(10_000);
    const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(2);
    expect(pageCount).toBeLessThanOrEqual(4);

    const previewPath = process.env.HANDOVER_PREVIEW_PATH;
    if (previewPath) {
      await mkdir(dirname(previewPath), { recursive: true });
      await writeFile(previewPath, pdf);
    }
  });
});
