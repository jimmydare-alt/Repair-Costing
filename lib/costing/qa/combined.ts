import { calculateSurveyProject, surveyRatesInQuoteCurrency } from "../survey/calculations";
import type { SurveyAdminRates, SurveyInput } from "../survey/types";
import { calculateQaProject, qaRatesInQuoteCurrency } from "./calculations";
import type { QaAdminRates, QaInput } from "./types";
import type { Line, ProjectCalculations, WorkPackageCalculationSummary } from "../../types";

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const sum = (lines: Line[], key: "cost" | "total" | "originalTotal") => round(lines.reduce((total, line) => total + line[key], 0));

function packageLine(line: Line, id: string, name: string, code: string, sharedCostForPackageIds?: string[]): Line {
  return { ...line, workPackageId: id, workPackageName: name, workPackageCode: code, commercialGroup: "package", sharedCostForPackageIds };
}

function commonLine(line: Line): Line {
  return { ...line, workPackageId: undefined, workPackageName: "Shared logistics", workPackageCode: undefined, commercialGroup: "common" };
}

function qaLinePackage(line: Line, rates: QaAdminRates) {
  const designLabels = Object.values(rates.rates).filter((rate) => rate.group === "design").map((rate) => rate.label);
  const travelLabels = Object.values(rates.rates).filter((rate) => rate.group === "travel").map((rate) => rate.label);
  if (designLabels.some((label) => line.item.includes(label))) return "design" as const;
  if (travelLabels.some((label) => line.item.includes(label))) return "travel" as const;
  if (line.section === "Additional items") return "common" as const;
  return "supervision" as const;
}

function isSurveyVisitCost(line: Line) {
  if (line.item === "Subcontracted Survey Mobilisation" || line.item === "Equipment Shipping") return false;
  return line.plCategory === "Travel" || line.plCategory === "Hotel/Subsistence" || (line.costKind === "mobilisation" && line.plCategory === "Labour");
}

function directLine(item: string, budgetRate: number, quantity: number, markup: number, section: Line["section"], plCategory: Line["plCategory"], discountPercentage = 0): { proposal: Line; budget: Line } {
  const cost = round(Math.max(0, budgetRate) * Math.max(0, quantity));
  const originalTotal = round(cost * (1 + Math.max(0, markup)));
  const total = round(originalTotal * (1 - Math.min(100, Math.max(0, discountPercentage)) / 100));
  const base: Line = { section, item, rate: Math.max(0, budgetRate), unit: "item", quantity: Math.max(0, quantity), cost, margin: round(total - cost), total, discount: round(originalTotal - total), originalTotal, source: "QA-assisted survey calculation", plCategory };
  return { proposal: base, budget: { ...base, margin: 0, total: cost, originalTotal: cost, discount: 0 } };
}

function summary(id: string, code: string, name: string, service: "Survey" | "QA", lines: Line[], budgetLines: Line[], days: number, basis: "fixed" | "day_rate"): WorkPackageCalculationSummary {
  const proposalTotal = sum(lines, "total");
  const budgetCost = sum(budgetLines, "total");
  return {
    id, code, name, service, selected: true, pricingBasis: basis, mobilisationMode: "separate", days, startDay: 0,
    proposalTotal, budgetCost, budgetMarkup: budgetCost ? round((proposalTotal - budgetCost) / budgetCost * 100) : 0, materialTypes: 0
  };
}

function totals(base: ProjectCalculations, proposalLines: Line[], budgetLines: Line[], companyExchange = 1, groupExchange = 1) {
  const proposalTotal = sum(proposalLines, "total");
  const budgetCost = sum(budgetLines, "total");
  const budgetProfit = round(proposalTotal - budgetCost);
  return {
    ...base,
    proposalLines,
    budgetLines,
    proposalTotal,
    budgetCost,
    budgetProfit,
    budgetMargin: proposalTotal ? round(budgetProfit / proposalTotal * 100) : 0,
    budgetMarkup: budgetCost ? round(budgetProfit / budgetCost * 100) : 0,
    proposalCompanyCurrency: round(proposalTotal * companyExchange),
    budgetCompanyCurrency: round(budgetCost * companyExchange),
    proposalGroupCurrency: round(proposalTotal * groupExchange),
    budgetGroupCurrency: round(budgetCost * groupExchange),
    mobilisationRate: sum(proposalLines.filter((line) => line.costKind === "mobilisation"), "total"),
    mobilisationBudget: sum(budgetLines.filter((line) => line.costKind === "mobilisation"), "total"),
    travelTotal: sum(proposalLines.filter((line) => line.plCategory === "Travel"), "total"),
    haulageTotal: sum(proposalLines.filter((line) => line.plCategory === "Haulage"), "total"),
    standbyRate: sum(proposalLines.filter((line) => line.costKind === "stand_down"), "total")
  };
}

export function calculateIntegratedQaProject(qaInput: QaInput, surveyInput: SurveyInput | undefined, qaRates: QaAdminRates, surveyRates: SurveyAdminRates) {
  const companyExchange = Number(qaInput.exchangeRateToCompanyCurrency) > 0 ? Number(qaInput.exchangeRateToCompanyCurrency) : 1;
  const groupExchange = Number(qaInput.exchangeRateToGroupCurrency) > 0 ? Number(qaInput.exchangeRateToGroupCurrency) : 1;
  const sharedVisit = qaInput.surveyIncluded && qaInput.siteSupervisionIncluded && qaInput.visitMode === "shared";
  const sharedOwner = qaInput.sharedTravelOwner === "qa" ? "qa" : "survey";
  const sharedPackageIds = ["survey", "qa-supervision"];
  const qaForCalculation = {
    ...qaInput,
    areas: qaInput.areas.map((area) => ({
      ...area,
      designReviewRequired: qaInput.designReviewIncluded && area.designReviewRequired,
      supervisionRequired: qaInput.siteSupervisionIncluded && area.supervisionRequired
    })),
    sharedTravelOwnerProjectId: sharedVisit && sharedOwner === "survey" ? "embedded-survey" : ""
  };
  const qa = calculateQaProject(qaForCalculation, qaRates);
  const survey = qaInput.surveyIncluded && surveyInput ? calculateSurveyProject(surveyInput, surveyRates) : undefined;
  const qaAssisted = Boolean(survey && qaInput.siteSupervisionIncluded && qaInput.surveyDeliveryMode === "qa_assisted");

  const proposalLines: Line[] = [];
  const budgetLines: Line[] = [];
  if (survey) {
    const separateTestVisit = Boolean(surveyInput?.selectedTests.some((item) => item.visitMode !== "qa_visit"));
    const includeQaAssistedLine = (line: Line) => {
      if (line.item.startsWith("Test - ") || line.item === "Error Plan" || line.section === "Equipment" || line.section === "Haulage" || line.section === "Additional items") return true;
      if (separateTestVisit && isSurveyVisitCost(line)) return true;
      return false;
    };
    const includeSurveyLine = (line: Line) => qaAssisted
      ? includeQaAssistedLine(line)
      : !(sharedVisit && sharedOwner === "qa" && isSurveyVisitCost(line));
    proposalLines.push(...survey.proposalLines.filter(includeSurveyLine).map((line) => packageLine(line, "survey", "Survey", "A", sharedVisit && sharedOwner === "survey" && isSurveyVisitCost(line) ? sharedPackageIds : undefined)));
    budgetLines.push(...survey.budgetLines.filter(includeSurveyLine).map((line) => packageLine(line, "survey", "Survey", "A", sharedVisit && sharedOwner === "survey" && isSurveyVisitCost(line) ? sharedPackageIds : undefined)));
    if (qaAssisted && surveyInput) {
      const surveyQuoteRates = surveyRatesInQuoteCurrency(surveyRates, companyExchange);
      const report = directLine("Survey Analysis & Reporting", surveyQuoteRates.qaAssistedAnalysisReportBudgetRate, 1, surveyQuoteRates.qaAssistedAnalysisReportMarkup, "Reports", "Labour", surveyInput.discountPercentage);
      proposalLines.push(packageLine(report.proposal, "survey", "Survey", "A"));
      budgetLines.push(packageLine(report.budget, "survey", "Survey", "A"));
      const extraDays = Math.max(0, Math.round(qaInput.qaAssistedAdditionalSurveyDays));
      if (extraDays > 0) {
        const qaQuoteRates = qaRatesInQuoteCurrency(qaRates, companyExchange);
        const subcontract = qaInput.areas.find((area) => area.supervisionRequired)?.supervisionDeliveryMode === "subcontract";
        const dayRate = qaQuoteRates.rates[subcontract ? "subcontractSupervisionDay" : "internalSupervisionDay"];
        const extra = directLine("Additional QA Engineer Survey Day", dayRate.budgetRate, extraDays, dayRate.markup, dayRate.section, dayRate.plCategory, surveyInput.discountPercentage);
        extra.proposal.unit = "day";
        extra.budget.unit = "day";
        proposalLines.push(packageLine(extra.proposal, "survey", "Survey", "A"));
        budgetLines.push(packageLine(extra.budget, "survey", "Survey", "A"));
      }
    }
  }
  const mapQaLine = (line: Line) => {
    const group = qaLinePackage(line, qaRates);
    if (group === "design") return packageLine(line, "qa-design", "Design Review", survey ? "B" : "A");
    if (group === "supervision") return packageLine(line, "qa-supervision", "Site Supervision", survey ? "C" : qaInput.designReviewIncluded ? "B" : "A");
    if (group === "travel" && qaInput.siteSupervisionIncluded) return packageLine(line, "qa-supervision", "Site Supervision", survey ? "C" : qaInput.designReviewIncluded ? "B" : "A", sharedVisit && sharedOwner === "qa" ? sharedPackageIds : undefined);
    if (group === "travel" && qaInput.designReviewIncluded) return packageLine(line, "qa-design", "Design Review", survey ? "B" : "A");
    return commonLine(line);
  };
  proposalLines.push(...qa.proposalLines.map(mapQaLine));
  budgetLines.push(...qa.budgetLines.map(mapQaLine));

  const packages: WorkPackageCalculationSummary[] = [];
  if (survey) packages.push(summary("survey", "A", "Survey", "Survey", proposalLines.filter((line) => line.workPackageId === "survey"), budgetLines.filter((line) => line.workPackageId === "survey"), qaAssisted ? Math.max(0, Math.round(qaInput.qaAssistedAdditionalSurveyDays)) : survey.siteDays, surveyInput?.pricingBasis ?? "fixed"));
  if (qaInput.designReviewIncluded) packages.push(summary("qa-design", survey ? "B" : "A", "Design Review", "QA", proposalLines.filter((line) => line.workPackageId === "qa-design"), budgetLines.filter((line) => line.workPackageId === "qa-design"), 0, "fixed"));
  if (qaInput.siteSupervisionIncluded) packages.push(summary("qa-supervision", survey ? "C" : qaInput.designReviewIncluded ? "B" : "A", "Site Supervision", "QA", proposalLines.filter((line) => line.workPackageId === "qa-supervision"), budgetLines.filter((line) => line.workPackageId === "qa-supervision"), qa.siteDays, qaInput.areas[0]?.supervisionPricingBasis ?? "day_rate"));

  const commonProposal = sum(proposalLines.filter((line) => line.commercialGroup === "common"), "total");
  const commonBudget = sum(budgetLines.filter((line) => line.commercialGroup === "common"), "total");
  const siteDays = qaAssisted
    ? qa.siteDays + Math.max(0, Math.round(qaInput.qaAssistedAdditionalSurveyDays))
    : survey && qaInput.visitMode === "shared" ? Math.max(survey.siteDays, qa.siteDays) : (survey?.siteDays ?? 0) + qa.siteDays;
  const services = [survey ? "Survey" : "", qaInput.designReviewIncluded ? "Design Review" : "", qaInput.siteSupervisionIncluded ? "Site Supervision" : ""].filter(Boolean);
  const combined = totals({
    ...qa,
    projectReference: qaInput.projectReference,
    client: qaInput.client,
    location: qaInput.location,
    serviceSummary: services.join(" + ") || "QA",
    siteDays,
    originalProposalTotal: sum(proposalLines, "originalTotal"),
    discountAmount: round(proposalLines.reduce((total, line) => total + line.discount, 0)),
    dailyRate: round((survey?.dailyRate ?? 0) + qa.dailyRate),
    rateSchedules: [...(survey?.rateSchedules ?? []), ...(qa.rateSchedules ?? [])],
    pricingMode: packages.length > 1 ? "selectable" : "combined",
    selectionConfirmed: false,
    allOptionsProposalTotal: sum(proposalLines, "total"),
    allOptionsBudgetCost: sum(budgetLines, "total"),
    commonProposalTotal: commonProposal,
    packageSummaries: packages,
    survey: survey?.survey,
    qa: { ...qa.qa, surveyIncluded: Boolean(survey), visitMode: qaInput.visitMode, sharedTravelOwner: sharedOwner, surveyProposal: survey?.proposalTotal ?? 0, surveyBudget: survey?.budgetCost ?? 0 }
  }, proposalLines, budgetLines, companyExchange, groupExchange);
  return combined;
}

export function selectIntegratedQaPackages(calculation: ProjectCalculations, selectedPackageIds: string[]) {
  const selected = new Set(selectedPackageIds);
  const proposalSource = calculation.offeredProposalLines ?? calculation.proposalLines;
  const budgetSource = calculation.offeredBudgetLines ?? calculation.budgetLines;
  const packages = calculation.packageSummaries ?? [];
  const reassignSharedLine = (line: Line) => {
    if (line.commercialGroup === "common" || (line.workPackageId && selected.has(line.workPackageId))) return line;
    const targetId = line.sharedCostForPackageIds?.find((id) => selected.has(id));
    if (!targetId) return null;
    const target = packages.find((item) => item.id === targetId);
    return {
      ...line,
      workPackageId: targetId,
      workPackageName: target?.name ?? line.workPackageName,
      workPackageCode: target?.code ?? line.workPackageCode,
      source: `${line.source}; shared visit cost reassigned from ${line.workPackageName ?? "original package"}`
    };
  };
  const proposalLines = proposalSource.map(reassignSharedLine).filter((line): line is Line => Boolean(line));
  const budgetLines = budgetSource.map(reassignSharedLine).filter((line): line is Line => Boolean(line));
  const updatedPackages = packages.map((item) => {
    const selectedForPackage = selected.has(item.id);
    const packageProposal = sum(proposalLines.filter((line) => line.workPackageId === item.id), "total");
    const packageBudget = sum(budgetLines.filter((line) => line.workPackageId === item.id), "total");
    return { ...item, selected: selectedForPackage, proposalTotal: packageProposal, budgetCost: packageBudget, budgetMarkup: packageBudget ? round((packageProposal - packageBudget) / packageBudget * 100) : 0 };
  });
  const companyExchange = calculation.proposalTotal > 0
    ? calculation.proposalCompanyCurrency / calculation.proposalTotal
    : calculation.budgetCost > 0 ? calculation.budgetCompanyCurrency / calculation.budgetCost : 1;
  const groupExchange = calculation.proposalTotal > 0
    ? calculation.proposalGroupCurrency / calculation.proposalTotal
    : calculation.budgetCost > 0 ? calculation.budgetGroupCurrency / calculation.budgetCost : 1;
  const selectedCalculation = totals({
    ...calculation,
    offeredProposalLines: proposalSource,
    offeredBudgetLines: budgetSource,
    selectionConfirmed: true,
    selectedProposalTotal: sum(proposalLines, "total"),
    selectedBudgetCost: sum(budgetLines, "total"),
    packageSummaries: updatedPackages
  }, proposalLines, budgetLines, companyExchange, groupExchange);
  return selectedCalculation;
}
