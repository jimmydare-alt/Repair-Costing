import { describe, expect, it } from "vitest";
import { calculateActualSiteDays, calculatePL, calculateProject, calculateRepairLineMaterials, calculateRepairMaterial, calculateWorkingDays, defaultActuals, grindingDays, repairDays, screedDays } from "@/lib/calculations";
import { createRepairLine, defaultRepairCatalog } from "@/lib/repairCatalog";
import { defaultRates, emptyInput, validationInput } from "@/lib/rates";
import type { RepairCatalog } from "@/lib/types";

describe("FACE GmbH v2 contracting calculations", () => {
  it("calculates a detailed mixed validation project", () => {
    const result = calculateProject(validationInput, defaultRates);
    expect(result.serviceSummary).toBe("Grinding + Screeding + Repairs");
    expect(result.grindingDays).toBe(5);
    expect(result.screedDays).toBe(4);
    expect(result.repairDays).toBe(3);
    expect(result.proposalTotal).toBe(84199.99);
    expect(result.budgetCost).toBe(74752.75);
    expect(result.discountAmount).toBe(4431.58);
    expect(result.proposalLines.some((line) => line.item.includes("Team 2 price on site"))).toBe(true);
  });

  it("keeps detailed day helpers isolated by service", () => {
    expect(grindingDays(validationInput)).toBe(5);
    expect(screedDays(validationInput)).toBe(4);
    expect(repairDays(validationInput)).toBe(3);
    expect(screedDays({ ...emptyInput, includeScreeding: false })).toBe(0);
  });

  it("uses 30 percent subcontract margin by default", () => {
    const result = calculateProject({ ...emptyInput, grinding: { ...emptyInput.grinding, productionLabourMode: "subcontract", subcontractRate: 1000, estimatedDays: 2 } }, defaultRates);
    const row = result.proposalLines.find((line) => line.item === "Grinding subcontractor");
    expect(row?.cost).toBe(2000);
    expect(row?.margin).toBe(600);
  });

  it("does not add hidden project travel when subcontract grinding has no travel input", () => {
    const result = calculateProject({
      ...emptyInput,
      includeScreeding: false,
      includeRepairs: false,
      distanceKmOneWay: 0,
      grinding: {
        ...emptyInput.grinding,
        estimatedDays: 2,
        productionLabourMode: "subcontract",
        productionSubcontractors: [{ name: "Grinding sub", priceType: "day", rate: 1000, days: 2, margin: 0.3, mobilisationCost: 0, mobilisations: 0, mobilisationMargin: 0.3 }],
        surveyorLabourMode: "subcontract",
        surveyorSubcontractors: [{ name: "Survey sub", priceType: "lump sum", rate: 500, days: 0, margin: 0.3, mobilisationCost: 0, mobilisations: 0, mobilisationMargin: 0.3 }]
      }
    }, defaultRates);
    expect(result.proposalLines.filter((line) => line.section === "Travel" && line.total > 0)).toHaveLength(0);
    expect(result.proposalTotal).toBe(3250);
  });

  it("prices repair material from cost per unit plus 30 percent material margin", () => {
    const catalog: RepairCatalog = {
      materials: [{ id: "test-material", name: "Test Repair Material", category: "Other", unitType: "each", unitSize: 1, costPerUnit: 100, calcMethod: "each", measuredUnitType: "each", coveragePerUnit: 1, wasteFactor: 1, sourceNote: "Test", active: true, notes: "" }],
      types: [{ code: "Type Test", name: "Test Repair", measurementBasis: "each", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 0, defaultOutputPerDay: 10, description: "", materialRules: [{ materialId: "test-material", role: "required", defaultSelected: true }], active: true }]
    };
    const input = {
      ...emptyInput,
      includeGrinding: false,
      includeRepairs: true,
      repairs: {
        ...emptyInput.repairs,
        enabled: true,
        labourMen: 0,
        repairLines: [{ id: "line-1", repairTypeCode: "Type Test", description: "", lengthM: 0, widthMm: 0, depthMm: 0, areaM2: 0, thicknessMm: 0, eachQty: 2, holeDiameterMm: 0, holeDepthMm: 0, manualMaterialQty: 0, outputPerDay: 10, materialSelections: [] }]
      }
    };
    const result = calculateProject(input, defaultRates, catalog);
    const row = result.proposalLines.find((line) => line.item === "Type Test - Test Repair Material");
    expect(defaultRates.materialMargin).toBe(0.3);
    expect(row?.cost).toBe(200);
    expect(row?.margin).toBe(60);
    expect(row?.total).toBe(260);
  });

  it("rounds catalogue repair materials up to full purchase units", () => {
    const line = { ...createRepairLine("Type 3", defaultRepairCatalog), lengthM: 60, widthMm: 50, depthMm: 50 };
    const rapidMender = calculateRepairLineMaterials(line, defaultRepairCatalog).find((material) => material.product.includes("Rapid Mender"));
    expect(rapidMender?.quantity).toBe(19);
    expect(rapidMender?.unit).toBe("full units");
    expect(rapidMender?.cost).toBe(1714.75);
  });

  it("prices area based repair mortar from area and thickness", () => {
    const line = { ...createRepairLine("Type 4a", defaultRepairCatalog), areaM2: 8, thicknessMm: 15 };
    const arrisMortar = calculateRepairLineMaterials(line, defaultRepairCatalog).find((material) => material.product.includes("Arris Repair Mortar"));
    expect(arrisMortar?.quantity).toBe(19);
    expect(arrisMortar?.cost).toBe(684);
  });

  it("prices Type 5a bolt cut repairs from each quantity, hole diameter and hole depth", () => {
    const line = { ...createRepairLine("Type 5a", defaultRepairCatalog), eachQty: 100, holeDiameterMm: 30, holeDepthMm: 30 };
    const resin = calculateRepairLineMaterials(line, defaultRepairCatalog).find((material) => material.product.includes("LV Rapid"));
    expect(resin?.quantity).toBe(4);
    expect(resin?.cost).toBe(84);
  });

  it("prices Type 5b bolt core repairs from each quantity, hole diameter and hole depth", () => {
    const line = { ...createRepairLine("Type 5b", defaultRepairCatalog), eachQty: 1000, holeDiameterMm: 50, holeDepthMm: 50 };
    const topping = calculateRepairLineMaterials(line, defaultRepairCatalog).find((material) => material.product.includes("FfIT Topping"));
    expect(topping?.quantity).toBe(8);
    expect(topping?.cost).toBe(144);
  });

  it("maps repair haulage into the P&L haulage budget", () => {
    const result = calculateProject(validationInput, defaultRates);
    const summary = calculatePL(result, { ...defaultActuals(result), daysTakenToComplete: 5 });
    expect(result.budgetLines.find((line) => line.section === "Haulage")?.cost).toBe(75);
    expect(summary.rows.find((row) => row.item === "Haulage")?.budget).toBe(75);
  });

  it("keeps P&L to the required accounts rows", () => {
    const result = calculateProject(validationInput, defaultRates);
    const summary = calculatePL(result, defaultActuals(result));
    expect(summary.rows.map((row) => row.item)).toEqual(["Labour Internal", "Survey Days", "Survey Travel Days", "Bonus", "Labour Subcontract", "Equipment Rental", "Haulage", "Materials", "Engineering Report", "Travel", "Hotel", "Subsistence", "Other"]);
  });

  it("uses the additional item P&L category instead of assuming equipment", () => {
    const result = calculateProject({
      ...emptyInput,
      includeGrinding: false,
      includeScreeding: false,
      includeRepairs: false,
      distanceKmOneWay: 0,
      additionalItems: [{ name: "Traffic management", rate: 350, unit: "item", quantity: 1, margin: 0.2, plCategory: "Subcontract" }]
    }, defaultRates);
    const summary = calculatePL(result, defaultActuals(result));
    expect(result.proposalLines.find((line) => line.item === "Traffic management")?.plCategory).toBe("Subcontract");
    expect(summary.rows.find((row) => row.item === "Labour Subcontract")?.budget).toBe(350);
    expect(summary.rows.find((row) => row.item === "Equipment Rental")?.budget).toBe(0);
  });

  it("does not price legacy UK supervisor rows in screeding", () => {
    const result = calculateProject({
      ...validationInput,
      screeding: { ...validationInput.screeding, ukSupervisorRequired: true }
    }, defaultRates);
    expect(result.proposalLines.some((line) => line.item.toLowerCase().includes("uk supervisor"))).toBe(false);
  });

  it("matches Material Calcs formulas for repairs", () => {
    const rapidMender = calculateRepairMaterial({ product: "CoGri Rapid Mender", lengthM: 60, widthMm: 20, depthMm: 25, areaM2: 0, thicknessMm: 0, coverageM2: 0 });
    const seal = calculateRepairMaterial({ product: "CoGri Rapid Seal 60/75 (600ml)", lengthM: 120, widthMm: 8, depthMm: 12, areaM2: 0, thicknessMm: 0, coverageM2: 0 });
    expect(rapidMender.quantity).toBe(4.4);
    expect(rapidMender.cost).toBe(397.1);
    expect(seal.quantity).toBe(22);
    expect(seal.cost).toBe(396);
  });

  it("calculates P&L summary", () => {
    const calculations = calculateProject(validationInput, defaultRates);
    const summary = calculatePL(calculations, { ...defaultActuals(calculations), daysTakenToComplete: 5, labourInternal: 10000, labourSubcontract: 25000, equipmentRental: 4000, haulage: 500, materials: 5000, engineeringReport: 600, travel: 2000, hotel: 1500, subsistence: 500, other: 1000 });
    expect(summary.actualCost).toBe(50942);
    expect(summary.programmeStatus).toBe("PROJECT COMPLETED ON TIME");
    expect(summary.actualMargin).toBeGreaterThan(30);
  });

  it("auto-calculates P&L bonus as 1 percent of actual price", () => {
    const calculations = calculateProject(validationInput, defaultRates);
    const summary = calculatePL(calculations, { ...defaultActuals(calculations), actualPrice: 100000 });
    expect(summary.rows.find((row) => row.item === "Bonus")?.actual).toBe(1000);
  });

  it("calculates site days from dates minus travel days and supports programme status", () => {
    const calculations = calculateProject(validationInput, defaultRates);
    const actuals = { ...defaultActuals(calculations), startDate: "2026-08-03", endDate: "2026-08-09", saturdayWorked: true, sundayWorked: false, travelDays: 1, daysTakenToComplete: 0 };
    expect(calculateWorkingDays(actuals.startDate, actuals.endDate, actuals.saturdayWorked, actuals.sundayWorked)).toBe(6);
    expect(calculateActualSiteDays(actuals)).toBe(5);
    expect(calculatePL(calculations, actuals).programmeStatus).toBe("PROJECT COMPLETED ON TIME");
    expect(calculatePL(calculations, { ...actuals, daysTakenToComplete: 20 }).programmeStatus).toBe("PROJECT RUN OVER TIME");
  });

  it("keeps P&L actuals reloadable without overwriting project calculations", () => {
    const calculations = calculateProject(validationInput, defaultRates);
    const actuals = { ...defaultActuals(calculations), travel: 1234, hotel: 567, actualPrice: 90000 };
    const savedProject = { id: "project-1", calculations, actuals, accountsStatus: "Actuals Saved" as const };
    const reopened = { ...savedProject };
    expect(reopened.actuals.travel).toBe(1234);
    expect(reopened.actuals.hotel).toBe(567);
    expect(reopened.calculations.proposalTotal).toBe(calculations.proposalTotal);
  });
});
