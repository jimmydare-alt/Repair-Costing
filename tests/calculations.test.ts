import { describe, expect, it } from "vitest";
import { calculatedHotelNights, calculateActualSiteDays, calculatePhaseSchedule, calculatePL, calculateProject, calculateProjectRepairMaterials, calculateRepairLineMaterials, calculateWorkingDays, defaultActuals, grindingDays, repairDays, screedDays, screedMaterialUnits, searchRowTone, weekendDaysForProgramme } from "@/lib/calculations";
import { createRepairLine, defaultRepairCatalog } from "@/lib/repairCatalog";
import { applyUsaWorkbookRates, createRemedialProjectInput, defaultRates, emptyInput, validationInput } from "@/lib/rates";
import type { ProjectServiceKey, RepairCatalog } from "@/lib/types";
import { buildHandoverSummary } from "@/lib/handover";

describe("FACE GmbH v2 contracting calculations", () => {
  it("calculates a detailed mixed validation project", () => {
    const result = calculateProject(validationInput, defaultRates);
    expect(result.serviceSummary).toBe("Grinding + Screeding + Repairs");
    expect(result.grindingDays).toBe(5);
    expect(result.screedDays).toBe(4);
    expect(result.repairDays).toBe(3);
    expect(result.proposalTotal).toBe(69261.15);
    expect(result.budgetCost).toBe(61650.75);
    expect(result.discountAmount).toBe(3645.32);
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
        preparationDays: 1,
        screedingDays: 2,
        grindingDays: 1,
        productionLabourMode: "subcontract",
        productionMen: 8,
        productionLabourDays: 9,
        productionHotelRequired: true,
        productionHotelNights: 12,
        productionTravelDays: 4,
        productionOneWayKm: 600,
        teams: [{ enabled: true, contractorName: "Screed sub", scabble: false, prep: true, screed: true, grind: true, mobilisation: 0, mobilisationMargin: 0.3, priceType: "day", daysProgrammed: 4, preparationDays: 1, screedingDays: 2, grindingDays: 1, rate: 2000, margin: 0.3 }],
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
    expect(standardSealant?.quantity).toBe(11);
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

  it("reconciles every displayed P&L budget row to the saved project budget", () => {
    const result = calculateProject({
      ...emptyInput,
      includeGrinding: true,
      grinding: {
        ...emptyInput.grinding,
        enabled: true,
        estimatedDays: 7,
        daysPerWeek: 5,
        productionLabourMode: "in_house",
        productionMen: 2,
        surveyorLabourMode: "in_house",
        surveyorCount: 1,
        surveyorWeekendDays: 1,
        surveyorNightShifts: 2,
        nightShiftRequired: true,
        engineeringReport: true
      },
      additionalItems: [{ name: "Extra accommodation", rate: 125, unit: "night", quantity: 2, margin: 0.2, plCategory: "Hotel/Subsistence" }]
    }, defaultRates);
    const summary = calculatePL(result, defaultActuals(result));
    expect(summary.rows.reduce((sum, row) => sum + row.budget, 0)).toBe(result.budgetCost);
    expect(summary.rows.find((row) => row.item === "Survey Days")?.budget).toBeGreaterThan(defaultRates.surveyorDayRate * 7);
    expect(summary.rows.find((row) => row.item === "Hotel")?.budget).toBe(250);
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

  it("calculates P&L summary", () => {
    const calculations = calculateProject(validationInput, defaultRates);
    const summary = calculatePL(calculations, { ...defaultActuals(calculations), daysTakenToComplete: 5, labourInternal: 10000, labourSubcontract: 25000, equipmentRental: 4000, haulage: 500, materials: 5000, engineeringReport: 600, travel: 2000, hotel: 1500, subsistence: 500, other: 1000 });
    expect(summary.actualCost).toBe(50100);
    expect(summary.programmeStatus).toBe("PROJECT COMPLETED ON TIME");
    expect(summary.actualMargin).toBe(27.67);
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
        startDays: { Grinding: 1, Screeding: 1, Repairs: 6 },
        startsWithPrevious: {}
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
    expect(weekendDaysForProgramme(7, 5, 1)).toBe(1);
    expect(weekendDaysForProgramme(12, 5, 1)).toBe(2);
    expect(weekendDaysForProgramme(14, 5, 2)).toBe(4);
  });

  it("calculates hotel nights from site days, intervening rest days and travel", () => {
    expect(calculatedHotelNights(16, 1, 2)).toBe(19);
    expect(calculatedHotelNights(0, 1, 2)).toBe(0);
  });

  it("starts a blank grinding programme at zero days", () => {
    expect(grindingDays({ ...emptyInput, includeGrinding: true, grinding: { ...emptyInput.grinding, enabled: true } })).toBe(0);
  });

  it("allows service phases to overlap by explicit start day", () => {
    const input = {
      ...emptyInput,
      includeGrinding: true,
      includeScreeding: true,
      grinding: { ...emptyInput.grinding, enabled: true, estimatedDays: 5 },
      screeding: { ...emptyInput.screeding, enabled: true, preparationDays: 1, screedingDays: 4 },
      phaseSchedule: { ...emptyInput.phaseSchedule, startDays: { Grinding: 1, Screeding: 3 } }
    };
    const schedule = calculatePhaseSchedule(input, defaultRepairCatalog);
    expect(schedule.rows.map((row) => [row.service, row.startDay, row.endDay])).toEqual([["Grinding", 1, 5], ["Screeding", 3, 7]]);
    expect(schedule.projectDays).toBe(7);
  });

  it("multiplies 10000 watt generators by count and in-house production days", () => {
    const result = calculateProject({
      ...emptyInput,
      includeGrinding: true,
      grinding: { ...emptyInput.grinding, enabled: true, estimatedDays: 4, productionLabourMode: "in_house", productionMen: 1, surveyorLabourMode: "in_house", surveyorCount: 1, generatorRequired: true, generatorCount: 2 }
    }, defaultRates);
    expect(result.budgetLines.find((line) => line.item === "10000 watt generator")?.quantity).toBe(8);
  });

  it("keeps Type 3 sealant dimensions independent while main width changes Rapid Mender", () => {
    const standard = { ...createRepairLine("Type 3", defaultRepairCatalog), lengthM: 60, widthMm: 50, depthMm: 50 };
    const wider = { ...standard, widthMm: 60 };
    const standardMaterials = calculateRepairLineMaterials(standard, defaultRepairCatalog);
    const widerMaterials = calculateRepairLineMaterials(wider, defaultRepairCatalog);
    expect(standardMaterials.find((row) => row.product.includes("Rapid Mender"))?.quantity).toBe(19);
    expect(widerMaterials.find((row) => row.product.includes("Rapid Mender"))?.quantity).toBe(22);
    expect(widerMaterials.find((row) => row.product.includes("Rapid Seal"))?.quantity).toBe(11);
  });

  it("prices only the selected screeding subcontract activities", () => {
    const result = calculateProject({
      ...emptyInput,
      includeScreeding: true,
      screeding: {
        ...emptyInput.screeding,
        enabled: true,
        preparationDays: 4,
        screedingDays: 3,
        grindingDays: 2,
        productionLabourMode: "subcontract",
        surveyorLabourMode: "subcontract",
        teams: [{ enabled: true, contractorName: "Prep and grind", scabble: false, prep: true, screed: false, grind: true, mobilisation: 0, mobilisationMargin: 0.3, priceType: "day", daysProgrammed: 6, preparationDays: 4, screedingDays: 0, grindingDays: 2, rate: 1000, margin: 0.3 }],
        surveyorSubcontractors: []
      }
    }, defaultRates);
    expect(result.budgetLines.find((line) => line.item.includes("Prep and grind price on site"))?.quantity).toBe(6);
  });

  it("converts company-currency rates into quote currency and reports both totals", () => {
    const result = calculateProject({ ...emptyInput, additionalItems: [{ name: "Quote item", rate: 100, unit: "item", quantity: 1, margin: 0.3, plCategory: "Equipment" }], exchangeRateToCompanyCurrency: 2, exchangeRateToGroupCurrency: 3 }, defaultRates);
    expect(result.proposalTotal).toBe(130);
    expect(result.proposalCompanyCurrency).toBe(260);
    expect(result.proposalGroupCurrency).toBe(390);
  });

  it("prices project management once as a whole-project cost", () => {
    const result = calculateProject({ ...emptyInput, projectManagement: { ...emptyInput.projectManagement, enabled: true, days: 2, visits: 2, travelDays: 1, travelMode: "Drive", oneWayKm: 100, vehicles: 1, hotelNights: 2 } }, defaultRates);
    expect(result.proposalLines.filter((line) => line.item === "Project manager")).toHaveLength(1);
    expect(result.budgetLines.find((line) => line.item === "Project manager")?.total).toBe(defaultRates.projectManagerDayRate * 2);
    expect(result.budgetLines.find((line) => line.item === "Project manager travel days")?.quantity).toBe(1);
    expect(result.budgetLines.find((line) => line.item === "Project manager mileage")?.quantity).toBe(400);
    expect(result.budgetLines.find((line) => line.item === "Project manager hotel")?.quantity).toBe(2);
    expect(result.budgetLines.find((line) => line.item === "Project manager subsistence")?.quantity).toBe(2);
  });

  it("uses a per-mile rate unit without changing the entered distance quantity", () => {
    const result = calculateProject({ ...emptyInput, distanceUnit: "miles", projectManagement: { ...emptyInput.projectManagement, enabled: true, days: 1, visits: 2, travelMode: "Drive", oneWayKm: 100, vehicles: 1 } }, defaultRates);
    const mileage = result.budgetLines.find((line) => line.item === "Project manager mileage");
    expect(mileage?.unit).toBe("mile");
    expect(mileage?.quantity).toBe(400);
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

  it("uses the sum of preparation, screeding and grinding programme days", () => {
    const base = { ...emptyInput, includeScreeding: true, screeding: { ...emptyInput.screeding, enabled: true, preparationDays: 2, screedingDays: 3, grindingDays: 1 } };
    expect(screedDays(base)).toBe(6);
    expect(screedDays({ ...base, screeding: { ...base.screeding, totalDaysOnSite: 4, totalDaysOverrideReason: "Legacy value" } })).toBe(6);
  });

  it("uses overridden in-house production days for grinding equipment", () => {
    const result = calculateProject({ ...emptyInput, includeGrinding: true, grinding: { ...emptyInput.grinding, enabled: true, estimatedDays: 4, productionLabourMode: "in_house", productionMen: 2, productionLabourDays: 6, surveyorLabourMode: "in_house", surveyorCount: 1, surveyorDays: 4, generatorRequired: true, generatorCount: 1, dustVacuums: 1 } }, defaultRates);
    expect(result.budgetLines.find((line) => line.item === "Grinders")?.quantity).toBe(12);
    expect(result.budgetLines.find((line) => line.item === "10000 watt generator")?.quantity).toBe(6);
    expect(result.budgetLines.find((line) => line.item === "Vacuums")?.quantity).toBe(6);
  });

  it("does not price retired project-wide travel inputs", () => {
    const result = calculateProject({ ...emptyInput, travelMode: "Drive", projectTravelPeople: 0, projectTravelProductionPeople: 2, projectTravelSurveyorPeople: 1, projectTravelOtherPeople: 1, distanceKmOneWay: 100, driveTimeDaysOneWay: 1, vehicles: 1 }, defaultRates);
    expect(result.budgetLines.filter((line) => line.item.startsWith("Project ") && line.section === "Travel")).toHaveLength(0);
  });

  it("does not invent a vehicle when the entered vehicle count is zero", () => {
    const result = calculateProject({ ...emptyInput, travelMode: "Drive", projectTravelPeople: 0, projectTravelProductionPeople: 1, distanceKmOneWay: 100, driveTimeDaysOneWay: 1, vehicles: 0 }, defaultRates);
    expect(result.budgetLines.filter((line) => line.section === "Travel" && line.quantity > 0)).toHaveLength(0);
  });

  it("starts new repair lines at zero and does not substitute a missing repair type", () => {
    const line = createRepairLine("Type 1", defaultRepairCatalog);
    expect(line.lengthM).toBe(0);
    expect(line.areaM2).toBe(0);
    expect(line.eachQty).toBe(0);
    const missing = createRepairLine("Deleted Type", defaultRepairCatalog);
    expect(missing.repairTypeCode).toBe("Deleted Type");
    expect(calculateRepairLineMaterials(missing, defaultRepairCatalog)).toHaveLength(0);
  });

  it("builds an internal handover from budget values without sell values", () => {
    const calculations = calculateProject(validationInput, defaultRates);
    const summary = buildHandoverSummary({ id: "handover", createdAt: "2026-08-09", status: "Costing Complete", accountsStatus: "Not Required", inputs: validationInput, calculations });
    expect(summary.materials.length).toBeGreaterThan(0);
    expect(summary.subcontractors.length).toBeGreaterThan(0);
    expect(summary.subcontractors.some((row) => /mobilisation$/i.test(row.description))).toBe(false);
    expect(summary.categories.reduce((sum, row) => sum + row.budget, 0)).toBeCloseTo(calculations.budgetCost, 2);
  });

  it("calculates Type 3 Bondcoat from the repair bottom area only", () => {
    const base = createRepairLine("Type 3", defaultRepairCatalog);
    const selected = base.materialSelections.map((item) => item.materialId === "bondcoat-rbp" ? { ...item, selected: true } : item);
    const standard = calculateRepairLineMaterials({ ...base, lengthM: 60, widthMm: 50, depthMm: 50, materialSelections: selected }, defaultRepairCatalog).find((row) => row.product.includes("Bondcoat"));
    const wider = calculateRepairLineMaterials({ ...base, lengthM: 60, widthMm: 100, depthMm: 200, materialSelections: selected }, defaultRepairCatalog).find((row) => row.product.includes("Bondcoat"));
    expect(standard?.unroundedUnits).toBeCloseTo(0.66, 5);
    expect(wider?.unroundedUnits).toBeCloseTo(1.32, 5);
    expect(wider?.quantity).toBe(2);
  });

  it("calculates Type 4 Bondcoat from entered surface area", () => {
    const base = createRepairLine("Type 4a", defaultRepairCatalog);
    const selected = base.materialSelections.map((item) => item.materialId === "bondcoat-rbp" ? { ...item, selected: true } : item);
    const bondcoat = calculateRepairLineMaterials({ ...base, areaM2: 8, thicknessMm: 15, materialSelections: selected }, defaultRepairCatalog).find((row) => row.product.includes("Bondcoat"));
    expect(bondcoat?.unroundedUnits).toBeCloseTo(1.76, 5);
    expect(bondcoat?.quantity).toBe(2);
  });

  it("calculates Type 5b primer over the complete inside of each hole", () => {
    const base = createRepairLine("Type 5b", defaultRepairCatalog);
    const selected = base.materialSelections.map((item) => item.materialId === "fastprime-5" ? { ...item, selected: true } : item);
    const primer = calculateRepairLineMaterials({ ...base, eachQty: 1000, holeDiameterMm: 50, holeDepthMm: 50, materialSelections: selected }, defaultRepairCatalog).find((row) => row.product.includes("FastPrime"));
    const internalArea = 1000 * (Math.PI * 50 * 50 + Math.PI * 25 * 25) / 1000000;
    expect(primer?.unroundedUnits).toBeCloseTo (((0.14 * internalArea) / 2) * 1.155 / 5, 5);
    expect(primer?.quantity).toBe(1);
  });

  it("uses independent surveyor weekend and night rates", () => {
    const rates = { ...defaultRates, grindingSurveyorWeekendDayRate: 1234, surveyorNightShiftAllowance: 77 };
    const result = calculateProject({ ...emptyInput, includeGrinding: true, grinding: { ...emptyInput.grinding, enabled: true, estimatedDays: 6, weekendDaysPerWeek: 1, nightShiftRequired: true, surveyorLabourMode: "in_house", surveyorCount: 1, surveyorNightShifts: 2, productionLabourMode: "subcontract", productionSubcontractors: [] } }, rates);
    expect(result.budgetLines.find((row) => row.item === "Surveyor weekend extra")?.rate).toBe(1234);
    expect(result.budgetLines.find((row) => row.item === "Surveyor night-shift allowance")?.rate).toBe(77);
  });

  it("loads the verified USA remedial rates without changing Survey Costing rates", () => {
    const surveyRates = { ...defaultRates.surveyRates!, surveyorBudgetDayRate: 617, surveyorMarkup: 1.127 };
    const usa = applyUsaWorkbookRates({ ...defaultRates, surveyRates });
    expect(usa.surveyRates).toEqual(surveyRates);
    expect(usa.productionLabourDayRate).toBe(400);
    expect(usa.grindingSurveyorDayRate * (1 + (usa.rateMargins?.grindingSurveyorDayRate ?? 0))).toBeCloseTo(1000, 6);
    expect(usa.grindingSurveyorTravelDayRate * (1 + (usa.rateMargins?.grindingSurveyorTravelDayRate ?? 0))).toBeCloseTo(700, 6);
    expect(usa.grindingHotelNightRate * (1 + (usa.rateMargins?.grindingHotelNightRate ?? 0))).toBe(210);
    expect(usa.screedSurveyorDayRate * (1 + (usa.rateMargins?.screedSurveyorDayRate ?? 0))).toBe(1000);
    expect(usa.screedHotelNightRate * (1 + (usa.rateMargins?.screedHotelNightRate ?? 0))).toBe(210);
    expect(usa.mileagePerKm * (1 + (usa.rateMargins?.mileagePerKm ?? 0))).toBeCloseTo(0.948, 6);
  });

  it("prefills new USA screeding rates but keeps every material quantity at zero", () => {
    const usa = applyUsaWorkbookRates(defaultRates);
    const input = createRemedialProjectInput(usa, "USD", "miles");
    expect(input.screeding.screedMaterialBags).toBe(0);
    expect(input.screeding.primerUnits).toBe(0);
    expect(input.screeding.sandBags).toBe(0);
    expect(input.screeding.screedMaterialRate).toBe(40);
    expect(input.screeding.primerRate).toBe(288);
    expect(input.screeding.sandRate).toBe(8);
    expect(input.screeding.primerContingency + input.screeding.primerWaste).toBeCloseTo(0.1, 6);
    expect(calculateProject(input, usa).proposalTotal).toBe(0);
  });

  it("matches the Screed Rev.7 material quantity and proposal formulas", () => {
    const usa = applyUsaWorkbookRates(defaultRates);
    const blank = createRemedialProjectInput(usa, "USD", "miles");
    const input = {
      ...blank,
      includeScreeding: true,
      screeding: {
        ...blank.screeding,
        enabled: true,
        productionLabourMode: "subcontract" as const,
        surveyorLabourMode: "subcontract" as const,
        teams: [],
        surveyorSubcontractors: [],
        screedMaterialBags: 100,
        primerUnits: 10,
        sandBags: 20
      }
    };
    const result = calculateProject(input, usa);
    expect(screedMaterialUnits(100, 0, 0)).toBe(100);
    expect(screedMaterialUnits(10, 0.05, 0.05)).toBe(11);
    expect(screedMaterialUnits(20, 0.05, 0.05)).toBe(22);
    expect(result.proposalLines.find((row) => row.item === "Screed material")?.originalTotal).toBe(5000);
    expect(result.proposalLines.find((row) => row.item === "Primer")?.originalTotal).toBe(3960);
    expect(result.proposalLines.find((row) => row.item === "Sand")?.originalTotal).toBe(220);
    expect(result.proposalTotal).toBe(9180);
    expect(result.budgetCost).toBe(7344);
  });

  it("uses service-specific USA grinding surveyor rates", () => {
    const usa = applyUsaWorkbookRates(defaultRates);
    const blank = createRemedialProjectInput(usa, "USD", "miles");
    const result = calculateProject({
      ...blank,
      includeGrinding: true,
      grinding: {
        ...blank.grinding,
        enabled: true,
        estimatedDays: 6,
        weekendDaysPerWeek: 1,
        productionLabourMode: "subcontract",
        productionSubcontractors: [],
        surveyorLabourMode: "in_house",
        surveyorCount: 1,
        surveyorDays: 6,
        surveyorTravelDays: 1,
        surveyorOneWayKm: 100,
        surveyorVehicles: 1,
        surveyorHotelRequired: true,
        surveyorHotelNights: 1,
        engineeringReport: true
      }
    }, usa);
    expect(result.proposalLines.find((row) => row.item === "Surveyor labour")?.originalTotal).toBe(6000);
    expect(result.proposalLines.find((row) => row.item === "Surveyor weekend extra")?.originalTotal).toBe(360);
    expect(result.proposalLines.find((row) => row.item === "Surveyor travel")?.originalTotal).toBe(700);
    expect(result.proposalLines.find((row) => row.item === "Surveyor mileage")?.originalTotal).toBe(189.6);
    expect(result.proposalLines.find((row) => row.item === "Surveyor hotel")?.originalTotal).toBe(210);
    expect(result.proposalLines.find((row) => row.item === "Engineering report")?.originalTotal).toBe(600);
  });

  it("uses per-project shipping markup and reconciles discounts exactly", () => {
    const result = calculateProject({ ...emptyInput, includeScreeding: true, discountPercentage: 7.25, screeding: { ...emptyInput.screeding, enabled: true, preparationDays: 1, productionLabourMode: "subcontract", surveyorLabourMode: "subcontract", surveyorSubcontractors: [], materialShipping: 100, materialShippingMargin: 0.1, teams: [] }, additionalItems: [{ name: "Extra", rate: 19.99, unit: "item", quantity: 3, margin: 0.27, plCategory: "Equipment" }] }, defaultRates);
    expect(result.proposalLines.find((row) => row.item === "Shipping of materials")?.originalTotal).toBe(110);
    expect(result.proposalLines.reduce((sum, row) => sum + row.discount, 0)).toBe(result.discountAmount);
    expect(result.originalProposalTotal - result.proposalTotal).toBe(result.discountAmount);
  });

  it("distinguishes an untouched P&L from an in-progress result and preserves both profit views", () => {
    const calculations = calculateProject(validationInput, defaultRates);
    const untouched = calculatePL(calculations, defaultActuals(calculations));
    expect(untouched.started).toBe(false);
    expect(untouched.programmeStatus).toBe("P&L NOT STARTED");
    const changed = calculatePL(calculations, { ...defaultActuals(calculations), actualPrice: calculations.proposalTotal + 1000, materials: 500 });
    expect(changed.started).toBe(true);
    expect(changed.originalBudgetProfit).toBeCloseTo(calculations.proposalTotal - calculations.budgetCost, 2);
    expect(changed.budgetProfit).toBeCloseTo(calculations.proposalTotal + 1000 - calculations.budgetCost, 2);
  });

  it("reconciles line, project and P&L totals across representative rollout projects", () => {
    const repairLine = { ...createRepairLine("Type 3", defaultRepairCatalog), lengthM: 80, widthMm: 75, depthMm: 60 };
    const projects = [
      { ...emptyInput, discountPercentage: 3.75, includeGrinding: true, grinding: { ...emptyInput.grinding, enabled: true, estimatedDays: 5, productionLabourMode: "subcontract" as const, productionSubcontractors: [{ name: "Grinding contractor", priceType: "day" as const, rate: 1800, days: 5, margin: 0.3, mobilisationCost: 500, mobilisations: 1, mobilisationMargin: 0.3 }], surveyorLabourMode: "in_house" as const, surveyorCount: 1, surveyorDays: 5 } },
      { ...emptyInput, discountPercentage: 6.2, includeScreeding: true, screeding: { ...emptyInput.screeding, enabled: true, preparationDays: 2, screedingDays: 4, grindingDays: 1, productionLabourMode: "both" as const, productionMen: 2, productionLabourDays: 7, surveyorLabourMode: "in_house" as const, surveyors: 1, surveyorDays: 7, screedMaterialBags: 100, screedMaterialRate: 18, materialShipping: 650, materialShippingMargin: 0.18, teams: [{ enabled: true, contractorName: "Screed contractor", scabble: false, prep: true, screed: true, grind: false, mobilisation: 400, mobilisationMargin: 0.3, priceType: "day" as const, daysProgrammed: 6, preparationDays: 2, screedingDays: 4, grindingDays: 0, rate: 1400, margin: 0.3 }] } },
      { ...emptyInput, discountPercentage: 2.4, includeRepairs: true, repairs: { ...emptyInput.repairs, enabled: true, labourMode: "subcontract" as const, labourDays: 4, repairLines: [repairLine], repairSubcontractors: [{ name: "Repair contractor", priceType: "lump sum" as const, rate: 6200, days: 4, margin: 0.3, mobilisationCost: 0, mobilisations: 0, mobilisationMargin: 0.3 }], haulageItems: [{ name: "Material delivery", rate: 180, unit: "item", quantity: 2, margin: 0.3 }] } }
    ];
    projects.forEach((input) => {
      const calculations = calculateProject(input, defaultRates);
      expect(calculations.proposalLines.reduce((sum, row) => sum + row.discount, 0)).toBe(calculations.discountAmount);
      expect(calculations.proposalLines.reduce((sum, row) => sum + row.total, 0)).toBeCloseTo(calculations.proposalTotal, 2);
      expect(calculations.budgetLines.reduce((sum, row) => sum + row.total, 0)).toBeCloseTo(calculations.budgetCost, 2);
      calculations.proposalLines.forEach((row) => {
        expect(row.cost + row.margin).toBeCloseTo(row.originalTotal, 2);
        expect(row.originalTotal - row.discount).toBeCloseTo(row.total, 2);
      });
      const summary = calculatePL(calculations, defaultActuals(calculations));
      expect(summary.rows.reduce((sum, row) => sum + row.budget, 0)).toBeCloseTo(calculations.budgetCost, 2);
    });
  });
});
