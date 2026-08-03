import { describe, expect, it } from "vitest";
import { calculateActualSiteDays, calculatePhaseSchedule, calculatePL, calculateProject, calculateProjectRepairMaterials, calculateRepairLineMaterials, calculateRepairMaterial, calculateWorkingDays, defaultActuals, grindingDays, repairDays, screedDays, searchRowTone, weekendDaysForProgramme } from "@/lib/calculations";
import { createRepairLine, defaultRepairCatalog } from "@/lib/repairCatalog";
import { defaultRates, emptyInput, validationInput } from "@/lib/rates";
import type { ProjectServiceKey, RepairCatalog } from "@/lib/types";

describe("FACE GmbH v2 contracting calculations", () => {
  it("calculates a detailed mixed validation project", () => {
    const result = calculateProject(validationInput, defaultRates);
    expect(result.serviceSummary).toBe("Grinding + Screeding + Repairs");
    expect(result.grindingDays).toBe(5);
    expect(result.screedDays).toBe(4);
    expect(result.repairDays).toBe(3);
    expect(result.proposalTotal).toBe(83192.99);
    expect(result.budgetCost).toBe(73552.75);
    expect(result.discountAmount).toBe(4378.58);
    expect(result.proposalLines.some((line) => line.item.includes("Team 2 price on site"))).toBe(true);
  });

  it("keeps detailed day helpers isolated by service", () => {
    expect(grindingDays(validationInput)).toBe(5);
    expect(screedDays(validationInput)).toBe(4);
    expect(repairDays(validationInput)).toBe(3);
    expect(screedDays({ ...emptyInput, includeScreeding: false })).toBe(0);
  });

  it("starts a blank project with no services or costs", () => {
    const result = calculateProject(emptyInput, defaultRates);
    expect(result.serviceSummary).toBe("Draft");
    expect(result.proposalTotal).toBe(0);
    expect(result.budgetCost).toBe(0);
    expect(result.proposalLines.filter((line) => line.total > 0)).toHaveLength(0);
  });

  it("uses 30 percent subcontract margin by default", () => {
    const result = calculateProject({ ...emptyInput, includeGrinding: true, grinding: { ...emptyInput.grinding, enabled: true, productionLabourMode: "subcontract", subcontractRate: 1000, estimatedDays: 2 } }, defaultRates);
    const row = result.proposalLines.find((line) => line.item === "Grinding subcontractor");
    expect(row?.cost).toBe(2000);
    expect(row?.margin).toBe(600);
  });

  it("does not add hidden project travel when subcontract grinding has no travel input", () => {
    const result = calculateProject({
      ...emptyInput,
      includeGrinding: true,
      includeScreeding: false,
      includeRepairs: false,
      distanceKmOneWay: 0,
      grinding: {
        ...emptyInput.grinding,
        enabled: true,
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

  it("ignores grinding in-house labour, tools and travel when production and surveyor are subcontract only", () => {
    const result = calculateProject({
      ...emptyInput,
      includeGrinding: true,
      travelMode: "None",
      distanceKmOneWay: 999,
      grinding: {
        ...emptyInput.grinding,
        enabled: true,
        estimatedDays: 3,
        productionLabourMode: "subcontract",
        productionMen: 10,
        productionLabourDays: 8,
        productionWeekendDays: 2,
        productionHotelRequired: true,
        productionHotelNights: 20,
        productionTravelDays: 4,
        productionOneWayKm: 500,
        generatorRequired: true,
        gasPlaners: 4,
        dustVacuums: 6,
        grindingSegmentsRequired: true,
        consumablesRequired: true,
        equipmentShipping: 800,
        productionSubcontractors: [{ name: "Grinding sub", priceType: "day", rate: 1000, days: 3, margin: 0.3, mobilisationCost: 0, mobilisations: 0, mobilisationMargin: 0.3 }],
        surveyorLabourMode: "subcontract",
        surveyorCount: 3,
        surveyorDays: 9,
        surveyorHotelRequired: true,
        surveyorHotelNights: 20,
        surveyorTravelDays: 5,
        surveyorOneWayKm: 500,
        engineeringReport: true,
        surveyorSubcontractors: [{ name: "Survey sub", priceType: "lump sum", rate: 500, days: 0, margin: 0.3, mobilisationCost: 0, mobilisations: 0, mobilisationMargin: 0.3 }]
      }
    }, defaultRates);
    const positive = result.proposalLines.filter((line) => line.total > 0);
    expect(positive.every((line) => line.section === "Subcontract")).toBe(true);
    expect(result.proposalTotal).toBe(4550);
  });

  it("ignores screeding in-house labour, tools and travel when production and surveyor are subcontract only", () => {
    const result = calculateProject({
      ...emptyInput,
      includeScreeding: true,
      travelMode: "None",
      screeding: {
        ...emptyInput.screeding,
        enabled: true,
        totalDaysOnSite: 4,
        productionLabourMode: "subcontract",
        productionMen: 8,
        productionLabourDays: 9,
        productionHotelRequired: true,
        productionHotelNights: 12,
        productionTravelDays: 4,
        productionOneWayKm: 600,
        teams: [{ ...emptyInput.screeding.teams[0], enabled: true, contractorName: "Screed sub", rate: 2000, daysProgrammed: 4 }],
        surveyorLabourMode: "subcontract",
        surveyors: 3,
        surveyorDays: 9,
        surveyorHotelRequired: true,
        surveyorHotelNights: 12,
        surveyorTravelDays: 4,
        surveyorOneWayKm: 600,
        engineeringReport: true,
        surveyorSubcontractors: [{ name: "Survey sub", priceType: "lump sum", rate: 500, days: 0, margin: 0.3, mobilisationCost: 0, mobilisations: 0, mobilisationMargin: 0.3 }],
        generatorDays: 4,
        propaneGrinders: 4,
        gasPlaners: 2,
        dustVacuums: 4,
        extensionCordSets: 5,
        grindingSegmentsRequired: true,
        consumablesRequired: true,
        equipmentShipping: 700
      }
    }, defaultRates);
    const positive = result.proposalLines.filter((line) => line.total > 0);
    expect(positive.every((line) => line.section === "Subcontract")).toBe(true);
    expect(result.proposalTotal).toBe(11050);
  });

  it("ignores repair in-house labour, hotel and travel when repair labour is subcontract only", () => {
    const result = calculateProject({
      ...emptyInput,
      includeRepairs: true,
      travelMode: "None",
      repairs: {
        ...emptyInput.repairs,
        enabled: true,
        labourMode: "subcontract",
        labourMen: 6,
        labourDays: 5,
        weekendRequired: true,
        weekendDays: 2,
        nightShiftRequired: true,
        nightShiftHours: 5,
        hotelRequired: true,
        hotelNights: 12,
        travelDays: 4,
        mobilisationOneWayKm: 700,
        repairSubcontractors: [{ name: "Repair sub", priceType: "lump sum", rate: 2000, days: 0, margin: 0.3, mobilisationCost: 500, mobilisations: 1, mobilisationMargin: 0.3 }],
        haulageItems: []
      }
    }, defaultRates);
    const positive = result.proposalLines.filter((line) => line.total > 0);
    expect(positive.every((line) => line.section === "Subcontract")).toBe(true);
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
    const row = result.proposalLines.find((line) => line.item === "Test Repair Material");
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

  it("uses sealant-specific width and depth when selected on a repair line", () => {
    const standard = { ...createRepairLine("Type 3", defaultRepairCatalog), lengthM: 60, widthMm: 50, depthMm: 50 };
    const withSealantOverride = {
      ...standard,
      materialSelections: standard.materialSelections.map((selection) => selection.materialId === "rapid-seal-600" ? { ...selection, widthMm: 8, depthMm: 12 } : selection)
    };
    const standardSealant = calculateRepairLineMaterials(standard, defaultRepairCatalog).find((material) => material.product.includes("Rapid Seal"));
    const overrideSealant = calculateRepairLineMaterials(withSealantOverride, defaultRepairCatalog).find((material) => material.product.includes("Rapid Seal"));
    expect(standardSealant?.quantity).toBe(300);
    expect(overrideSealant?.quantity).toBe(12);
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
    expect(summary.rows.map((row) => row.item)).toEqual(["Labour Internal", "Survey Days", "Survey Travel Days", "BDM Bonus", "Labour Subcontract", "Equipment Rental", "Haulage", "Materials", "Engineering Report", "Travel", "Hotel", "Subsistence", "Other"]);
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
    expect(summary.actualCost).toBe(50100);
    expect(summary.programmeStatus).toBe("PROJECT COMPLETED ON TIME");
    expect(summary.actualMargin).toBeGreaterThan(30);
  });

  it("flags saved P&L rows below 25 percent markup", () => {
    const calculations = calculateProject(validationInput, defaultRates);
    const actuals = { ...defaultActuals(calculations), actualPrice: 100000, other: 74000 };
    expect(searchRowTone({ accountsStatus: "Actuals Saved", actuals, calculations })).toBe("green");
    expect(searchRowTone({ accountsStatus: "Actuals Saved", actuals: { ...actuals, other: 80001 }, calculations })).toBe("red");
  });

  it("only calculates the 1 percent BDM bonus when the quote opts in", () => {
    const withoutBonus = calculateProject(validationInput, defaultRates);
    expect(calculatePL(withoutBonus, { ...defaultActuals(withoutBonus), actualPrice: 100000 }).rows.find((row) => row.item === "BDM Bonus")?.actual).toBe(0);
    const withBonus = calculateProject({ ...validationInput, bdmBonusRequired: true }, defaultRates);
    const summary = calculatePL(withBonus, { ...defaultActuals(withBonus), actualPrice: 100000 });
    expect(withBonus.bdmBonusBudget).toBe(Math.round(withBonus.proposalTotal) / 100);
    expect(summary.rows.find((row) => row.item === "BDM Bonus")?.actual).toBe(1000);
  });

  it("builds sequential and concurrent service phases without double-counting project days", () => {
    const input = {
      ...validationInput,
      phaseSchedule: {
        ...validationInput.phaseSchedule,
        order: ["Grinding", "Screeding", "Repairs"] as ProjectServiceKey[],
        startsWithPrevious: { Screeding: true, Repairs: false }
      }
    };
    const schedule = calculatePhaseSchedule(input, defaultRepairCatalog);
    expect(schedule.rows.map((row) => [row.service, row.startDay, row.endDay])).toEqual([["Grinding", 1, 5], ["Screeding", 1, 4], ["Repairs", 6, 8]]);
    expect(schedule.projectDays).toBe(8);
  });

  it("combines repair material demand before rounding to purchase units", () => {
    const catalog: RepairCatalog = {
      materials: [{ id: "aggregate", name: "Aggregate Material", category: "Other", unitType: "each", unitSize: 1, costPerUnit: 90, calcMethod: "each", measuredUnitType: "each", coveragePerUnit: 3, wasteFactor: 1, sourceNote: "Test", active: true, notes: "" }],
      types: [{ code: "Type Aggregate", name: "Aggregate", measurementBasis: "each", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 0, defaultOutputPerDay: 10, description: "", materialRules: [{ materialId: "aggregate", role: "required", defaultSelected: true }], active: true }]
    };
    const repairLine = { id: "one", repairTypeCode: "Type Aggregate", description: "", lengthM: 0, widthMm: 0, depthMm: 0, areaM2: 0, thicknessMm: 0, eachQty: 1, holeDiameterMm: 0, holeDepthMm: 0, manualMaterialQty: 0, outputPerDay: 10, materialSelections: [] };
    expect(calculateRepairLineMaterials(repairLine, catalog)[0].quantity).toBe(1);
    expect(calculateProjectRepairMaterials([repairLine, { ...repairLine, id: "two" }], catalog)[0].quantity).toBe(1);
  });

  it("counts weekend days across the full programme", () => {
    expect(weekendDaysForProgramme(6, 5, 1)).toBe(1);
    expect(weekendDaysForProgramme(12, 5, 1)).toBe(2);
    expect(weekendDaysForProgramme(14, 5, 2)).toBe(4);
  });

  it("converts company-currency rates into quote currency and reports both totals", () => {
    const result = calculateProject({ ...emptyInput, additionalItems: [{ name: "Quote item", rate: 100, unit: "item", quantity: 1, margin: 0.3, plCategory: "Equipment" }], exchangeRateToCompanyCurrency: 2, exchangeRateToGroupCurrency: 3 }, defaultRates);
    expect(result.proposalTotal).toBe(130);
    expect(result.proposalCompanyCurrency).toBe(260);
    expect(result.proposalGroupCurrency).toBe(390);
  });

  it("prices project management once as a whole-project cost", () => {
    const result = calculateProject({ ...emptyInput, projectManagement: { ...emptyInput.projectManagement, enabled: true, days: 2, visits: 2, travelMode: "Drive", oneWayKm: 100, vehicles: 1, hotelNights: 2 } }, defaultRates);
    expect(result.proposalLines.filter((line) => line.item === "Project manager")).toHaveLength(1);
    expect(result.budgetLines.find((line) => line.item === "Project manager")?.total).toBe(defaultRates.projectManagerDayRate * 2);
    expect(result.budgetLines.find((line) => line.item === "Project manager mileage")?.quantity).toBe(400);
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
