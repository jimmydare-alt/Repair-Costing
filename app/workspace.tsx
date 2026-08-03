"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Calculator, FileSpreadsheet, History, Save, Search, Settings } from "lucide-react";
import { calculateActualSiteDays, calculatePhaseSchedule, calculatePL, calculateProject, calculateProjectRepairMaterials, calculateRepairLineMaterials, calculateWorkingDays, defaultActuals } from "@/lib/calculations";
import { money, percent, formatDateTime, setMoneyCurrency } from "@/lib/format";
import { projectCsv } from "@/lib/export";
import { defaultRates, emptyInput } from "@/lib/rates";
import { createRepairLine, defaultRepairCatalog, repairTypeByCode } from "@/lib/repairCatalog";
import { addProjectNote, loadProjects, loadRates, loadRepairCatalog, saveActuals, saveProject, saveRates, saveRepairCatalog, setStorageContext, updateProjectWorkflow } from "@/lib/storage";
import { useAuth } from "@/lib/authContext";
import { hasPermission } from "@/lib/company";
import { createBrowserSupabaseClient } from "@/lib/supabaseClient";
import { ProductShell } from "@/components/AppShell";
import type { AppModuleKey, CurrencyCode, MembershipRole } from "@/lib/company";
import type { AdditionalItem, AdminRates, DetailTab, LabourMode, Line, PLCategory, PriceType, ProjectInput, ProjectRecord, ProjectServiceKey, ProjectStatus, RepairCatalog, RepairLabourMode, RepairLineItem, RepairMaterial, RepairMaterialCategory, RepairSubcontractor, RepairType, RepairUnitType, ScreedTeam, View } from "@/lib/types";

const detailTabs: DetailTab[] = ["Summary", "Costing", "Commercial Review", "Client Proposal", "Actual P&L", "Activity"];
type BuilderStep = "Services" | "Project" | "Phase Schedule" | "Grinding" | "Screeding" | "Repairs" | "Project Management" | "Extras" | "Travel" | "Review";
type RepairPage = "Details" | "Labour" | "Review";
type GrindingPage = "Programme" | "Labour" | "Tools & Review";
type ScreedPage = "Programme" | "Labour" | "Materials" | "Tools & Review";
const materialCategories: RepairMaterialCategory[] = ["Sealant", "Mortar", "Primer", "Resin", "Backing", "Concrete", "Screed", "Tooling", "Other"];
const materialUnitTypes: RepairUnitType[] = ["kg", "litres", "ml", "m", "m2", "m3", "each"];
const plCategories: PLCategory[] = ["Labour", "Subcontract", "Materials", "Equipment", "Travel", "Hotel/Subsistence", "Haulage"];
type RepairReadiness = { blockers: string[]; warnings: string[] };

function cloneInput(input: ProjectInput): ProjectInput {
  return JSON.parse(JSON.stringify(input)) as ProjectInput;
}

function serviceFlags(input: ProjectInput) {
  return {
    grinding: Boolean(input.includeGrinding && input.grinding.enabled),
    screeding: Boolean(input.includeScreeding && input.screeding.enabled),
    repairs: Boolean(input.includeRepairs && input.repairs.enabled)
  };
}

function tabIsAllowed(tab: DetailTab, input: ProjectInput) {
  const services = serviceFlags(input);
  if (tab === "Grinding") return services.grinding;
  if (tab === "Screeding") return services.screeding;
  if (tab === "Repairs") return services.repairs;
  return true;
}

function additionalItemsCost(items: AdditionalItem[]) {
  return items.reduce((sum, item) => sum + (item.rate * item.quantity), 0);
}

function additionalItemsSell(items: AdditionalItem[]) {
  return items.reduce((sum, item) => sum + (item.rate * item.quantity * (1 + item.margin)), 0);
}

function repairSubcontractorSell(items: RepairSubcontractor[]) {
  return items.reduce((sum, item) => {
    const labourQty = item.priceType === "day" ? item.days : item.rate ? 1 : 0;
    return sum + (item.rate * labourQty * (1 + item.margin)) + (item.mobilisationCost * item.mobilisations * (1 + item.mobilisationMargin));
  }, 0);
}

function adminRateMargin(rates: AdminRates, key: keyof AdminRates, fallback: number) {
  return Number(rates.rateMargins?.[String(key)] ?? fallback);
}

function linePLCategory(line: Line): PLCategory {
  if (line.plCategory) return line.plCategory;
  if (line.section === "Subcontract") return "Subcontract";
  if (line.section === "Materials") return "Materials";
  if (line.section === "Equipment" || line.section === "Additional items") return "Equipment";
  if (line.section === "Travel") return "Travel";
  if (line.section === "Hotel" || line.section === "Subsistence") return "Hotel/Subsistence";
  if (line.section === "Haulage") return "Haulage";
  return "Labour";
}

function repairLineQuantity(repairLine: RepairLineItem, repairCatalog: RepairCatalog) {
  const type = repairTypeByCode(repairLine.repairTypeCode, repairCatalog);
  return type.measurementBasis === "area" ? repairLine.areaM2 : type.measurementBasis === "each" ? repairLine.eachQty : type.measurementBasis === "manual" ? repairLine.manualMaterialQty : repairLine.lengthM;
}

function repairLineDays(repairLine: RepairLineItem, repairCatalog: RepairCatalog) {
  const type = repairTypeByCode(repairLine.repairTypeCode, repairCatalog);
  const output = repairLine.outputPerDay || type.defaultOutputPerDay || 1;
  return Math.max(0, repairLineQuantity(repairLine, repairCatalog)) / Math.max(1, output);
}

function repairReadiness(input: ProjectInput, repairCatalog: RepairCatalog): RepairReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!input.includeRepairs || !input.repairs.enabled) return { blockers, warnings };
  const labourMode = input.repairs.labourMode ?? "subcontract";
  const usesSubcontract = labourMode === "subcontract" || labourMode === "both";
  const usesInHouse = labourMode === "in_house" || labourMode === "both";
  if (!labourMode) blockers.push("Select a repair labour type before quoting.");
  if (!input.repairs.repairLines.length) blockers.push("Add at least one repair type.");
  if (usesSubcontract && !input.repairs.repairSubcontractors.some((item) => item.rate > 0 && (item.priceType === "lump sum" || item.days > 0))) blockers.push("Add at least one repair subcontractor as a lump sum or day rate before quoting.");
  if (usesInHouse && input.repairs.labourMen <= 0) blockers.push("Add the number of in-house repair men before quoting.");
  input.repairs.repairLines.forEach((repairLine, index) => {
    const line = `Line ${index + 1}`;
    const type = repairTypeByCode(repairLine.repairTypeCode, repairCatalog);
    if (!type.active) blockers.push(`${line}: ${type.code} is archived in Admin.`);
    if (!type.materialRules.length) blockers.push(`${line}: ${type.code} has no materials assigned in Admin.`);
    if (repairLineQuantity(repairLine, repairCatalog) <= 0) blockers.push(`${line}: add a repair quantity.`);
    if ((repairLine.outputPerDay || type.defaultOutputPerDay) <= 0) blockers.push(`${line}: output per day must be above zero.`);
    const selected = new Set(repairLine.materialSelections.filter((selection) => selection.selected).map((selection) => selection.materialId));
    const selectedRules = type.materialRules.filter((rule) => rule.role === "required" || selected.has(rule.materialId));
    if (!selectedRules.length) blockers.push(`${line}: select at least one required or optional material.`);
    selectedRules.forEach((rule) => {
      const material = repairCatalog.materials.find((item) => item.id === rule.materialId);
      if (!material) {
        blockers.push(`${line}: material ${rule.materialId} is missing from Admin.`);
        return;
      }
      if (!material.active) blockers.push(`${line}: ${material.name} is archived in Admin.`);
      if (material.costPerUnit <= 0) blockers.push(`${line}: ${material.name} has no cost per unit.`);
      if (material.unitSize <= 0) blockers.push(`${line}: ${material.name} has no unit size.`);
      if (material.coveragePerUnit <= 0) blockers.push(`${line}: ${material.name} has no coverage per unit.`);
      const hasLinearVolume = Boolean(repairLine.lengthM && repairLine.widthMm && repairLine.depthMm);
      const hasAreaVolume = Boolean(repairLine.areaM2 && repairLine.thicknessMm);
      const hasHoleVolume = Boolean(repairLine.eachQty && repairLine.holeDiameterMm && repairLine.holeDepthMm);
      if (material.calcMethod === "volume_lwd" && !hasLinearVolume && !hasAreaVolume && !hasHoleVolume) blockers.push(`${line}: ${material.name} needs length/width/depth, area/thickness, or each/diameter/depth.`);
      if (material.calcMethod === "area_thickness" && material.id !== "bondcoat-rbp" && material.id !== "fastprime-5" && !hasAreaVolume && !hasHoleVolume) blockers.push(`${line}: ${material.name} needs area/thickness or each/diameter/depth.`);
      if (material.calcMethod === "area_thickness" && material.id === "fastprime-5" && !repairLine.areaM2) blockers.push(`${line}: ${material.name} needs an area.`);
      if (material.calcMethod === "manual" && repairLine.manualMaterialQty <= 0) blockers.push(`${line}: ${material.name} needs a manual material quantity.`);
    });
  });
  const calculatedRepairDays = Math.ceil(input.repairs.repairLines.reduce((sum, repairLine) => sum + repairLineDays(repairLine, repairCatalog), 0));
  if (input.repairs.labourDays > 0 && input.repairs.labourDays !== calculatedRepairDays) warnings.push(`Repair days are manually overridden from ${calculatedRepairDays} to ${input.repairs.labourDays}.`);
  if (usesInHouse && input.repairs.hotelRequired && input.repairs.hotelNights <= 0) blockers.push("Hotel is ticked for in-house labour but nights per team is zero.");
  if (usesInHouse && input.repairs.travelDays > 0 && !input.repairs.hotelRequired) warnings.push("Travel is included without hotel/subsistence. Check this is a local or same-day job.");
  if (input.repairs.materialInputs.some((item) => item.lengthM || item.areaM2 || item.widthMm || item.depthMm || item.thicknessMm)) warnings.push("Legacy material inputs are ignored; use repair lines/material rules only.");
  return { blockers, warnings };
}

function grindingReadiness(input: ProjectInput): RepairReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!input.includeGrinding || !input.grinding.enabled) return { blockers, warnings };
  const g = input.grinding;
  const days = g.estimatedDays || g.weeks * g.daysPerWeek;
  const productionMode = g.productionLabourMode ?? "in_house";
  const surveyorMode = g.surveyorLabourMode ?? "in_house";
  const usesProductionInHouse = productionMode === "in_house" || productionMode === "both";
  const usesProductionSubcontract = productionMode === "subcontract" || productionMode === "both";
  const usesSurveyorInHouse = surveyorMode === "in_house" || surveyorMode === "both";
  const usesSurveyorSubcontract = surveyorMode === "subcontract" || surveyorMode === "both";
  if (days <= 0) blockers.push("Add estimated grinding days before quoting.");
  if (!surveyorMode) blockers.push("Surveyor labour must be selected.");
  if (usesSurveyorInHouse && g.surveyorCount <= 0) blockers.push("Add at least one grinding surveyor.");
  if (usesSurveyorSubcontract && !g.surveyorSubcontractors.some((item) => item.rate > 0 && (item.priceType === "lump sum" || item.days > 0))) blockers.push("Add at least one surveyor subcontractor cost.");
  if (usesProductionInHouse && g.productionMen <= 0) blockers.push("Add production men for in-house grinding labour.");
  if (usesProductionSubcontract && !g.productionSubcontractors.some((item) => item.rate > 0 && (item.priceType === "lump sum" || item.days > 0))) blockers.push("Add at least one grinding production subcontractor cost.");
  if (usesProductionInHouse && g.productionMen <= 0) warnings.push("In-house grinding is selected but no production men are entered for grinder days.");
  if (usesProductionInHouse && !g.dustVacuums) warnings.push("In-house grinding is selected but no dust vacuums are entered.");
  if (g.nightShiftRequired && !g.nightShifts && !g.productionNightShifts && !g.surveyorNightShifts) blockers.push("Night shift is selected but no night shifts are entered.");
  if (usesProductionInHouse && g.productionHotelRequired && g.productionHotelNights <= 0) blockers.push("Production hotel is selected but nights per team is zero.");
  if (usesSurveyorInHouse && g.surveyorHotelRequired && g.surveyorHotelNights <= 0) blockers.push("Surveyor hotel is selected but nights per team is zero.");
  if (g.productionLabourDays > 0 && g.productionLabourDays !== days) warnings.push(`Production labour days are overridden from ${days} to ${g.productionLabourDays}.`);
  if (g.surveyorDays > 0 && g.surveyorDays !== days) warnings.push(`Surveyor labour days are overridden from ${days} to ${g.surveyorDays}.`);
  return { blockers, warnings };
}

function screedReadiness(input: ProjectInput): RepairReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!input.includeScreeding || !input.screeding.enabled) return { blockers, warnings };
  const s = input.screeding;
  const days = s.totalDaysOnSite || s.teams.reduce((sum, team) => sum + (team.enabled ? team.daysProgrammed : 0), 0);
  const productionMode = s.productionLabourMode ?? "subcontract";
  const surveyorMode = s.surveyorLabourMode ?? "in_house";
  const usesProductionInHouse = productionMode === "in_house" || productionMode === "both";
  const usesProductionSubcontract = productionMode === "subcontract" || productionMode === "both";
  const usesSurveyorInHouse = surveyorMode === "in_house" || surveyorMode === "both";
  const usesSurveyorSubcontract = surveyorMode === "subcontract" || surveyorMode === "both";
  if (days <= 0) blockers.push("Add total screeding days on site before quoting.");
  if (s.areaM2 <= 0) warnings.push("Screeding area is zero. Check materials and programme are intentional.");
  if (!surveyorMode) blockers.push("Surveyor labour must be selected for screeding.");
  if (usesSurveyorInHouse && s.surveyors <= 0) blockers.push("Add at least one screeding surveyor.");
  if (usesSurveyorSubcontract && !s.surveyorSubcontractors.some((item) => item.rate > 0 && (item.priceType === "lump sum" || item.days > 0))) blockers.push("Add at least one screeding surveyor subcontractor cost.");
  if (usesProductionInHouse && s.productionMen <= 0) blockers.push("Add production men for in-house screeding labour.");
  if (usesProductionSubcontract && !s.teams.some((team) => team.enabled && team.rate > 0 && (team.priceType === "lump sum" || team.daysProgrammed > 0))) blockers.push("Add at least one screeding production subcontractor cost.");
  if (s.nightShiftRequired && !s.nightShifts && !s.productionNightShifts && !s.surveyorNightShifts) blockers.push("Night shift is selected but no night shifts are entered.");
  if (usesProductionInHouse && s.productionHotelRequired && s.productionHotelNights <= 0) blockers.push("Production hotel is selected but nights per team is zero.");
  if (usesSurveyorInHouse && s.surveyorHotelRequired && s.surveyorHotelNights <= 0) blockers.push("Surveyor hotel is selected but nights per team is zero.");
  if (s.productionLabourDays > 0 && s.productionLabourDays !== days) warnings.push(`Production labour days are overridden from ${days} to ${s.productionLabourDays}.`);
  if (s.surveyorDays > 0 && s.surveyorDays !== days) warnings.push(`Surveyor labour days are overridden from ${days} to ${s.surveyorDays}.`);
  if (s.ukSupervisorRequired) warnings.push("UK supervisor is no longer priced in the screeding model. Use surveyor labour instead.");
  return { blockers, warnings };
}

function projectReadiness(input: ProjectInput, budgetMarkupExact: number, duplicateReference = false, hasCommercialValue = false): RepairReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!input.includeGrinding && !input.includeScreeding && !input.includeRepairs) blockers.push("Select at least one service.");
  if (!input.projectReference.trim()) blockers.push("Add a project reference.");
  if (!input.client.trim()) blockers.push("Add the client name.");
  if (!input.location.trim()) blockers.push("Add the project location.");
  if (input.exchangeRateToCompanyCurrency <= 0 || input.exchangeRateToGroupCurrency <= 0) blockers.push("Exchange rates must be greater than zero.");
  if (hasCommercialValue && budgetMarkupExact < 25 && !input.markupOverrideReason.trim()) blockers.push(`Markup is ${percent(budgetMarkupExact)}. Enter a manager approval reason for quotes below 25%.`);
  if (duplicateReference && input.projectReference.trim()) warnings.push("This project reference already exists. Confirm this is intentional before saving.");
  if (input.projectManagement.enabled && input.projectManagement.days <= 0) warnings.push("Project management is enabled but no management days are entered.");
  const grindingServiceTravel = input.includeGrinding && (((["in_house", "both"] as LabourMode[]).includes(input.grinding.productionLabourMode) && (input.grinding.productionTravelDays > 0 || input.grinding.productionOneWayKm > 0)) || ((["in_house", "both"] as LabourMode[]).includes(input.grinding.surveyorLabourMode) && (input.grinding.surveyorTravelDays > 0 || input.grinding.surveyorOneWayKm > 0)));
  const screedServiceTravel = input.includeScreeding && (((["in_house", "both"] as LabourMode[]).includes(input.screeding.productionLabourMode) && (input.screeding.productionTravelDays > 0 || input.screeding.productionOneWayKm > 0)) || ((["in_house", "both"] as LabourMode[]).includes(input.screeding.surveyorLabourMode) && (input.screeding.surveyorTravelDays > 0 || input.screeding.surveyorOneWayKm > 0)));
  const repairServiceTravel = input.includeRepairs && (["in_house", "both"] as RepairLabourMode[]).includes(input.repairs.labourMode) && (input.repairs.travelDays > 0 || input.repairs.mobilisationOneWayKm > 0);
  if (input.travelMode !== "None" && (grindingServiceTravel || screedServiceTravel || repairServiceTravel)) warnings.push("Project-wide travel and service-specific in-house travel are both populated. Check that travel is not duplicated.");
  return { blockers, warnings };
}

export default function Workspace() {
  const auth = useAuth();
  const pathname = usePathname();
  const routeView = pathname.includes("new-project") || pathname.includes("grinding") || pathname.includes("screeding") || pathname.includes("repairs") ? "New Project" : pathname.includes("project-search") ? "Project Search" : pathname.includes("admin-rates") ? "Admin Rates" : pathname.includes("company-admin") ? "Company Admin" : "Dashboard";
  const routeTab: DetailTab = pathname.includes("grinding") ? "Grinding" : pathname.includes("screeding") ? "Screeding" : pathname.includes("repairs") ? "Repairs" : pathname.includes("proposal") ? "Client Proposal" : pathname.includes("budget") ? "Costing" : pathname.includes("pl") ? "Actual P&L" : "Summary";
  const routeAdminTab: "Rates" | "Repair Types" | "Repair Materials" = pathname.includes("repair-types") ? "Repair Types" : pathname.includes("repair-materials") ? "Repair Materials" : "Rates";
  const [view, setView] = useState<View>(routeView);
  const [detailTab, setDetailTab] = useState<DetailTab>(routeTab);
  const [input, setInput] = useState<ProjectInput>(() => cloneInput(emptyInput));
  const [baselineInput, setBaselineInput] = useState<ProjectInput>(() => cloneInput(emptyInput));
  const [rates, setRatesState] = useState<AdminRates>(defaultRates);
  const [repairCatalog, setRepairCatalog] = useState<RepairCatalog>(defaultRepairCatalog);
  const [pricingRates, setPricingRates] = useState<AdminRates>(defaultRates);
  const [pricingCatalog, setPricingCatalog] = useState<RepairCatalog>(defaultRepairCatalog);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [note, setNote] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [actuals, setActuals] = useState(defaultActuals(calculateProject(emptyInput, defaultRates, defaultRepairCatalog)));
  const calculations = useMemo(() => calculateProject(input, pricingRates, pricingCatalog), [input, pricingRates, pricingCatalog]);
  const selected = projects.find((project) => project.id === selectedId);
  const selectedCalcs = selected?.calculations ?? calculations;
  const pl = calculatePL(selectedCalcs, selected?.actuals ?? actuals);
  const routeModule = routeModuleKey(pathname);
  const moduleBlocked = routeModule && (routeModule === "company_admin" ? auth.role !== "super_admin" : !auth.enabledModules.includes(routeModule));
  const displayCurrency = view === "New Project" ? input.quoteCurrency : view === "Project Detail" && selected ? selected.inputs.quoteCurrency : auth.activeCompany.defaultCurrency;
  const hasUnsavedChanges = view === "New Project" && JSON.stringify(input) !== JSON.stringify(baselineInput);
  setMoneyCurrency(displayCurrency);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    setView(routeView);
    setDetailTab(routeTab);
  }, [pathname, routeTab, routeView]);

  useEffect(() => {
    if (auth.configured && (!auth.session || !auth.companies.length)) return;
    setStorageContext({
      companyId: auth.activeCompany.id,
      actorName: auth.session?.user.email ?? "James Dare",
      userId: auth.session?.user.id
    });
    setWorkspaceLoading(true);
    setWorkspaceError("");
    void Promise.all([loadRates(), loadProjects(), loadRepairCatalog()]).then(([loadedRates, loadedProjects, loadedRepairCatalog]) => {
      setRatesState(loadedRates);
      setRepairCatalog(loadedRepairCatalog);
      setPricingRates(loadedRates);
      setPricingCatalog(loadedRepairCatalog);
      setProjects(loadedProjects);
      const companyBlank = cloneInput(emptyInput);
      companyBlank.quoteCurrency = auth.activeCompany.defaultCurrency;
      setInput(companyBlank);
      setBaselineInput(cloneInput(companyBlank));
      setEditingId("");
      if (loadedProjects[0]) {
        setSelectedId(loadedProjects[0].id);
        setActuals(loadedProjects[0].actuals ?? defaultActuals(loadedProjects[0].calculations));
      } else {
        setSelectedId("");
        setActuals(defaultActuals(calculateProject(emptyInput, loadedRates, loadedRepairCatalog)));
      }
    }).catch((error: unknown) => setWorkspaceError(error instanceof Error ? error.message : "Could not load the company workspace.")).finally(() => setWorkspaceLoading(false));
  }, [auth.activeCompany.defaultCurrency, auth.activeCompany.id, auth.companies.length, auth.configured, auth.session, auth.session?.user.email, auth.session?.user.id]);

  useEffect(() => {
    if (selected) setActuals(selected.actuals ?? defaultActuals(selected.calculations));
  }, [selected, selectedId]);

  async function refresh() {
    setProjects(await loadProjects());
  }

  function startNewProject() {
    const blank = cloneInput(emptyInput);
    blank.quoteCurrency = auth.activeCompany.defaultCurrency;
    blank.exchangeRateToCompanyCurrency = 1;
    blank.exchangeRateToGroupCurrency = auth.activeCompany.defaultCurrency === auth.activeCompany.reportingCurrency ? 1 : blank.exchangeRateToGroupCurrency;
    setInput(blank);
    setBaselineInput(cloneInput(blank));
    setPricingRates(rates);
    setPricingCatalog(repairCatalog);
    setSelectedId("");
    setEditingId("");
    setActuals(defaultActuals(calculateProject(blank, rates, repairCatalog)));
    setView("New Project");
    setDetailTab("Summary");
  }

  async function saveCurrentProject(status: ProjectStatus = "Quoted") {
    const readiness = repairReadiness(input, pricingCatalog);
    const grindingChecks = grindingReadiness(input);
    const screedChecks = screedReadiness(input);
    const duplicateReference = projects.some((project) => project.id !== editingId && project.inputs.projectReference.trim().toLowerCase() === input.projectReference.trim().toLowerCase());
    const exactMarkup = calculations.budgetCost ? calculations.budgetProfit / calculations.budgetCost * 100 : 0;
    const projectChecks = projectReadiness(input, exactMarkup, duplicateReference, calculations.proposalTotal > 0 || calculations.budgetCost > 0);
    const blockers = [...projectChecks.blockers, ...grindingChecks.blockers, ...screedChecks.blockers, ...readiness.blockers];
    if (status === "Quoted" && blockers.length) {
      alert(`Save as Draft until these checks are fixed:\n\n${blockers.slice(0, 10).join("\n")}`);
      return;
    }
    if (status === "Quoted" && duplicateReference && !confirm("This project reference already exists. Save this quote anyway?")) return;
    try {
      setSaveState("saving");
      setWorkspaceError("");
      const saved = await saveProject(input, pricingRates, editingId || undefined, auth.session?.user.email ?? "James Dare", pricingCatalog, status);
      setBaselineInput(cloneInput(saved.inputs));
      setSelectedId(saved.id);
      setEditingId("");
      await refresh();
      setView("Project Detail");
      setDetailTab("Summary");
      setSaveState("saved");
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "The project could not be saved.");
      setSaveState("idle");
    }
  }

  function editProject(project: ProjectRecord) {
    setInput(cloneInput(project.inputs));
    setBaselineInput(cloneInput(project.inputs));
    setPricingRates(project.rateSnapshot ?? rates);
    setPricingCatalog(project.repairCatalogSnapshot ?? repairCatalog);
    setEditingId(project.id);
    setSelectedId(project.id);
    setView("New Project");
  }

  const selectedContext = selected ? `${selected.inputs.projectReference || "Draft"} - ${selected.inputs.client || "No client"} - ${selected.calculations.serviceSummary}` : "No project selected";
  const shellServices = view === "Project Detail" && selected ? serviceFlags(selected.inputs) : serviceFlags(input);

  if (auth.configured && auth.session && !auth.companies.length) return <div className="min-h-screen bg-slate-100 p-8"><div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold">No company access</h1><p className="mt-2 text-sm text-slate-600">Your account is signed in but has no active company membership. Ask a super admin to restore the company membership.</p></div></div>;

  return (
    <ProductShell view={view} pathname={pathname} selectedContext={selectedContext} activeServices={shellServices} onNewProject={startNewProject}>
      <section className="workspace-page">
        {workspaceError && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{workspaceError}</div>}
        {workspaceLoading && <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-600">Loading company workspace...</div>}
        {saveState === "saved" && <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Project saved to the company workspace.</div>}
        {moduleBlocked && <ModuleBlocked moduleKey={routeModule} />}
        {!moduleBlocked && <>
        <WorkspaceBanner view={view} selected={selected} projects={projects} />
        {view === "Dashboard" && <Dashboard projects={projects} companyCurrency={auth.activeCompany.defaultCurrency} open={(project) => { setSelectedId(project.id); setView("Project Detail"); }} />}
        {view === "New Project" && <ProjectBuilder input={input} setInput={setInput} rates={pricingRates} repairCatalog={pricingCatalog} calculations={calculations} onSave={saveCurrentProject} detailTab={detailTab} setDetailTab={setDetailTab} duplicateReference={projects.some((project) => project.id !== editingId && project.inputs.projectReference.trim().toLowerCase() === input.projectReference.trim().toLowerCase())} usingSnapshot={Boolean(editingId && selected?.rateSnapshot)} saving={saveState === "saving"} dirty={hasUnsavedChanges} reprice={() => { setPricingRates(rates); setPricingCatalog(repairCatalog); setInput({ ...input, exchangeRateLockedAt: new Date().toISOString() }); }} />}
        {view === "Project Search" && <SearchView projects={projects} open={(project) => { setSelectedId(project.id); setView("Project Detail"); setDetailTab("Summary"); }} edit={editProject} />}
        {view === "Admin Rates" && <AdminRatesView rates={rates} setRates={setRatesState} repairCatalog={repairCatalog} setRepairCatalog={setRepairCatalog} initialAdminTab={routeAdminTab} save={async () => { try { await saveRates(rates); await saveRepairCatalog(repairCatalog); alert("Rates and repair database saved. New quotes will use these values; saved quotes keep their snapshot."); } catch (error) { setWorkspaceError(error instanceof Error ? error.message : "Admin data could not be saved."); } }} />}
        {view === "Company Admin" && <CompanyAdminView />}
        {view === "Project Detail" && selected && (
          <ProjectDetail
            project={selected}
            tab={detailTab}
            setTab={setDetailTab}
            actuals={actuals}
            setActuals={setActuals}
            saveActuals={async () => { try { const saved = await saveActuals(selected.id, actuals, auth.session?.user.email ?? "James Dare"); setActuals(saved); await refresh(); } catch (error) { setWorkspaceError(error instanceof Error ? error.message : "P&L actuals could not be saved."); } }}
            addNote={async () => { if (note.trim()) { try { await addProjectNote(selected.id, { author: auth.session?.user.email ?? "James Dare", category: "General", text: note.trim() }); setNote(""); await refresh(); } catch (error) { setWorkspaceError(error instanceof Error ? error.message : "The note could not be saved."); } } }}
            note={note}
            setNote={setNote}
            edit={() => editProject(selected)}
            updateStatus={async (status) => { try { await updateProjectWorkflow(selected.id, status, undefined, auth.session?.user.email ?? "James Dare"); await refresh(); } catch (error) { setWorkspaceError(error instanceof Error ? error.message : "Project status could not be updated."); } }}
          />
        )}
        </>}
      </section>
    </ProductShell>
  );
}

function routeModuleKey(pathname: string): AppModuleKey | null {
  if (pathname.includes("admin-rates/repair-types") || pathname.includes("admin-rates/repair-materials")) return "repair_database";
  if (pathname.includes("admin-rates")) return "admin_rates";
  if (pathname.includes("company-admin")) return "company_admin";
  if (pathname.includes("new-project") || pathname.includes("grinding") || pathname.includes("screeding") || pathname.includes("repairs")) return "calculations";
  if (pathname.includes("project-search")) return "projects";
  if (pathname.includes("proposal") || pathname.includes("budget") || pathname.includes("pl")) return "reports";
  return "dashboard";
}

function ModuleBlocked({ moduleKey }: { moduleKey: AppModuleKey }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
      <div className="text-lg font-bold">Module disabled</div>
      <p className="mt-2 text-sm">The `{moduleKey}` module is not enabled for the active company. Navigation hides disabled modules, and direct access is blocked here as the app-side guard.</p>
    </div>
  );
}

function WorkspaceBanner({ view, selected, projects }: { view: View; selected?: ProjectRecord; projects: ProjectRecord[] }) {
  const auth = useAuth();
  const quoted = projects.reduce((sum, project) => sum + (project.calculations.proposalCompanyCurrency ?? project.calculations.proposalTotal), 0);
  return (
    <div className="mb-6 rounded-2xl bg-slate-950 p-5 text-white shadow-xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-bold uppercase text-sky-300">Current Workspace</div>
          <div className="mt-1 text-2xl font-bold">{view}</div>
          <div className="mt-1 text-sm text-slate-300">{selected ? `${selected.inputs.projectReference} - ${selected.inputs.client} - ${selected.calculations.serviceSummary}` : "No project selected"}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Mini label="Projects" value={String(projects.length)} />
          <Mini label={`Quoted ${auth.activeCompany.defaultCurrency}`} value={money(quoted, auth.activeCompany.defaultCurrency)} />
          <Mini label="Won" value={String(projects.filter((p) => p.status === "Won").length)} />
          <Mini label="Awaiting" value={String(projects.filter((p) => p.accountsStatus === "Awaiting Accounts").length)} />
        </div>
      </div>
    </div>
  );
}

type CompanyAdminMember = { id: string; user_id: string; role: MembershipRole; status: string; email?: string; full_name?: string };
type CompanyInvite = { id: string; email: string; role: MembershipRole; status: string; expires_at: string };
type CompanyModuleRow = { id: string; module_key: AppModuleKey; name: string; enabled: boolean };

function CompanyAdminView() {
  const auth = useAuth();
  const client = useMemo(() => createBrowserSupabaseClient(), []);
  const canManageCompany = hasPermission(auth.role, "company.manage");
  const canCreateCompany = hasPermission(auth.role, "company.create");
  const canInvite = hasPermission(auth.role, "users.invite");
  const canManageModules = hasPermission(auth.role, "modules.manage");
  const [members, setMembers] = useState<CompanyAdminMember[]>([]);
  const [invites, setInvites] = useState<CompanyInvite[]>([]);
  const [modules, setModules] = useState<CompanyModuleRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MembershipRole>("viewer");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyCurrency, setNewCompanyCurrency] = useState<CurrencyCode>("EUR");
  const [companyName, setCompanyName] = useState(auth.activeCompany.name);
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>(auth.activeCompany.defaultCurrency);
  const [reportingCurrency, setReportingCurrency] = useState<CurrencyCode>(auth.activeCompany.reportingCurrency);
  const [primaryColour, setPrimaryColour] = useState(auth.activeCompany.branding.primaryColour);
  const [accentColour, setAccentColour] = useState(auth.activeCompany.branding.accentColour);
  const [message, setMessage] = useState("");

  async function loadAdminData() {
    if (!client || auth.activeCompany.id.startsWith("local-")) return;
    setMessage("");
    const companyId = auth.activeCompany.id;
    const [{ data: membershipRows, error: memberError }, { data: inviteRows, error: inviteError }, { data: moduleRows, error: moduleError }] = await Promise.all([
      client.from("company_memberships").select("id,user_id,role,status").eq("company_id", companyId).order("created_at", { ascending: true }),
      client.from("company_invitations").select("id,email,role,status,expires_at").eq("company_id", companyId).order("created_at", { ascending: false }),
      client.from("company_modules").select("enabled,app_modules(id,module_key,name)").eq("company_id", companyId)
    ]);
    if (memberError || inviteError || moduleError) {
      setMessage(memberError?.message ?? inviteError?.message ?? moduleError?.message ?? "Could not load company admin data.");
      return;
    }
    const userIds = (membershipRows ?? []).map((row) => String(row.user_id));
    let profiles = new Map<string, { email?: string; full_name?: string }>();
    if (userIds.length) {
      const { data: profileRows } = await client.from("profiles").select("id,email,full_name").in("id", userIds);
      profiles = new Map((profileRows ?? []).map((row: any) => [String(row.id), { email: row.email, full_name: row.full_name }]));
    }
    setMembers((membershipRows ?? []).map((row: any) => ({ ...row, role: row.role as MembershipRole, ...profiles.get(String(row.user_id)) })));
    setInvites((inviteRows ?? []).map((row: any) => ({ ...row, role: row.role as MembershipRole })));
    setModules((moduleRows ?? []).map((row: any) => ({ id: row.app_modules.id, module_key: row.app_modules.module_key, name: row.app_modules.name, enabled: row.enabled })).sort((a, b) => a.name.localeCompare(b.name)));
  }

  useEffect(() => {
    setCompanyName(auth.activeCompany.name);
    setDefaultCurrency(auth.activeCompany.defaultCurrency);
    setReportingCurrency(auth.activeCompany.reportingCurrency);
    setPrimaryColour(auth.activeCompany.branding.primaryColour);
    setAccentColour(auth.activeCompany.branding.accentColour);
    void loadAdminData();
  // Company admin loading is intentionally keyed to company switching only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.activeCompany.id]);

  async function saveCompanyBasics() {
    if (!client || !canManageCompany) return;
    const { error } = await client.from("companies").update({
      name: companyName.trim(),
      default_currency: defaultCurrency,
      reporting_currency: reportingCurrency,
      allowed_currencies: Array.from(new Set([defaultCurrency, reportingCurrency])),
      primary_colour: primaryColour,
      accent_colour: accentColour,
      branding_status: "draft",
      branding_updated_at: new Date().toISOString()
    }).eq("id", auth.activeCompany.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    await auth.refreshCompanies();
    setMessage("Company settings saved.");
  }

  async function sendInvite() {
    if (!client || !canInvite) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email.includes("@")) {
      setMessage("Enter a valid email address.");
      return;
    }
    const existing = invites.find((invite) => invite.email.toLowerCase() === email);
    const payload = {
      company_id: auth.activeCompany.id,
      email,
      role: inviteRole === "super_admin" ? "viewer" : inviteRole,
      status: "invited",
      expires_at: new Date(Date.now() + 14 * 86400000).toISOString()
    };
    const result = existing
      ? await client.from("company_invitations").update(payload).eq("id", existing.id)
      : await client.from("company_invitations").insert(payload);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    setInviteEmail("");
    setMessage("User pre-authorised. When they sign up, their membership will activate automatically.");
    await loadAdminData();
  }

  async function setMemberRole(memberId: string, role: MembershipRole) {
    if (!client || !hasPermission(auth.role, "users.role.update") || role === "super_admin") return;
    const { error } = await client.from("company_memberships").update({ role, updated_at: new Date().toISOString() }).eq("id", memberId).eq("company_id", auth.activeCompany.id);
    if (error) setMessage(error.message);
    await loadAdminData();
  }

  async function createCompany() {
    if (!client || !canCreateCompany || !newCompanyName.trim()) return;
    const { data, error } = await client.from("companies").insert({
      name: newCompanyName.trim(),
      short_name: newCompanyName.trim().slice(0, 20),
      default_currency: newCompanyCurrency,
      reporting_currency: newCompanyCurrency,
      allowed_currencies: newCompanyCurrency === "PLN" ? ["PLN", "EUR"] : [newCompanyCurrency],
      primary_colour: "#0067a6",
      accent_colour: "#20a7d8",
      dark_colour: "#07182f",
      soft_colour: "#e9eef5"
    }).select("id").single();
    if (error || !data) {
      setMessage(error?.message ?? "Company was not created.");
      return;
    }
    const { data: appModules } = await client.from("app_modules").select("id");
    if (appModules?.length) {
      await client.from("company_modules").insert(appModules.map((module) => ({ company_id: data.id, module_id: module.id, enabled: true })));
    }
    await client.from("admin_rates").insert({ company_id: data.id, rates: {} });
    await client.from("repair_catalogs").insert({ company_id: data.id });
    setNewCompanyName("");
    setMessage("Company created. Use the company switcher to open it.");
    await auth.refreshCompanies();
  }

  async function toggleModule(module: CompanyModuleRow) {
    if (!client || !canManageModules) return;
    const { error } = await client.from("company_modules").update({ enabled: !module.enabled }).eq("company_id", auth.activeCompany.id).eq("module_id", module.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    await loadAdminData();
    await auth.refreshCompanies();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="panel-heading">
          <div>
            <h2 className="text-2xl font-semibold">Company Admin</h2>
            <p className="text-sm text-slate-500">Manage the active company, invited users and enabled modules.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-600">{auth.role.replace("_", " ")}</span>
        </div>
        {message && <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-950">{message}</div>}
        <div className="grid gap-4 lg:grid-cols-2">
          <Text label="Company Name" value={companyName} onChange={setCompanyName} />
          <Select label="Default Currency" value={defaultCurrency} options={["EUR", "GBP", "PLN", "USD"]} onChange={(value) => setDefaultCurrency(value as CurrencyCode)} />
          <Select label="Reporting Currency" value={reportingCurrency} options={["EUR", "GBP", "PLN", "USD"]} onChange={(value) => setReportingCurrency(value as CurrencyCode)} />
          <div className="grid grid-cols-2 gap-3">
            <Text label="Primary Colour" value={primaryColour} onChange={setPrimaryColour} />
            <Text label="Accent Colour" value={accentColour} onChange={setAccentColour} />
          </div>
        </div>
        <button className="primary-button mt-4" disabled={!canManageCompany} onClick={() => void saveCompanyBasics()}>Save Company Settings</button>
      </section>

      {canCreateCompany && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="panel-heading">
            <h2 className="text-xl font-semibold">Create Company</h2>
            <p className="text-sm text-slate-500">Super admin only. New companies get the current module set.</p>
          </div>
          <div className="grid gap-3">
            <Text label="Company Name" value={newCompanyName} onChange={setNewCompanyName} />
            <Select label="Currency" value={newCompanyCurrency} options={["EUR", "GBP", "PLN", "USD"]} onChange={(value) => setNewCompanyCurrency(value as CurrencyCode)} />
            <button className="primary-button" onClick={() => void createCompany()}>Create Company</button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="panel-heading">
          <h2 className="text-xl font-semibold">Users</h2>
          <p className="text-sm text-slate-500">Pre-authorise an email, then the membership activates when that person signs up.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
          <Text label="Email" value={inviteEmail} onChange={setInviteEmail} />
          <Select label="Role" value={inviteRole} options={auth.role === "super_admin" ? ["viewer", "reviewer", "manager_editor", "company_admin"] : ["viewer", "reviewer", "manager_editor"]} onChange={(value) => setInviteRole(value as MembershipRole)} />
          <button className="primary-button self-end" disabled={!canInvite} onClick={() => void sendInvite()}>Invite</button>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-400"><tr><th className="py-2">User</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-t border-slate-100">
                  <td className="py-3"><div className="font-bold text-slate-950">{member.full_name || member.email || member.user_id}</div><div className="text-xs text-slate-500">{member.email || member.user_id}</div></td>
                  <td><select className="input min-h-10" value={member.role} disabled={!hasPermission(auth.role, "users.role.update")} onChange={(event) => void setMemberRole(member.id, event.target.value as MembershipRole)}><option value="viewer">Viewer</option><option value="reviewer">Reviewer</option><option value="manager_editor">Manager Editor</option>{auth.role === "super_admin" && <option value="company_admin">Company Admin</option>}</select></td>
                  <td className="font-semibold capitalize">{member.status}</td>
                </tr>
              ))}
              {!members.length && <tr><td className="py-5 text-slate-500" colSpan={3}>No active members found for this company.</td></tr>}
            </tbody>
          </table>
        </div>
        {!!invites.length && <div className="mt-5 rounded-xl bg-slate-50 p-4"><div className="text-xs font-bold uppercase text-slate-400">Pending / previous invitations</div>{invites.map((invite) => <div key={invite.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-semibold">{invite.email}</span><span className="rounded-full bg-white px-2 py-1 text-xs font-bold uppercase text-slate-500">{invite.role} - {invite.status}</span></div>)}</div>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="panel-heading">
          <h2 className="text-xl font-semibold">Modules</h2>
          <p className="text-sm text-slate-500">Super admin can disable sections per company.</p>
        </div>
        <div className="grid gap-2">
          {modules.map((module) => (
            <label key={module.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
              <span className="font-bold text-slate-800">{module.name}</span>
              <input type="checkbox" className="h-5 w-5 accent-sky-600" checked={module.enabled} disabled={!canManageModules} onChange={() => void toggleModule(module)} />
            </label>
          ))}
          {!modules.length && <div className="text-sm text-slate-500">No modules loaded for this company.</div>}
        </div>
      </section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950"><div className="text-[11px] font-bold uppercase text-slate-500">{label}</div><div className="mt-1 break-words text-lg font-bold">{value}</div></div>;
}

function Dashboard({ projects, companyCurrency, open }: { projects: ProjectRecord[]; companyCurrency: CurrencyCode; open: (project: ProjectRecord) => void }) {
  const pipeline = projects.reduce((sum, project) => sum + (project.calculations.proposalCompanyCurrency ?? project.calculations.proposalTotal), 0);
  const budget = projects.reduce((sum, project) => sum + (project.calculations.budgetCompanyCurrency ?? project.calculations.budgetCost), 0);
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={`Pipeline (${companyCurrency})`} value={money(pipeline, companyCurrency)} />
        <Metric label={`Budget Cost (${companyCurrency})`} value={money(budget, companyCurrency)} />
        <Metric label="Average Markup" value={percent(projects.length ? projects.reduce((sum, p) => sum + (p.calculations.budgetMarkup ?? 0), 0) / projects.length : 0)} />
        <Metric label="Projects" value={String(projects.length)} />
      </div>
      <div className="app-card-strong">
        <div className="panel-heading"><h2 className="text-xl font-semibold">Recent Projects</h2></div>
        <ProjectTable projects={projects} open={open} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="app-card min-w-0 border-t-4 border-t-sky-500 p-4"><div className="text-[11px] font-bold uppercase text-slate-500">{label}</div><div className="mt-2 break-words text-xl font-bold text-slate-950 sm:text-2xl">{value}</div></div>;
}

function ProjectBuilder({ input, setInput, rates, repairCatalog, calculations, onSave, detailTab, setDetailTab, duplicateReference, usingSnapshot, saving, dirty, reprice }: { input: ProjectInput; setInput: (input: ProjectInput) => void; rates: AdminRates; repairCatalog: RepairCatalog; calculations: ReturnType<typeof calculateProject>; onSave: (status?: ProjectStatus) => void; detailTab: DetailTab; setDetailTab: (tab: DetailTab) => void; duplicateReference: boolean; usingSnapshot: boolean; saving: boolean; dirty: boolean; reprice: () => void }) {
  const initialStep = detailTab === "Grinding" || detailTab === "Screeding" || detailTab === "Repairs" ? detailTab : "Services";
  const [builderStep, setBuilderStep] = useState<BuilderStep>(initialStep);
  const allSteps = [
    { key: "Services", label: "Services", enabled: true },
    { key: "Project", label: "Project", enabled: true },
    { key: "Phase Schedule", label: "Phase Schedule", enabled: input.includeGrinding || input.includeScreeding || input.includeRepairs },
    { key: "Grinding", label: "Grinding", enabled: input.includeGrinding },
    { key: "Screeding", label: "Screeding", enabled: input.includeScreeding },
    { key: "Repairs", label: "Repairs", enabled: input.includeRepairs },
    { key: "Project Management", label: "Project Management", enabled: true },
    { key: "Extras", label: "Extras", enabled: true },
    { key: "Travel", label: "Travel", enabled: true },
    { key: "Review", label: "Review", enabled: true }
  ] satisfies Array<{ key: BuilderStep; label: string; enabled: boolean }>;
  const steps = allSteps.filter((step) => step.enabled);
  useEffect(() => {
    const routedStep = detailTab === "Grinding" || detailTab === "Screeding" || detailTab === "Repairs" ? detailTab : builderStep;
    const nextStep = steps.some((step) => step.key === routedStep) ? routedStep : "Services";
    if (builderStep !== nextStep) setBuilderStep(nextStep);
    if (!tabIsAllowed(detailTab, input)) setDetailTab("Summary");
  // The primitive service flags are the intentional routing dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailTab, input.includeGrinding, input.includeScreeding, input.includeRepairs, input.grinding.enabled, input.screeding.enabled, input.repairs.enabled]);
  const activeIndex = Math.max(0, steps.findIndex((step) => step.key === builderStep));
  const setStep = (step: typeof builderStep) => {
    setBuilderStep(step);
    if (step === "Grinding" || step === "Screeding" || step === "Repairs") setDetailTab(step);
    if (step === "Review") setDetailTab("Proposal");
  };
  const nextStep = () => setStep(steps[Math.min(activeIndex + 1, steps.length - 1)].key);
  const previousStep = () => setStep(steps[Math.max(activeIndex - 1, 0)].key);
  const readiness = repairReadiness(input, repairCatalog);
  const grindingChecks = grindingReadiness(input);
  const screedChecks = screedReadiness(input);
  const exactMarkup = calculations.budgetCost ? calculations.budgetProfit / calculations.budgetCost * 100 : 0;
  const projectChecks = projectReadiness(input, exactMarkup, duplicateReference, calculations.proposalTotal > 0 || calculations.budgetCost > 0);
  const quoteBlockers = [...projectChecks.blockers, ...grindingChecks.blockers, ...screedChecks.blockers, ...readiness.blockers];
  const canQuote = quoteBlockers.length === 0;

  return (
    <div className="grid gap-5">
      <div className="app-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 text-[11px] font-bold uppercase text-slate-500">Quote Builder</div>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {steps.map((step, index) => (
              <button key={step.key} onClick={() => setStep(step.key)} className={`inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${builderStep === step.key ? "bg-sky-700 text-white" : index < activeIndex ? "bg-sky-50 text-sky-900 ring-1 ring-sky-100 hover:bg-sky-100" : "bg-slate-100 text-slate-800 hover:bg-slate-200"}`}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/70 text-[10px] text-slate-700">{index + 1}</span>
                <span className="truncate">{step.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="grid min-w-0 gap-5">
      {usingSnapshot && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><div><b>Saved pricing snapshot in use.</b> Admin rate changes do not alter this quote unless you explicitly reprice it.</div><button className="secondary-button" onClick={reprice}>Reprice with current admin rates</button></div>}
      {projectChecks.warnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="font-bold uppercase">Project checks</div>{projectChecks.warnings.map((warning) => <div className="mt-1" key={warning}>{warning}</div>)}</div>}
      {input.includeRepairs && (readiness.blockers.length > 0 || readiness.warnings.length > 0) && (
        <div className={`rounded-xl border p-4 text-sm ${readiness.blockers.length ? "border-amber-200 bg-amber-50 text-amber-950" : "border-sky-200 bg-sky-50 text-sky-950"}`}>
          <div className="font-bold uppercase">{readiness.blockers.length ? "Repair quote is draft only" : "Repair quote needs review"}</div>
          <div className="mt-1">{readiness.blockers.length ? `${readiness.blockers.length} item${readiness.blockers.length === 1 ? "" : "s"} must be fixed before Save Quote is available.` : "There are repair assumptions to check before issuing."}</div>
          <button className="secondary-button mt-3" onClick={() => setStep("Repairs")}>Open Repairs</button>
        </div>
      )}
      {quoteBlockers.length > 0 && !input.includeRepairs && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-bold uppercase">Quote is draft only</div>
          <div className="mt-1">{quoteBlockers.length} item{quoteBlockers.length === 1 ? "" : "s"} must be fixed before Save Quote is available.</div>
        </div>
      )}
      <div className="app-card-strong">
        <div className="panel-heading flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">New Project</h2>{dirty && <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold uppercase text-amber-800">Unsaved changes</span>}</div><p className="text-sm text-slate-500">Pick services first, then complete only the sections needed for this quote.</p></div>
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={() => onSave("Draft")} disabled={saving}><Save size={16} /> {saving ? "Saving..." : "Save Draft"}</button>
            <button className="primary-button" onClick={() => onSave("Quoted")} disabled={!canQuote || saving}><Save size={16} /> {saving ? "Saving..." : "Save Quote"}</button>
          </div>
        </div>
        <div className="p-5">
          {builderStep === "Services" && <ServiceStep input={input} setInput={setInput} setStep={setStep} />}
          {builderStep === "Project" && <ProjectBasics input={input} setInput={setInput} duplicateReference={duplicateReference} />}
          {builderStep === "Phase Schedule" && <PhaseScheduleStep input={input} setInput={setInput} repairCatalog={repairCatalog} />}
          {builderStep === "Grinding" && <GrindingForm input={input} setInput={setInput} rates={rates} />}
          {builderStep === "Screeding" && <ScreedForm input={input} setInput={setInput} rates={rates} />}
          {builderStep === "Repairs" && <RepairsForm input={input} setInput={setInput} repairCatalog={repairCatalog} rates={rates} projectMaterialCalcs={calculations.repairMaterialCalcs} />}
          {builderStep === "Project Management" && <ProjectManagementStep input={input} setInput={setInput} rates={rates} />}
          {builderStep === "Extras" && <ExtrasStep input={input} setInput={setInput} />}
          {builderStep === "Travel" && <TravelStep input={input} setInput={setInput} />}
          {builderStep === "Review" && detailTab !== "Audit" && <ReviewStep calculations={calculations} input={input} setInput={setInput} />}
          {builderStep === "Review" && detailTab === "Audit" && <AuditPanel calculations={calculations} />}
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-3">
        <button className="secondary-button" onClick={previousStep} disabled={activeIndex === 0}>Back</button>
        <div className="flex flex-wrap gap-2">
          {activeIndex === steps.length - 1 && <button className="secondary-button" onClick={() => onSave("Draft")} disabled={saving}>Save Draft</button>}
          <button className="primary-button" onClick={activeIndex === steps.length - 1 ? () => onSave("Quoted") : nextStep} disabled={saving || (activeIndex === steps.length - 1 && !canQuote)}>{activeIndex === steps.length - 1 ? saving ? "Saving..." : "Save Quote" : "Next"}</button>
        </div>
      </div>
      <QuoteSummary calculations={calculations} />
      </section>
    </div>
  );
}

function ServiceStep({ input, setInput, setStep }: { input: ProjectInput; setInput: (input: ProjectInput) => void; setStep: (step: BuilderStep) => void }) {
  const service = (key: "includeGrinding" | "includeScreeding" | "includeRepairs", title: string, detail: string, step: "Grinding" | "Screeding" | "Repairs") => {
    const checked = input[key];
    const toggleService = () => {
      const next = { ...input, [key]: !checked } as ProjectInput;
      if (key === "includeGrinding") next.grinding = { ...next.grinding, enabled: !checked };
      if (key === "includeScreeding") next.screeding = { ...next.screeding, enabled: !checked };
      if (key === "includeRepairs") next.repairs = { ...next.repairs, enabled: !checked };
      setInput(next);
    };
    return (
      <div className={`rounded-xl border p-5 text-left transition ${checked ? "border-sky-600 bg-sky-50 shadow-md" : "border-slate-200 bg-white"}`}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-950">{title}</h3>
          <button type="button" onClick={toggleService} className={`rounded-full px-3 py-1 text-xs font-bold ${checked ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{checked ? "Selected" : "Add"}</button>
        </div>
        <p className="mt-2 text-sm text-slate-600">{detail}</p>
        {checked && <button type="button" onClick={() => setStep(step)} className="mt-4 rounded-md bg-white px-3 py-2 text-sm font-bold text-sky-800 ring-1 ring-sky-200">Open detail</button>}
      </div>
    );
  };
  return (
    <div>
      <div className="mb-5">
        <h3 className="text-2xl font-bold text-slate-950">What are we pricing?</h3>
        <p className="mt-1 text-sm text-slate-600">Start with the services. The builder will only show the sections you choose.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {service("includeGrinding", "Grinding", "Grinding labour, subcontract team, generators, grinders, vacuums, tooling and consumables.", "Grinding")}
        {service("includeScreeding", "Screeding", "Flexible subcontractors, screed materials, primer, sand, surveyor labour and in-house tool options.", "Screeding")}
        {service("includeRepairs", "Repairs", "Joint repair resources, repair material calculator, subcontractors and haulage.", "Repairs")}
      </div>
      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Recommended flow: choose services, add project details, confirm the phase schedule, complete each service, add shared project management, extras and travel, then complete the commercial review.
      </div>
    </div>
  );
}

function ProjectBasics({ input, setInput, duplicateReference }: { input: ProjectInput; setInput: (input: ProjectInput) => void; duplicateReference: boolean }) {
  const auth = useAuth();
  const currencies = auth.activeCompany.allowedCurrencies.length ? auth.activeCompany.allowedCurrencies : [auth.activeCompany.defaultCurrency];
  return (
    <div>
      <div className="mb-5">
        <h3 className="text-2xl font-bold text-slate-950">Project basics</h3>
        <p className="mt-1 text-sm text-slate-600">Keep this short. The service pages carry the heavy detail.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div><Text label="Project Reference" value={input.projectReference} onChange={(v) => setInput({ ...input, projectReference: v })} />{duplicateReference && <div className="mt-1 text-xs font-bold text-amber-700">Reference already exists. Confirm it is intentional.</div>}</div>
        <Text label="Client" value={input.client} onChange={(v) => setInput({ ...input, client: v })} />
        <Text label="Location" value={input.location} onChange={(v) => setInput({ ...input, location: v })} />
        <Text label="Project Type" value={input.projectType} onChange={(v) => setInput({ ...input, projectType: v })} />
        <Text label="Revision" value={input.revision} onChange={(v) => setInput({ ...input, revision: v })} />
        <Text label="Costed By" value={input.costedBy} onChange={(v) => setInput({ ...input, costedBy: v })} />
        <Select label="Quote Currency" value={input.quoteCurrency} options={currencies} onChange={(v) => setInput({ ...input, quoteCurrency: v as ProjectInput["quoteCurrency"], exchangeRateToCompanyCurrency: v === auth.activeCompany.defaultCurrency ? 1 : input.exchangeRateToCompanyCurrency, exchangeRateToGroupCurrency: v === auth.activeCompany.reportingCurrency ? 1 : input.exchangeRateToGroupCurrency, exchangeRateLockedAt: new Date().toISOString() })} />
        <NumberInput label={`1 ${input.quoteCurrency} = Company ${auth.activeCompany.defaultCurrency}`} value={input.exchangeRateToCompanyCurrency} onChange={(v) => setInput({ ...input, exchangeRateToCompanyCurrency: v, exchangeRateLockedAt: new Date().toISOString() })} />
        <NumberInput label={`1 ${input.quoteCurrency} = Group ${auth.activeCompany.reportingCurrency}`} value={input.exchangeRateToGroupCurrency} onChange={(v) => setInput({ ...input, exchangeRateToGroupCurrency: v, exchangeRateLockedAt: new Date().toISOString() })} />
      </div>
      {input.exchangeRateLockedAt && <div className="mt-4 text-xs text-slate-500">Exchange rate locked for this costing: {formatDateTime(input.exchangeRateLockedAt)}</div>}
    </div>
  );
}

function PhaseScheduleStep({ input, setInput, repairCatalog }: { input: ProjectInput; setInput: (input: ProjectInput) => void; repairCatalog: RepairCatalog }) {
  const schedule = calculatePhaseSchedule(input, repairCatalog);
  const order = schedule.rows.map((row) => row.service);
  const move = (service: ProjectServiceKey, direction: -1 | 1) => {
    const index = order.indexOf(service);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    const nextOrder = [...order];
    [nextOrder[index], nextOrder[target]] = [nextOrder[target], nextOrder[index]];
    setInput({ ...input, phaseSchedule: { ...input.phaseSchedule, order: [...nextOrder, ...input.phaseSchedule.order.filter((item) => !nextOrder.includes(item))] } });
  };
  return (
    <div className="grid gap-5">
      <div><h3 className="text-2xl font-bold text-slate-950">Phase schedule</h3><p className="mt-1 text-sm text-slate-600">Set the order of works and show which phases run together. This controls the whole-project site duration.</p></div>
      <div className="grid gap-3">
        {schedule.rows.map((row, index) => (
          <div key={row.service} className="grid items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[minmax(150px,1fr)_120px_170px_170px_160px]">
            <div><div className="text-xs font-bold uppercase text-slate-500">Phase {index + 1}</div><div className="mt-1 text-lg font-bold text-slate-950">{row.service}</div><div className="mt-2 flex gap-2"><button className="secondary-button min-h-9 px-3" onClick={() => move(row.service, -1)} disabled={index === 0}>Up</button><button className="secondary-button min-h-9 px-3" onClick={() => move(row.service, 1)} disabled={index === schedule.rows.length - 1}>Down</button></div></div>
            <Mini label="Calculated" value={`${row.calculatedDays} days`} />
            <div className={row.inputDays !== row.calculatedDays ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Inputted Phase Days" value={row.inputDays} onChange={(value) => setInput({ ...input, phaseSchedule: { ...input.phaseSchedule, dayOverrides: { ...input.phaseSchedule.dayOverrides, [row.service]: value } } })} /></div>
            {index > 0 ? <Toggle label="Starts With Previous" checked={row.concurrent} onChange={(value) => setInput({ ...input, phaseSchedule: { ...input.phaseSchedule, startsWithPrevious: { ...input.phaseSchedule.startsWithPrevious, [row.service]: value } } })} /> : <Mini label="Start" value="Project day 1" />}
            <Mini label="Programme" value={`Day ${row.startDay} to ${row.endDay}`} />
          </div>
        ))}
      </div>
      <div className="grid gap-4 rounded-xl border border-sky-200 bg-sky-50 p-4 sm:grid-cols-3">
        <Mini label="Calculated Project Days" value={`${schedule.calculatedProjectDays}`} />
        <div className={schedule.projectDays !== schedule.calculatedProjectDays ? "rounded-lg border border-amber-300 bg-amber-50 p-2" : ""}><NumberInput label="Inputted Project Days" value={schedule.projectDays} onChange={(value) => setInput({ ...input, phaseSchedule: { ...input.phaseSchedule, projectDaysOverride: value } })} /></div>
        <Mini label="Days Used in Costing" value={`${schedule.projectDays}`} />
      </div>
    </div>
  );
}

function ProjectManagementStep({ input, setInput, rates }: { input: ProjectInput; setInput: (input: ProjectInput) => void; rates: AdminRates }) {
  const pm = input.projectManagement;
  const patch = (next: Partial<typeof pm>) => setInput({ ...input, projectManagement: { ...pm, ...next } });
  const managerSell = pm.days * rates.projectManagerDayRate * (1 + adminRateMargin(rates, "projectManagerDayRate", rates.defaultMargin));
  return (
    <div className="grid gap-5">
      <div><h3 className="text-2xl font-bold text-slate-950">Project management</h3><p className="mt-1 text-sm text-slate-600">Whole-project management is entered once here, even when several services are included.</p></div>
      <Toggle label="Include Project Management" checked={pm.enabled} onChange={(enabled) => patch({ enabled })} />
      {!pm.enabled ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No project-management cost will be added.</div> : <div className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <NumberInput label="Project Manager Days" value={pm.days} onChange={(days) => patch({ days })} />
          <NumberInput label="Number of Visits" value={pm.visits} onChange={(visits) => patch({ visits })} />
          <NumberInput label="Travel Days" value={pm.travelDays} onChange={(travelDays) => patch({ travelDays })} />
          <Mini label="Management Sell" value={money(managerSell)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Select label="Travel Mode" value={pm.travelMode} options={["None", "Drive", "Fly"]} onChange={(travelMode) => patch({ travelMode: travelMode as ProjectInput["projectManagement"]["travelMode"] })} />
          {pm.travelMode === "Drive" && <NumberInput label="One-Way Distance km" value={pm.oneWayKm} onChange={(oneWayKm) => patch({ oneWayKm })} />}
          {pm.travelMode === "Drive" && <NumberInput label="Vehicles" value={pm.vehicles} onChange={(vehicles) => patch({ vehicles })} />}
          {pm.travelMode === "Fly" && <NumberInput label="Return Flights" value={pm.returnFlights} onChange={(returnFlights) => patch({ returnFlights })} />}
          <NumberInput label="Hotel Nights" value={pm.hotelNights} onChange={(hotelNights) => patch({ hotelNights })} />
        </div>
      </div>}
    </div>
  );
}

function TravelStep({ input, setInput }: { input: ProjectInput; setInput: (input: ProjectInput) => void }) {
  const hasTravel = input.travelMode !== "None";
  return (
    <div>
      <div className="mb-5">
        <h3 className="text-2xl font-bold text-slate-950">Travel and accommodation</h3>
        <p className="mt-1 text-sm text-slate-600">Optional project-wide FACE travel. Leave blank when travel is already included in the service labour or subcontract price. Distances are kilometres.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Select label="Project-Wide Travel" value={input.travelMode} options={["None", "Drive", "Fly"]} onChange={(v) => setInput({ ...input, travelMode: v as ProjectInput["travelMode"] })} />
        {!hasTravel && <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm font-bold text-sky-950 sm:col-span-2">No project-wide FACE travel will be added. Service-specific in-house travel still prices inside each selected labour section.</div>}
        {hasTravel && <NumberInput label="People Travelling" value={input.projectTravelPeople} onChange={(v) => setInput({ ...input, projectTravelPeople: v })} />}
        {hasTravel && input.travelMode === "Drive" && <NumberInput label="Distance One-Way km" value={input.distanceKmOneWay} onChange={(v) => setInput({ ...input, distanceKmOneWay: v })} />}
        {hasTravel && input.travelMode === "Drive" && <NumberInput label="Drive Time One-Way Days" value={input.driveTimeDaysOneWay} onChange={(v) => setInput({ ...input, driveTimeDaysOneWay: v })} />}
        {hasTravel && input.travelMode === "Drive" && <NumberInput label="Vehicles" value={input.vehicles} onChange={(v) => setInput({ ...input, vehicles: v })} />}
        {input.travelMode === "Fly" && <Select label="Airport Transport" value={input.airportTransport} options={["N/A", "Drive", "Uber"]} onChange={(v) => setInput({ ...input, airportTransport: v as ProjectInput["airportTransport"] })} />}
        {input.travelMode === "Fly" && <NumberInput label="Additional Flights" value={input.additionalFlights} onChange={(v) => setInput({ ...input, additionalFlights: v })} />}
      </div>
    </div>
  );
}

function ExtrasStep({ input, setInput }: { input: ProjectInput; setInput: (input: ProjectInput) => void }) {
  const activeItems = input.additionalItems.filter((item) => item.rate || item.quantity);
  const budget = activeItems.reduce((sum, item) => sum + item.rate * item.quantity, 0);
  const proposal = activeItems.reduce((sum, item) => sum + item.rate * item.quantity * (1 + item.margin), 0);
  return (
    <div className="grid gap-5">
      <div>
        <h3 className="text-2xl font-bold text-slate-950">Project-wide extras</h3>
        <p className="mt-1 text-sm text-slate-600">Use this for extras that belong to the whole quote, not just repairs, grinding or screeding. Pick the P&L category so the cost reports correctly later.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Active Extras" value={String(activeItems.length)} />
        <Metric label="Budget Cost" value={money(budget)} />
        <Metric label="Proposal Cost" value={money(proposal)} />
      </div>
      <AdditionalItems title="Additional Items" items={input.additionalItems} onChange={(items) => setInput({ ...input, additionalItems: items })} />
    </div>
  );
}

function ReviewStep({ calculations, input, setInput }: { calculations: ReturnType<typeof calculateProject>; input: ProjectInput; setInput: (input: ProjectInput) => void }) {
  const auth = useAuth();
  const canApproveLowMarkup = hasPermission(auth.role, "projects.review");
  const overallExactMarkup = calculations.budgetCost ? calculations.budgetProfit / calculations.budgetCost * 100 : 0;
  const grouped = calculations.proposalLines.filter((line) => line.total).reduce<Record<string, number>>((acc, line) => {
    acc[line.section] = (acc[line.section] ?? 0) + line.total;
    return acc;
  }, {});
  const categoryRows = plCategories.map((category) => {
    const proposal = calculations.proposalLines.filter((line) => linePLCategory(line) === category).reduce((sum, line) => sum + line.total, 0);
    const budget = calculations.budgetLines.filter((line) => linePLCategory(line) === category).reduce((sum, line) => sum + line.total, 0);
    const profit = proposal - budget;
    const markup = budget ? (profit / budget) * 100 : 0;
    const grossMargin = proposal ? (profit / proposal) * 100 : 0;
    return { category, proposal, budget, profit, markup, grossMargin };
  }).filter((row) => row.proposal || row.budget);
  const markupWarnings = [
    calculations.proposalTotal && overallExactMarkup < 25 ? `Overall markup is ${percent(overallExactMarkup)}, below the 25% approval threshold.` : "",
    ...categoryRows
      .filter((row) => row.budget > 0 && row.markup < 25)
      .map((row) => `${row.category} markup is ${percent(row.markup)}, below 25%.`)
  ].filter(Boolean);
  return (
    <div className="grid gap-5">
      <div>
        <h3 className="text-2xl font-bold text-slate-950">Review quote</h3>
        <p className="mt-1 text-sm text-slate-600">Check the service totals, markup, optional bonus and discount before saving.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Proposal" value={money(calculations.proposalTotal)} />
        <Metric label="Budget" value={money(calculations.budgetCost)} />
        <Metric label="Markup" value={percent(calculations.budgetMarkup)} />
        <Metric label="Site Days" value={String(calculations.siteDays)} />
      </div>
      <div className={`rounded-xl border p-4 text-sm ${markupWarnings.length ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}>
        <div className="mb-2 font-bold uppercase">{markupWarnings.length ? "Markup checks to review" : "Markup checks passed"}</div>
        {markupWarnings.length ? <div className="grid gap-1">{markupWarnings.map((warning) => <div key={warning}>{warning}</div>)}</div> : <div>All active proposal and P&L categories are at or above 25% markup.</div>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="app-card p-4">
          <h4 className="mb-3 font-bold">Proposal by Section</h4>
          {Object.entries(grouped).map(([section, total]) => <div className="flex justify-between border-b py-2" key={section}><span>{section}</span><b>{money(total)}</b></div>)}
        </div>
        <div className="app-card p-4">
          <h4 className="mb-3 font-bold">Final Adjustments</h4>
          <NumberInput label="Discount %" value={input.discountPercentage} onChange={(v) => setInput({ ...input, discountPercentage: v })} />
          <div className="mt-4"><Toggle label={`Include 1% BDM Bonus (${money(calculations.bdmBonusBudget)} budget cost)`} checked={input.bdmBonusRequired} onChange={(bdmBonusRequired) => setInput({ ...input, bdmBonusRequired })} /></div>
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Discount is applied across proposal lines. Budget cost is not discounted.</div>
        </div>
      </div>
      {calculations.proposalTotal > 0 && overallExactMarkup < 25 && <div className="app-card p-4"><label className="form-label">Manager approval reason (required below 25% markup)</label><textarea className="input mt-2 min-h-24 w-full" disabled={!canApproveLowMarkup} value={input.markupOverrideReason} onChange={(event) => setInput({ ...input, markupOverrideReason: event.target.value })} placeholder={canApproveLowMarkup ? "Explain why this lower markup is commercially acceptable." : "A manager must enter the approval reason."} />{!canApproveLowMarkup && <div className="mt-2 text-sm font-bold text-amber-700">Your role cannot approve a quote below 25% markup.</div>}</div>}
      <div className="app-card p-4">
        <h4 className="mb-3 font-bold">Budget / Proposal by P&L Category</h4>
        <div className="table-shell border-0">
          <table>
            <thead><tr><th>P&L Category</th><th>Budget</th><th>Proposal</th><th>Profit</th><th>Markup</th><th>Gross Margin</th></tr></thead>
            <tbody>
              {categoryRows.map((row) => (
                <tr key={row.category}>
                  <td className="font-semibold">{row.category}</td>
                  <td>{money(row.budget)}</td>
                  <td>{money(row.proposal)}</td>
                  <td className={row.profit < 0 ? "font-bold text-red-700" : row.profit === 0 ? "font-bold text-amber-700" : "font-bold text-emerald-700"}>{money(row.profit)}</td>
                  <td className={row.budget && row.markup < 25 ? "font-bold text-red-700" : "font-bold text-emerald-700"}>{percent(row.markup)}</td>
                  <td className="font-semibold text-slate-600">{percent(row.grossMargin)}</td>
                </tr>
              ))}
              {!categoryRows.length && <tr><td colSpan={6} className="text-slate-500">No active quote lines yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <LineTable lines={calculations.proposalLines} />
    </div>
  );
}

function QuoteSummary({ calculations }: { calculations: ReturnType<typeof calculateProject> }) {
  const lowMarkup = calculations.proposalTotal > 0 && calculations.budgetCost > 0 && calculations.budgetProfit / calculations.budgetCost < 0.25;
  return (
    <div className="app-card-strong">
      <div className="panel-heading">
        <div className="flex items-center gap-2 text-sm font-bold uppercase text-slate-500"><Calculator size={16} /> Live Quote</div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <SummaryRow label="Proposal" value={money(calculations.proposalTotal)} strong />
        <SummaryRow label="Budget" value={money(calculations.budgetCost)} />
        <SummaryRow label={lowMarkup ? "Markup - Approval" : "Markup"} value={percent(calculations.budgetMarkup)} alert={lowMarkup} />
        <SummaryRow label="Site Days" value={String(calculations.siteDays)} />
        <SummaryRow label="Daily Rate" value={money(calculations.dailyRate)} />
        <SummaryRow label="Mobilisation" value={money(calculations.mobilisationRate)} />
      </div>
    </div>
  );
}

function SummaryRow({ label, value, strong = false, alert = false }: { label: string; value: string; strong?: boolean; alert?: boolean }) {
  return <div className={`min-w-0 rounded-lg border px-3 py-3 ${alert ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-white"}`}><span className={`block text-xs font-bold uppercase ${alert ? "text-amber-700" : "text-slate-500"}`}>{label}</span><b className={`mt-1 block break-words ${strong ? "text-xl text-sky-800" : alert ? "text-base text-amber-950" : "text-base text-slate-950"}`}>{value}</b></div>;
}

function DetailTabs({ tab, setTab, input }: { tab: DetailTab; setTab: (tab: DetailTab) => void; input: ProjectInput }) {
  const visibleTabs = detailTabs.filter((item) => tabIsAllowed(item, input));
  return <div className="flex flex-wrap gap-2 rounded-xl bg-white p-2 shadow-sm">{visibleTabs.map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-md px-3 py-2 text-sm font-bold ${tab === item ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-800"}`}>{item}</button>)}</div>;
}

function GrindingForm({ input, setInput, rates }: { input: ProjectInput; setInput: (input: ProjectInput) => void; rates: AdminRates }) {
  const g = input.grinding;
  const [grindingPage, setGrindingPage] = useState<GrindingPage>("Programme");
  const patch = (next: Partial<typeof g>) => setInput({ ...input, grinding: { ...g, ...next } });
  const estimatedDays = g.estimatedDays || g.weeks * g.daysPerWeek;
  const productionMode = g.productionLabourMode ?? "in_house";
  const surveyorMode = g.surveyorLabourMode ?? "in_house";
  const usesProductionInHouse = productionMode === "in_house" || productionMode === "both";
  const usesProductionSubcontract = productionMode === "subcontract" || productionMode === "both";
  const usesSurveyorInHouse = surveyorMode === "in_house" || surveyorMode === "both";
  const usesSurveyorSubcontract = surveyorMode === "subcontract" || surveyorMode === "both";
  const productionDays = g.productionLabourDays > 0 ? g.productionLabourDays : estimatedDays;
  const surveyorDays = g.surveyorDays > 0 ? g.surveyorDays : estimatedDays;
  const productionDaysOverridden = g.productionLabourDays > 0 && g.productionLabourDays !== estimatedDays;
  const surveyorDaysOverridden = g.surveyorDays > 0 && g.surveyorDays !== estimatedDays;
  const productionSubcontractSell = repairSubcontractorSell(g.productionSubcontractors);
  const surveyorSubcontractSell = repairSubcontractorSell(g.surveyorSubcontractors);
  const productionLabourSell = usesProductionInHouse ? g.productionMen * productionDays * rates.productionLabourDayRate * (1 + adminRateMargin(rates, "productionLabourDayRate", rates.defaultMargin)) : 0;
  const surveyorLabourSell = usesSurveyorInHouse ? g.surveyorCount * surveyorDays * rates.surveyorDayRate * (1 + adminRateMargin(rates, "surveyorDayRate", 0)) : 0;
  const toolDays = usesProductionInHouse ? estimatedDays : 0;
  const grinderDays = g.productionMen * toolDays;
  const planerDays = g.gasPlaners * toolDays;
  const vacuumDays = g.dustVacuums * toolDays;
  const generatorDays = (g.generatorRequired ? toolDays : 0) + (g.largeGeneratorRequired ? toolDays : 0);
  const toolSell = usesProductionInHouse ? (
    (g.generatorRequired ? rates.grindingSmallGeneratorDayRate * toolDays * (1 + adminRateMargin(rates, "grindingSmallGeneratorDayRate", rates.equipmentMargin)) : 0) +
    (grinderDays * rates.grindingGrinderDayRate * (1 + adminRateMargin(rates, "grindingGrinderDayRate", rates.equipmentMargin))) +
    (g.gasPlaners * toolDays * rates.grindingPlanerDayRate * (1 + adminRateMargin(rates, "grindingPlanerDayRate", rates.equipmentMargin))) +
    (g.dustVacuums * toolDays * rates.grindingDustVacuumDayRate * (1 + adminRateMargin(rates, "grindingDustVacuumDayRate", rates.equipmentMargin))) +
    (g.grindingSegmentsRequired ? grinderDays * rates.grindingSegmentsDayRate * (1 + adminRateMargin(rates, "grindingSegmentsDayRate", rates.equipmentMargin)) : 0) +
    (g.consumablesRequired ? grinderDays * rates.grindingConsumablesDayRate * (1 + adminRateMargin(rates, "grindingConsumablesDayRate", rates.equipmentMargin)) : 0)
  ) : 0;
  const readiness = grindingReadiness(input);
  const labourModeButton = (label: string, value: LabourMode, current: LabourMode, onChange: (value: LabourMode) => void) => (
    <button className={current === value ? "primary-button" : "secondary-button"} onClick={() => onChange(value)}>{label}</button>
  );
  return (
    <div className="grid gap-5">
      <div className="sticky top-2 z-10 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Mini label="Estimated Days" value={`${estimatedDays}`} />
          <Mini label="Production Labour" value={productionMode === "subcontract" ? "Subcontract" : productionMode === "in_house" ? "In-house" : "Both"} />
          <Mini label="Surveyor Labour" value={surveyorMode === "subcontract" ? "Subcontract" : surveyorMode === "in_house" ? "In-house" : "Both"} />
          <Mini label="Tool Sell" value={money(toolSell)} />
          <Mini label="Subcontract Sell" value={money((usesProductionSubcontract ? productionSubcontractSell : 0) + (usesSurveyorSubcontract ? surveyorSubcontractSell : 0))} />
          <Mini label="Quote Status" value={readiness.blockers.length ? "Draft only" : readiness.warnings.length ? "Review" : "Ready"} />
        </div>
      </div>
      {readiness.blockers.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="mb-2 font-bold uppercase">Draft only - fix before quoting</div><div className="grid gap-1">{readiness.blockers.slice(0, 8).map((warning) => <div key={warning}>{warning}</div>)}</div></div>}
      {!readiness.blockers.length && readiness.warnings.length > 0 && <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><div className="mb-2 font-bold uppercase">Review before quoting</div><div className="grid gap-1">{readiness.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div></div>}
      <GrindingPageTabs grindingPage={grindingPage} setGrindingPage={setGrindingPage} />
      {grindingPage === "Programme" && <>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Grinding Programme</h2><p className="text-sm text-slate-500">Set the expected site duration first. These days drive default labour, surveyor and equipment quantities.</p></div>
          <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
            <NumberInput label="Estimated Grinding Days" value={g.estimatedDays} onChange={(v) => patch({ estimatedDays: v })} />
            <NumberInput label="Weekend Days Worked Per Week" value={g.weekendDaysPerWeek} onChange={(v) => patch({ weekendDaysPerWeek: v, productionWeekendDays: v, surveyorWeekendDays: v })} />
            <Toggle label="Night Shifts" checked={g.nightShiftRequired} onChange={(v) => patch({ nightShiftRequired: v })} />
            {g.nightShiftRequired && <NumberInput label="Number of Night Shifts" value={g.nightShifts} onChange={(v) => patch({ nightShifts: v, productionNightShifts: v, surveyorNightShifts: v })} />}
            <Toggle label="Van Rental Required" checked={g.vanRentalRequired} onChange={(v) => patch({ vanRentalRequired: v })} />
          </div>
        </div>
        <GrindingPageTabs grindingPage={grindingPage} setGrindingPage={setGrindingPage} placement="bottom" />
      </>}
      {grindingPage === "Labour" && <>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Grinding Production Labour</h2><p className="text-sm text-slate-500">Choose who is carrying out the grinding works. Subcontract pricing should include their labour and equipment.</p></div>
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            {labourModeButton("Subcontract", "subcontract", productionMode, (value) => patch({ productionLabourMode: value }))}
            {labourModeButton("In-house", "in_house", productionMode, (value) => patch({ productionLabourMode: value }))}
            {labourModeButton("Both", "both", productionMode, (value) => patch({ productionLabourMode: value }))}
          </div>
        </div>
        {usesProductionSubcontract && <SubcontractLabourPanel items={g.productionSubcontractors} calculatedDays={estimatedDays} onChange={(items) => patch({ productionSubcontractors: items })} title="Grinding Production Subcontractors" description="Add each grinding subcontractor separately. Their price should include labour, equipment and normal grinding tools." addLabel="Add Grinding Subcontractor" defaultName="Grinding subcontractor" />}
        {usesProductionInHouse && <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">In-House Grinding Labour</h2><p className="text-sm text-slate-500">Uses the shared production labour rates from Admin. Hotel nights are per team, then multiplied by men.</p></div>
          <div className="grid gap-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Estimated Days" value={`${estimatedDays}`} />
              <div className={productionDaysOverridden ? "rounded-lg border border-amber-200 bg-amber-50 p-3" : ""}><NumberInput label="Inputted Production Days" value={productionDays} onChange={(v) => patch({ productionLabourDays: v })} /></div>
              <NumberInput label="Production Men" value={g.productionMen} onChange={(v) => patch({ productionMen: v, grindersOnSite: v })} />
              <Mini label="Production Labour Sell" value={money(productionLabourSell)} />
            </div>
            {productionDaysOverridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Production labour days overridden from {estimatedDays} to {productionDays}.</div>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Weekend Days" value={g.productionWeekendDays || g.weekendDaysPerWeek} onChange={(v) => patch({ productionWeekendDays: v })} />
              <NumberInput label="Night Shifts" value={g.productionNightShifts || g.nightShifts} onChange={(v) => patch({ productionNightShifts: v })} />
              <Toggle label="Hotel / Subsistence" checked={g.productionHotelRequired} onChange={(v) => patch({ productionHotelRequired: v })} />
              {g.productionHotelRequired && <NumberInput label="Nights Per Team" value={g.productionHotelNights} onChange={(v) => patch({ productionHotelNights: v })} />}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Travel Days" value={g.productionTravelDays} onChange={(v) => patch({ productionTravelDays: v })} />
              <NumberInput label="One-Way Distance km" value={g.productionOneWayKm} onChange={(v) => patch({ productionOneWayKm: v })} />
              <NumberInput label="Vehicles / Vans" value={g.productionVehicles} onChange={(v) => patch({ productionVehicles: v })} />
              <Mini label="Calculated km" value={`${g.productionOneWayKm * 2 * Math.max(1, g.productionVehicles)}`} />
            </div>
          </div>
        </div>}
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Surveyor Labour</h2><p className="text-sm text-slate-500">Surveyor labour is required for grinding and is costed separately from production workers.</p></div>
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            {labourModeButton("Subcontract", "subcontract", surveyorMode, (value) => patch({ surveyorLabourMode: value }))}
            {labourModeButton("In-house", "in_house", surveyorMode, (value) => patch({ surveyorLabourMode: value }))}
            {labourModeButton("Both", "both", surveyorMode, (value) => patch({ surveyorLabourMode: value }))}
          </div>
        </div>
        {usesSurveyorSubcontract && <SubcontractLabourPanel items={g.surveyorSubcontractors} calculatedDays={estimatedDays} onChange={(items) => patch({ surveyorSubcontractors: items })} title="Surveyor Subcontractors" description="Add subcontracted surveyor/supervisor support separately from production subcontractors." addLabel="Add Surveyor Subcontractor" defaultName="Surveyor subcontractor" />}
        {usesSurveyorInHouse && <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">In-House Surveyor Labour</h2><p className="text-sm text-slate-500">Uses the surveyor labour rates from Admin. Hotel nights are per team, then multiplied by surveyors.</p></div>
          <div className="grid gap-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Estimated Days" value={`${estimatedDays}`} />
              <div className={surveyorDaysOverridden ? "rounded-lg border border-amber-200 bg-amber-50 p-3" : ""}><NumberInput label="Inputted Surveyor Days" value={surveyorDays} onChange={(v) => patch({ surveyorDays: v })} /></div>
              <NumberInput label="Surveyors" value={g.surveyorCount} onChange={(v) => patch({ surveyorCount: v, surveyorsOnSite: v })} />
              <Mini label="Surveyor Labour Sell" value={money(surveyorLabourSell)} />
            </div>
            {surveyorDaysOverridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Surveyor days overridden from {estimatedDays} to {surveyorDays}.</div>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Weekend Days" value={g.surveyorWeekendDays || g.weekendDaysPerWeek} onChange={(v) => patch({ surveyorWeekendDays: v })} />
              <NumberInput label="Night Shifts" value={g.surveyorNightShifts || g.nightShifts} onChange={(v) => patch({ surveyorNightShifts: v })} />
              <Toggle label="Engineering Report" checked={g.engineeringReport} onChange={(v) => patch({ engineeringReport: v })} />
              <Toggle label="Hotel / Subsistence" checked={g.surveyorHotelRequired} onChange={(v) => patch({ surveyorHotelRequired: v })} />
              {g.surveyorHotelRequired && <NumberInput label="Nights Per Team" value={g.surveyorHotelNights} onChange={(v) => patch({ surveyorHotelNights: v })} />}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Travel Days" value={g.surveyorTravelDays} onChange={(v) => patch({ surveyorTravelDays: v })} />
              <NumberInput label="One-Way Distance km" value={g.surveyorOneWayKm} onChange={(v) => patch({ surveyorOneWayKm: v })} />
              <NumberInput label="Vehicles" value={g.surveyorVehicles} onChange={(v) => patch({ surveyorVehicles: v })} />
              <Mini label="Calculated km" value={`${g.surveyorOneWayKm * 2 * Math.max(1, g.surveyorVehicles)}`} />
            </div>
          </div>
        </div>}
        <GrindingPageTabs grindingPage={grindingPage} setGrindingPage={setGrindingPage} placement="bottom" />
      </>}
      {grindingPage === "Tools & Review" && <>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Grinding Tools & Equipment</h2><p className="text-sm text-slate-500">Tool additions are only priced when production labour includes in-house work.</p></div>
          {!usesProductionInHouse ? <div className="p-5"><div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm font-bold text-sky-950">Tools are included in subcontract price. In-house grinding equipment is hidden from the costing.</div></div> : <div className="grid gap-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Grinder Days" value={`${grinderDays}`} />
              <Mini label="Planer Days" value={`${planerDays}`} />
              <Mini label="Vacuum Days" value={`${vacuumDays}`} />
              <Mini label="Generator Days" value={`${generatorDays}`} />
              <Mini label="Tool Sell" value={money(toolSell)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Toggle label="10000 watt generator" checked={g.generatorRequired} onChange={(v) => patch({ generatorRequired: v })} />
              <Toggle label="Large Generator" checked={g.largeGeneratorRequired} onChange={(v) => patch({ largeGeneratorRequired: v })} />
              <NumberInput label="Large Generator Rate" value={g.largeGeneratorRate} onChange={(v) => patch({ largeGeneratorRate: v })} />
              <NumberInput label="Delivery" value={g.largeGeneratorDelivery} onChange={(v) => patch({ largeGeneratorDelivery: v })} />
              <NumberInput label="Collection" value={g.largeGeneratorCollection} onChange={(v) => patch({ largeGeneratorCollection: v })} />
              <Mini label="Grinders" value={`${g.productionMen} men x ${toolDays} days = ${grinderDays}`} />
              <NumberInput label="Planers" value={g.gasPlaners} onChange={(v) => patch({ gasPlaners: v })} />
              <NumberInput label="Vacuums" value={g.dustVacuums} onChange={(v) => patch({ dustVacuums: v })} />
              <Toggle label="Extension Cords" checked={g.extensionCordsRequired} onChange={(v) => patch({ extensionCordsRequired: v })} />
              <Toggle label="Grinding Segments" checked={g.grindingSegmentsRequired} onChange={(v) => patch({ grindingSegmentsRequired: v })} />
              <Toggle label="Consumables" checked={g.consumablesRequired} onChange={(v) => patch({ consumablesRequired: v })} />
              <NumberInput label="Equipment Shipping" value={g.equipmentShipping} onChange={(v) => patch({ equipmentShipping: v })} />
            </div>
          </div>}
        </div>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Grinding Review</h2><p className="text-sm text-slate-500">Quick check before moving to the next quote section.</p></div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
            <Mini label="Estimated Days" value={`${estimatedDays}`} />
            <Mini label="Production Labour Sell" value={money((usesProductionInHouse ? productionLabourSell : 0) + (usesProductionSubcontract ? productionSubcontractSell : 0))} />
            <Mini label="Surveyor Labour Sell" value={money((usesSurveyorInHouse ? surveyorLabourSell : 0) + (usesSurveyorSubcontract ? surveyorSubcontractSell : 0))} />
            <Mini label="Tool Sell" value={money(toolSell)} />
          </div>
        </div>
        <GrindingPageTabs grindingPage={grindingPage} setGrindingPage={setGrindingPage} placement="bottom" />
      </>}
    </div>
  );
}

function GrindingPageTabs({ grindingPage, setGrindingPage, placement = "top" }: { grindingPage: GrindingPage; setGrindingPage: (page: GrindingPage) => void; placement?: "top" | "bottom" }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl bg-white p-2 shadow-sm ${placement === "bottom" ? "border border-slate-200" : ""}`}>
      {placement === "bottom" && <span className="px-2 text-[11px] font-bold uppercase text-slate-500">Grinding Sections</span>}
      {(["Programme", "Labour", "Tools & Review"] as GrindingPage[]).map((page, index) => (
        <button key={page} onClick={() => setGrindingPage(page)} className={`rounded-md px-3 py-2 text-sm font-bold ${grindingPage === page ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-800 hover:bg-slate-200"}`}>{index + 1}. {page}</button>
      ))}
    </div>
  );
}

function ScreedForm({ input, setInput, rates }: { input: ProjectInput; setInput: (input: ProjectInput) => void; rates: AdminRates }) {
  const s = input.screeding;
  const [screedPage, setScreedPage] = useState<ScreedPage>("Programme");
  const patch = (next: Partial<typeof s>) => setInput({ ...input, screeding: { ...s, ...next } });
  const updateTeam = (index: number, next: Partial<ScreedTeam>) => patch({ teams: s.teams.map((team, i) => i === index ? { ...team, ...next } : team) });
  const removeTeam = (index: number) => patch({ teams: s.teams.filter((_, i) => i !== index) });
  const addTeam = () => patch({ teams: [...s.teams, { enabled: true, contractorName: `Screed subcontractor ${s.teams.length + 1}`, scabble: false, prep: false, screed: true, grind: false, mobilisation: 0, mobilisationMargin: 0.3, priceType: "day", daysProgrammed: screedDays, rate: 0, margin: 0.3 }] });
  const screedDays = s.totalDaysOnSite || s.teams.reduce((sum, team) => sum + (team.enabled ? team.daysProgrammed : 0), 0);
  const productionMode = s.productionLabourMode ?? "subcontract";
  const surveyorMode = s.surveyorLabourMode ?? "in_house";
  const usesProductionInHouse = productionMode === "in_house" || productionMode === "both";
  const usesProductionSubcontract = productionMode === "subcontract" || productionMode === "both";
  const usesSurveyorInHouse = surveyorMode === "in_house" || surveyorMode === "both";
  const usesSurveyorSubcontract = surveyorMode === "subcontract" || surveyorMode === "both";
  const productionDays = s.productionLabourDays > 0 ? s.productionLabourDays : screedDays;
  const surveyorDays = s.surveyorDays > 0 ? s.surveyorDays : screedDays;
  const productionDaysOverridden = s.productionLabourDays > 0 && s.productionLabourDays !== screedDays;
  const surveyorDaysOverridden = s.surveyorDays > 0 && s.surveyorDays !== screedDays;
  const productionSubcontractSell = s.teams.reduce((sum, team) => {
    if (!team.enabled) return sum;
    const qty = team.priceType === "day" ? team.daysProgrammed || screedDays : team.rate ? 1 : 0;
    return sum + (team.mobilisation * (1 + (team.mobilisationMargin ?? rates.subcontractMargin))) + (team.rate * qty * (1 + (team.margin ?? rates.subcontractMargin)));
  }, 0);
  const surveyorSubcontractSell = repairSubcontractorSell(s.surveyorSubcontractors);
  const productionLabourSell = usesProductionInHouse ? s.productionMen * productionDays * rates.productionLabourDayRate * (1 + adminRateMargin(rates, "productionLabourDayRate", rates.defaultMargin)) : 0;
  const surveyorLabourSell = usesSurveyorInHouse ? s.surveyors * surveyorDays * rates.surveyorDayRate * (1 + adminRateMargin(rates, "surveyorDayRate", 0)) : 0;
  const materialSell = (s.screedMaterialBags * s.screedMaterialRate * (1 + s.screedMaterialMargin)) + (s.primerUnits * s.primerRate * (1 + s.primerMargin)) + (s.sandBags * s.sandRate * (1 + s.sandMargin)) + (s.materialShipping ? s.materialShipping * (1 + rates.materialMargin) : 0);
  const toolDays = usesProductionInHouse ? screedDays : 0;
  const grinderCount = Math.max(0, s.propaneGrinders || s.productionMen);
  const grinderDays = grinderCount * toolDays;
  const planerDays = s.gasPlaners * toolDays;
  const vacuumDays = s.dustVacuums * toolDays;
  const generatorDays = (s.generatorDays || 0) + (s.largeGeneratorRequired ? toolDays : 0);
  const toolSell = usesProductionInHouse ? (
    (s.generatorDays * rates.screedSmallGeneratorDayRate * (1 + adminRateMargin(rates, "screedSmallGeneratorDayRate", rates.equipmentMargin))) +
    (s.largeGeneratorRequired ? ((s.largeGeneratorRate * toolDays) + s.largeGeneratorDelivery + s.largeGeneratorCollection) * (1 + rates.equipmentMargin) : 0) +
    (grinderDays * rates.screedDiamondGrinderPropaneDayRate * (1 + adminRateMargin(rates, "screedDiamondGrinderPropaneDayRate", rates.equipmentMargin))) +
    (planerDays * rates.screedGasPlanerDayRate * (1 + adminRateMargin(rates, "screedGasPlanerDayRate", rates.equipmentMargin))) +
    (vacuumDays * rates.screedDustVacuumDayRate * (1 + adminRateMargin(rates, "screedDustVacuumDayRate", rates.equipmentMargin))) +
    (s.extensionCordSets * toolDays * rates.screedExtensionCordSetDayRate * (1 + adminRateMargin(rates, "screedExtensionCordSetDayRate", rates.equipmentMargin))) +
    (s.grindingSegmentsRequired ? grinderDays * rates.screedGrindingSegmentsDayRate * (1 + adminRateMargin(rates, "screedGrindingSegmentsDayRate", rates.equipmentMargin)) : 0) +
    (s.consumablesRequired ? Math.max(1, grinderCount) * toolDays * rates.screedConsumablesDayRate * (1 + adminRateMargin(rates, "screedConsumablesDayRate", rates.equipmentMargin)) : 0) +
    (s.equipmentShipping ? s.equipmentShipping * (1 + rates.equipmentMargin) : 0)
  ) : 0;
  const readiness = screedReadiness(input);
  const labourModeButton = (label: string, value: LabourMode, current: LabourMode, onChange: (value: LabourMode) => void) => (
    <button className={current === value ? "primary-button" : "secondary-button"} onClick={() => onChange(value)}>{label}</button>
  );
  return (
    <div className="grid gap-5">
      <div className="sticky top-2 z-10 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Mini label="Site Days" value={`${screedDays}`} />
          <Mini label="Production Labour" value={productionMode === "subcontract" ? "Subcontract" : productionMode === "in_house" ? "In-house" : "Both"} />
          <Mini label="Surveyor Labour" value={surveyorMode === "subcontract" ? "Subcontract" : surveyorMode === "in_house" ? "In-house" : "Both"} />
          <Mini label="Material Sell" value={money(materialSell)} />
          <Mini label="Subcontract Sell" value={money((usesProductionSubcontract ? productionSubcontractSell : 0) + (usesSurveyorSubcontract ? surveyorSubcontractSell : 0))} />
          <Mini label="Quote Status" value={readiness.blockers.length ? "Draft only" : readiness.warnings.length ? "Review" : "Ready"} />
        </div>
      </div>
      {readiness.blockers.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="mb-2 font-bold uppercase">Draft only - fix before quoting</div><div className="grid gap-1">{readiness.blockers.slice(0, 8).map((warning) => <div key={warning}>{warning}</div>)}</div></div>}
      {!readiness.blockers.length && readiness.warnings.length > 0 && <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><div className="mb-2 font-bold uppercase">Review before quoting</div><div className="grid gap-1">{readiness.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div></div>}
      <ScreedPageTabs screedPage={screedPage} setScreedPage={setScreedPage} />
      {screedPage === "Programme" && <>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Screeding Programme</h2><p className="text-sm text-slate-500">Set the expected site duration first. These days drive default labour, surveyor and in-house equipment quantities.</p></div>
          <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
            <NumberInput label="Area m2" value={s.areaM2} onChange={(v) => patch({ areaM2: v })} />
            <NumberInput label="Pour Days" value={s.pourDays} onChange={(v) => patch({ pourDays: v })} />
            <NumberInput label="Screw Days" value={s.screwDays} onChange={(v) => patch({ screwDays: v })} />
            <NumberInput label="Primer Days" value={s.primerDays} onChange={(v) => patch({ primerDays: v })} />
            <NumberInput label="Total Days On Site" value={s.totalDaysOnSite} onChange={(v) => patch({ totalDaysOnSite: v })} />
            <NumberInput label="Days Per Week" value={s.daysPerWeek} onChange={(v) => patch({ daysPerWeek: v })} />
            <NumberInput label="Weekend Days Worked Per Week" value={s.weekendDaysPerWeek} onChange={(v) => patch({ weekendDaysPerWeek: v, productionWeekendDays: v, surveyorWeekendDays: v })} />
            <Toggle label="Night Shifts" checked={s.nightShiftRequired} onChange={(v) => patch({ nightShiftRequired: v })} />
            {s.nightShiftRequired && <NumberInput label="Number of Night Shifts" value={s.nightShifts} onChange={(v) => patch({ nightShifts: v, productionNightShifts: v, surveyorNightShifts: v })} />}
          </div>
        </div>
        <ScreedPageTabs screedPage={screedPage} setScreedPage={setScreedPage} placement="bottom" />
      </>}
      {screedPage === "Labour" && <>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Screeding Production Labour</h2><p className="text-sm text-slate-500">Screeding is usually subcontracted. If in-house is selected, worker labour and tools are costed separately.</p></div>
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            {labourModeButton("Subcontract", "subcontract", productionMode, (value) => patch({ productionLabourMode: value }))}
            {labourModeButton("In-house", "in_house", productionMode, (value) => patch({ productionLabourMode: value }))}
            {labourModeButton("Both", "both", productionMode, (value) => patch({ productionLabourMode: value }))}
          </div>
        </div>
        {usesProductionSubcontract && <div className="app-card-strong">
          <div className="panel-heading flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-xl font-semibold">Screeding Production Subcontractors</h2><p className="text-sm text-slate-500">Add each subcontractor separately. Their price should include their labour, equipment and normal screeding tools.</p></div>
            <button className="secondary-button" onClick={addTeam}>Add Screeding Subcontractor</button>
          </div>
          <div className="grid gap-4 p-5">
            {(s.teams.length ? s.teams : []).map((team, index) => {
              const scope = [team.scabble && "Scabble", team.prep && "Prep", team.screed && "Screed", team.grind && "Grind"].filter(Boolean).join(", ") || "Scope not set";
              const qty = team.priceType === "day" ? team.daysProgrammed || screedDays : team.rate ? 1 : 0;
              const daysOverridden = team.priceType === "day" && team.daysProgrammed !== screedDays;
              const sell = team.enabled ? (team.mobilisation * (1 + (team.mobilisationMargin ?? rates.subcontractMargin))) + (team.rate * qty * (1 + (team.margin ?? rates.subcontractMargin))) : 0;
              return (
                <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4" key={index}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><div className="text-xs font-bold uppercase text-slate-500">Subcontractor {index + 1}</div><h3 className="font-bold text-slate-950">{team.contractorName || "Unnamed subcontractor"}</h3><p className="text-sm text-slate-500">{scope}</p></div>
                    <div className="flex flex-wrap gap-2"><Toggle label="Enabled" checked={team.enabled} onChange={(v) => updateTeam(index, { enabled: v })} /><button className="secondary-button" onClick={() => removeTeam(index)} disabled={s.teams.length === 1}>Remove</button></div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <Text label="Subcontractor / Scope" value={team.contractorName} onChange={(v) => updateTeam(index, { contractorName: v })} />
                    <Select label="Price Type" value={team.priceType} options={["day", "lump sum"]} onChange={(v) => updateTeam(index, { priceType: v as ScreedTeam["priceType"] })} />
                    <NumberInput label="Rate / Budget Cost" value={team.rate} onChange={(v) => updateTeam(index, { rate: v })} />
                    <NumberInput label="Margin %" value={(team.margin ?? rates.subcontractMargin) * 100} onChange={(v) => updateTeam(index, { margin: v / 100 })} />
                    {team.priceType === "day" ? <div className={daysOverridden ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Days Programmed" value={team.daysProgrammed} onChange={(v) => updateTeam(index, { daysProgrammed: v })} /></div> : <Mini label="Quantity" value="1 lump sum" />}
                    <Mini label="Proposal Cost" value={money(sell)} />
                    <NumberInput label="Mobilisation" value={team.mobilisation} onChange={(v) => updateTeam(index, { mobilisation: v })} />
                    <NumberInput label="Mobilisation Margin %" value={(team.mobilisationMargin ?? rates.subcontractMargin) * 100} onChange={(v) => updateTeam(index, { mobilisationMargin: v / 100 })} />
                    <Toggle label="Scabble" checked={team.scabble} onChange={(v) => updateTeam(index, { scabble: v })} />
                    <Toggle label="Prep" checked={team.prep} onChange={(v) => updateTeam(index, { prep: v })} />
                    <Toggle label="Screed" checked={team.screed} onChange={(v) => updateTeam(index, { screed: v })} />
                    <Toggle label="Grind" checked={team.grind} onChange={(v) => updateTeam(index, { grind: v })} />
                  </div>
                  {daysOverridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Subcontract days overridden from calculated {screedDays} to {team.daysProgrammed}.</div>}
                </div>
              );
            })}
          </div>
        </div>}
        {usesProductionInHouse && <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">In-House Screeding Labour</h2><p className="text-sm text-slate-500">Uses the shared production labour rates from Admin. Hotel nights are per team, then multiplied by men.</p></div>
          <div className="grid gap-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Calculated Site Days" value={`${screedDays}`} />
              <div className={productionDaysOverridden ? "rounded-lg border border-amber-200 bg-amber-50 p-3" : ""}><NumberInput label="Inputted Production Days" value={productionDays} onChange={(v) => patch({ productionLabourDays: v })} /></div>
              <NumberInput label="Production Men" value={s.productionMen} onChange={(v) => patch({ productionMen: v, propaneGrinders: v || s.propaneGrinders })} />
              <Mini label="Production Labour Sell" value={money(productionLabourSell)} />
            </div>
            {productionDaysOverridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Production labour days overridden from {screedDays} to {productionDays}.</div>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Weekend Days" value={s.productionWeekendDays || s.weekendDaysPerWeek} onChange={(v) => patch({ productionWeekendDays: v })} />
              <NumberInput label="Night Shifts" value={s.productionNightShifts || s.nightShifts} onChange={(v) => patch({ productionNightShifts: v })} />
              <Toggle label="Hotel / Subsistence" checked={s.productionHotelRequired} onChange={(v) => patch({ productionHotelRequired: v })} />
              {s.productionHotelRequired && <NumberInput label="Nights Per Team" value={s.productionHotelNights} onChange={(v) => patch({ productionHotelNights: v })} />}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Travel Days" value={s.productionTravelDays} onChange={(v) => patch({ productionTravelDays: v })} />
              <NumberInput label="One-Way Distance km" value={s.productionOneWayKm} onChange={(v) => patch({ productionOneWayKm: v })} />
              <NumberInput label="Vehicles / Vans" value={s.productionVehicles} onChange={(v) => patch({ productionVehicles: v })} />
              <Mini label="Calculated km" value={`${s.productionOneWayKm * 2 * Math.max(1, s.productionVehicles)}`} />
            </div>
          </div>
        </div>}
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Surveyor Labour</h2><p className="text-sm text-slate-500">Surveyor labour is always required for screeding and is separate from production labour.</p></div>
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            {labourModeButton("Subcontract", "subcontract", surveyorMode, (value) => patch({ surveyorLabourMode: value }))}
            {labourModeButton("In-house", "in_house", surveyorMode, (value) => patch({ surveyorLabourMode: value }))}
            {labourModeButton("Both", "both", surveyorMode, (value) => patch({ surveyorLabourMode: value }))}
          </div>
        </div>
        {usesSurveyorSubcontract && <SubcontractLabourPanel items={s.surveyorSubcontractors} calculatedDays={screedDays} onChange={(items) => patch({ surveyorSubcontractors: items })} title="Screeding Surveyor Subcontractors" description="Add subcontracted surveyor support separately from production subcontractors." addLabel="Add Surveyor Subcontractor" defaultName="Screed surveyor subcontractor" />}
        {usesSurveyorInHouse && <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">In-House Surveyor Labour</h2><p className="text-sm text-slate-500">Uses the surveyor rates from Admin. Hotel nights are per team, then multiplied by surveyors.</p></div>
          <div className="grid gap-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Calculated Site Days" value={`${screedDays}`} />
              <div className={surveyorDaysOverridden ? "rounded-lg border border-amber-200 bg-amber-50 p-3" : ""}><NumberInput label="Inputted Surveyor Days" value={surveyorDays} onChange={(v) => patch({ surveyorDays: v })} /></div>
              <NumberInput label="Surveyors" value={s.surveyors} onChange={(v) => patch({ surveyors: v })} />
              <Mini label="Surveyor Labour Sell" value={money(surveyorLabourSell)} />
            </div>
            {surveyorDaysOverridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Surveyor days overridden from {screedDays} to {surveyorDays}.</div>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Weekend Days" value={s.surveyorWeekendDays || s.weekendDaysPerWeek} onChange={(v) => patch({ surveyorWeekendDays: v })} />
              <NumberInput label="Night Shifts" value={s.surveyorNightShifts || s.nightShifts} onChange={(v) => patch({ surveyorNightShifts: v })} />
              <Toggle label="Engineering Report" checked={s.engineeringReport} onChange={(v) => patch({ engineeringReport: v })} />
              <Toggle label="Hotel / Subsistence" checked={s.surveyorHotelRequired || s.hotelRequired} onChange={(v) => patch({ surveyorHotelRequired: v, hotelRequired: v })} />
              {(s.surveyorHotelRequired || s.hotelRequired) && <NumberInput label="Nights Per Team" value={s.surveyorHotelNights} onChange={(v) => patch({ surveyorHotelNights: v })} />}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Travel Days" value={s.surveyorTravelDays} onChange={(v) => patch({ surveyorTravelDays: v })} />
              <NumberInput label="One-Way Distance km" value={s.surveyorOneWayKm} onChange={(v) => patch({ surveyorOneWayKm: v })} />
              <NumberInput label="Vehicles" value={s.surveyorVehicles} onChange={(v) => patch({ surveyorVehicles: v })} />
              <Mini label="Calculated km" value={`${s.surveyorOneWayKm * 2 * Math.max(1, s.surveyorVehicles)}`} />
            </div>
          </div>
        </div>}
        <ScreedPageTabs screedPage={screedPage} setScreedPage={setScreedPage} placement="bottom" />
      </>}
      {screedPage === "Materials" && <>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Screed Materials</h2><p className="text-sm text-slate-500">Material quantities and budget rates from the screeding costing sheet. Proposal cost applies the entered material margin.</p></div>
          <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
            <NumberInput label="Screed Bags" value={s.screedMaterialBags} onChange={(v) => patch({ screedMaterialBags: v })} />
            <NumberInput label="Screed Rate" value={s.screedMaterialRate} onChange={(v) => patch({ screedMaterialRate: v })} />
            <NumberInput label="Screed Margin %" value={s.screedMaterialMargin * 100} onChange={(v) => patch({ screedMaterialMargin: v / 100 })} />
            <Mini label="Screed Proposal Cost" value={money(s.screedMaterialBags * s.screedMaterialRate * (1 + s.screedMaterialMargin))} />
            <NumberInput label="Primer Units" value={s.primerUnits} onChange={(v) => patch({ primerUnits: v })} />
            <NumberInput label="Primer Rate" value={s.primerRate} onChange={(v) => patch({ primerRate: v })} />
            <NumberInput label="Primer Margin %" value={s.primerMargin * 100} onChange={(v) => patch({ primerMargin: v / 100 })} />
            <Mini label="Primer Proposal Cost" value={money(s.primerUnits * s.primerRate * (1 + s.primerMargin))} />
            <NumberInput label="Sand Bags" value={s.sandBags} onChange={(v) => patch({ sandBags: v })} />
            <NumberInput label="Sand Rate" value={s.sandRate} onChange={(v) => patch({ sandRate: v })} />
            <NumberInput label="Sand Margin %" value={s.sandMargin * 100} onChange={(v) => patch({ sandMargin: v / 100 })} />
            <Mini label="Sand Proposal Cost" value={money(s.sandBags * s.sandRate * (1 + s.sandMargin))} />
            <NumberInput label="Material Shipping" value={s.materialShipping} onChange={(v) => patch({ materialShipping: v })} />
            <Mini label="Total Material Sell" value={money(materialSell)} />
          </div>
        </div>
        <ScreedPageTabs screedPage={screedPage} setScreedPage={setScreedPage} placement="bottom" />
      </>}
      {screedPage === "Tools & Review" && <>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Screeding Tools & Equipment</h2><p className="text-sm text-slate-500">Tool additions are only priced when production labour includes in-house work.</p></div>
          {!usesProductionInHouse ? <div className="p-5"><div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm font-bold text-sky-950">Tools are included in subcontract price. In-house screeding equipment is hidden from the costing.</div></div> : <div className="grid gap-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Mini label="Grinder Days" value={`${grinderDays}`} />
              <Mini label="Planer Days" value={`${planerDays}`} />
              <Mini label="Vacuum Days" value={`${vacuumDays}`} />
              <Mini label="Generator Days" value={`${generatorDays}`} />
              <Mini label="Tool Sell" value={money(toolSell)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Generator Days" value={s.generatorDays} onChange={(v) => patch({ generatorDays: v })} />
              <Toggle label="Large Generator" checked={s.largeGeneratorRequired} onChange={(v) => patch({ largeGeneratorRequired: v })} />
              <NumberInput label="Large Generator Rate" value={s.largeGeneratorRate} onChange={(v) => patch({ largeGeneratorRate: v })} />
              <NumberInput label="Delivery" value={s.largeGeneratorDelivery} onChange={(v) => patch({ largeGeneratorDelivery: v })} />
              <NumberInput label="Collection" value={s.largeGeneratorCollection} onChange={(v) => patch({ largeGeneratorCollection: v })} />
              <NumberInput label="Grinders" value={grinderCount} onChange={(v) => patch({ propaneGrinders: v })} />
              <NumberInput label="Planers" value={s.gasPlaners} onChange={(v) => patch({ gasPlaners: v })} />
              <NumberInput label="Vacuums" value={s.dustVacuums} onChange={(v) => patch({ dustVacuums: v })} />
              <NumberInput label="Extension Cord Sets" value={s.extensionCordSets} onChange={(v) => patch({ extensionCordSets: v })} />
              <Toggle label="Grinding Segments" checked={s.grindingSegmentsRequired} onChange={(v) => patch({ grindingSegmentsRequired: v })} />
              <Toggle label="Consumables" checked={s.consumablesRequired} onChange={(v) => patch({ consumablesRequired: v })} />
              <NumberInput label="Equipment Shipping" value={s.equipmentShipping} onChange={(v) => patch({ equipmentShipping: v })} />
            </div>
          </div>}
        </div>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Screeding Review</h2><p className="text-sm text-slate-500">Quick check before moving to the next quote section.</p></div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
            <Mini label="Site Days" value={`${screedDays}`} />
            <Mini label="Production Labour Sell" value={money((usesProductionInHouse ? productionLabourSell : 0) + (usesProductionSubcontract ? productionSubcontractSell : 0))} />
            <Mini label="Surveyor Labour Sell" value={money((usesSurveyorInHouse ? surveyorLabourSell : 0) + (usesSurveyorSubcontract ? surveyorSubcontractSell : 0))} />
            <Mini label="Materials + Tools" value={money(materialSell + toolSell)} />
          </div>
        </div>
        <ScreedPageTabs screedPage={screedPage} setScreedPage={setScreedPage} placement="bottom" />
      </>}
    </div>
  );
}

function ScreedPageTabs({ screedPage, setScreedPage, placement = "top" }: { screedPage: ScreedPage; setScreedPage: (page: ScreedPage) => void; placement?: "top" | "bottom" }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl bg-white p-2 shadow-sm ${placement === "bottom" ? "border border-slate-200" : ""}`}>
      {placement === "bottom" && <span className="px-2 text-[11px] font-bold uppercase text-slate-500">Screeding Sections</span>}
      {(["Programme", "Labour", "Materials", "Tools & Review"] as ScreedPage[]).map((page, index) => (
        <button key={page} onClick={() => setScreedPage(page)} className={`rounded-md px-3 py-2 text-sm font-bold ${screedPage === page ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-800 hover:bg-slate-200"}`}>{index + 1}. {page}</button>
      ))}
    </div>
  );
}

function RepairsForm({ input, setInput, repairCatalog, rates, projectMaterialCalcs }: { input: ProjectInput; setInput: (input: ProjectInput) => void; repairCatalog: RepairCatalog; rates: AdminRates; projectMaterialCalcs: ReturnType<typeof calculateProjectRepairMaterials> }) {
  const r = input.repairs;
  const [repairMode, setRepairMode] = useState<"Simple" | "Advanced">("Simple");
  const [repairPage, setRepairPage] = useState<RepairPage>("Details");
  const [pendingOptional, setPendingOptional] = useState<Record<string, string>>({});
  const patch = (next: Partial<typeof r>) => setInput({ ...input, repairs: { ...r, ...next } });
  const updateRepairLine = (index: number, next: Partial<RepairLineItem>) => patch({ repairLines: r.repairLines.map((item, i) => i === index ? { ...item, ...next } : item) });
  const materialCost = (repairLine: RepairLineItem) => calculateRepairLineMaterials(repairLine, repairCatalog).reduce((sum, calc) => sum + calc.cost, 0);
  const selectedMaterialIds = (repairLine: RepairLineItem) => {
    const type = repairTypeByCode(repairLine.repairTypeCode, repairCatalog);
    const selected = new Set(repairLine.materialSelections.filter((selection) => selection.selected).map((selection) => selection.materialId));
    return type.materialRules.filter((rule) => rule.role === "required" || selected.has(rule.materialId)).map((rule) => rule.materialId);
  };
  const selectedMaterials = (repairLine: RepairLineItem) => selectedMaterialIds(repairLine).map((id) => repairCatalog.materials.find((material) => material.id === id)).filter((material): material is RepairMaterial => Boolean(material));
  const materialUsesOwnDimensions = (material: RepairMaterial) => material.category === "Sealant" && material.calcMethod === "volume_lwd";
  const materialSelection = (repairLine: RepairLineItem, materialId: string) => repairLine.materialSelections.find((selection) => selection.materialId === materialId);
  const patchMaterialSelection = (lineIndex: number, repairLine: RepairLineItem, materialId: string, next: Partial<RepairLineItem["materialSelections"][number]>) => {
    const exists = repairLine.materialSelections.some((selection) => selection.materialId === materialId);
    const materialSelections = exists
      ? repairLine.materialSelections.map((selection) => selection.materialId === materialId ? { ...selection, ...next } : selection)
      : [...repairLine.materialSelections, { materialId, selected: true, widthMm: repairLine.widthMm, depthMm: repairLine.depthMm, ...next }];
    updateRepairLine(lineIndex, { materialSelections });
  };
  const addOptionalMaterial = (lineIndex: number, repairLine: RepairLineItem, materialId: string) => {
    if (!materialId) return;
    toggleMaterial(lineIndex, materialId, true);
    setPendingOptional({ ...pendingOptional, [repairLine.id]: "" });
  };
  const readiness = repairReadiness(input, repairCatalog);
  const repairLineMaterialTotal = r.repairLines.reduce((sum, repairLine) => sum + materialCost(repairLine), 0);
  const materialTypesRequired = new Set(projectMaterialCalcs.map((calc) => calc.product.replace(/^Type\s*[\w. -]+ - /, ""))).size;
  const repairLineDaysTotal = Math.ceil(r.repairLines.reduce((sum, repairLine) => sum + repairLineDays(repairLine, repairCatalog), 0));
  const effectiveRepairDays = r.labourDays > 0 ? r.labourDays : repairLineDaysTotal;
  const repairDaysOverridden = r.labourDays > 0 && r.labourDays !== repairLineDaysTotal;
  const labourMode = r.labourMode ?? "subcontract";
  const usesSubcontract = labourMode === "subcontract" || labourMode === "both";
  const usesInHouse = labourMode === "in_house" || labourMode === "both";
  const mobilisationKm = Math.max(0, r.mobilisationOneWayKm) * 2 * Math.max(1, r.mobilisationVehicles);
  const hotelRoomNights = r.hotelRequired ? r.hotelNights * Math.max(0, r.labourMen) : 0;
  const inHouseMen = Math.max(0, r.labourMen);
  const inHouseSellTotal = usesInHouse ? ((inHouseMen * effectiveRepairDays * rates.productionLabourDayRate * (1 + adminRateMargin(rates, "productionLabourDayRate", rates.defaultMargin))) + (r.weekendRequired ? inHouseMen * r.weekendDays * rates.productionWeekendDayRate * (1 + adminRateMargin(rates, "productionWeekendDayRate", rates.defaultMargin)) : 0) + (r.nightShiftRequired ? inHouseMen * r.nightShiftHours * rates.productionNightShiftAllowance * (1 + adminRateMargin(rates, "productionNightShiftAllowance", rates.defaultMargin)) : 0) + (inHouseMen * r.travelDays * rates.productionLabourTravelDayRate * (1 + adminRateMargin(rates, "productionLabourTravelDayRate", rates.travelMargin))) + (hotelRoomNights * rates.hotel * (1 + adminRateMargin(rates, "hotel", rates.hotelMargin))) + (hotelRoomNights * rates.subsistence * (1 + adminRateMargin(rates, "subsistence", rates.subsistenceMargin))) + (mobilisationKm * rates.repairFuelPerKm * (1 + adminRateMargin(rates, "repairFuelPerKm", rates.travelMargin)))) : 0;
  const subcontractSellTotal = repairSubcontractorSell(r.repairSubcontractors);
  const logisticsSellTotal = additionalItemsSell(r.haulageItems);
  const selectedOptionalRules = (repairLine: RepairLineItem) => {
    const type = repairTypeByCode(repairLine.repairTypeCode, repairCatalog);
    const selected = new Set(repairLine.materialSelections.filter((selection) => selection.selected).map((selection) => selection.materialId));
    return type.materialRules.filter((rule) => rule.role === "optional" && (selected.has(rule.materialId) || rule.defaultSelected));
  };
  const duplicateRepairLine = (index: number) => {
    const source = r.repairLines[index];
    const copy = { ...source, id: `${source.repairTypeCode}-${Math.random().toString(36).slice(2, 9)}`, description: `${source.description || source.repairTypeCode} copy` };
    patch({ repairLines: [...r.repairLines.slice(0, index + 1), copy, ...r.repairLines.slice(index + 1)] });
  };
  const changeRepairType = (index: number, code: string) => {
    const current = r.repairLines[index];
    const next = createRepairLine(code, repairCatalog);
    patch({ repairLines: r.repairLines.map((item, i) => i === index ? { ...next, id: current.id, lengthM: current.lengthM || next.lengthM, areaM2: current.areaM2 || next.areaM2, eachQty: current.eachQty || next.eachQty } : item) });
  };
  const toggleMaterial = (lineIndex: number, materialId: string, selected: boolean) => {
    const line = r.repairLines[lineIndex];
    const existing = line.materialSelections.some((item) => item.materialId === materialId);
    const materialSelections = existing
      ? line.materialSelections.map((item) => item.materialId === materialId ? { ...item, selected, widthMm: item.widthMm ?? line.widthMm, depthMm: item.depthMm ?? line.depthMm } : item)
      : [...line.materialSelections, { materialId, selected, widthMm: line.widthMm, depthMm: line.depthMm }];
    updateRepairLine(lineIndex, { materialSelections });
  };
  return (
    <div className="grid gap-5">
      <div className="sticky top-2 z-10 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Mini label="Days Calculated" value={`${repairLineDaysTotal}`} />
          <Mini label="Days Inputted" value={r.labourDays > 0 ? `${effectiveRepairDays}${repairDaysOverridden ? " override" : ""}` : `${repairLineDaysTotal} default`} />
          <Mini label="Materials Cost" value={money(repairLineMaterialTotal)} />
          <Mini label="Subcontract Sell" value={money(usesSubcontract ? subcontractSellTotal : 0)} />
          <Mini label="Haulage" value={money(logisticsSellTotal)} />
          <Mini label="Quote Status" value={readiness.blockers.length ? "Draft only" : readiness.warnings.length ? "Review" : "Ready"} />
        </div>
      </div>
      {readiness.blockers.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="mb-2 font-bold uppercase">Draft only - fix before quoting</div>
          <div className="grid gap-1">{readiness.blockers.slice(0, 8).map((warning) => <div key={warning}>{warning}</div>)}</div>
        </div>
      )}
      {!readiness.blockers.length && readiness.warnings.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
          <div className="mb-2 font-bold uppercase">Review before quoting</div>
          <div className="grid gap-1">{readiness.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div>
        </div>
      )}
      <RepairPageTabs repairPage={repairPage} setRepairPage={setRepairPage} />
      {repairPage === "Details" && <>
      <div className="app-card-strong">
        <div className="panel-heading flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-semibold">Repair Type Schedule</h2><p className="text-sm text-slate-500">Add one row per repair type. Materials are suggested from the repair database using the company-standard booklet codes.</p></div>
          <div className="flex rounded-lg bg-slate-100 p-1">
            {(["Simple", "Advanced"] as const).map((mode) => <button key={mode} className={repairMode === mode ? "primary-button" : "secondary-button"} onClick={() => setRepairMode(mode)}>{mode}</button>)}
          </div>
        </div>
        <div className="grid gap-4 p-5">
          {r.repairLines.map((repairLine, index) => {
            const type = repairTypeByCode(repairLine.repairTypeCode, repairCatalog);
            const selectedOptionalIds = new Set(repairLine.materialSelections.filter((selection) => selection.selected).map((selection) => selection.materialId));
            const required = type.materialRules.filter((rule) => rule.role === "required");
            const optional = type.materialRules.filter((rule) => rule.role === "optional");
            const optionalSelected = selectedOptionalRules(repairLine);
            const optionalAvailable = optional.filter((rule) => !optionalSelected.some((selected) => selected.materialId === rule.materialId));
            const pendingOptionalValue = pendingOptional[repairLine.id] || optionalAvailable[0]?.materialId || "";
            const materialCalcs = calculateRepairLineMaterials(repairLine, repairCatalog);
            const sealantMaterials = selectedMaterials(repairLine).filter(materialUsesOwnDimensions);
            const days = Math.ceil(repairLineDays(repairLine, repairCatalog));
            const materials = materialCost(repairLine);
            const estimatedLineValue = materials * (1 + rates.materialMargin);
            return (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={repairLine.id}>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase text-sky-700">{type.code}</div>
                    <h3 className="text-lg font-bold text-slate-950">{type.name}</h3>
                    <p className="mt-1 max-w-3xl text-sm text-slate-600">{type.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="secondary-button" onClick={() => duplicateRepairLine(index)}>Duplicate</button>
                    <button className="secondary-button" onClick={() => patch({ repairLines: r.repairLines.filter((_, i) => i !== index) })} disabled={r.repairLines.length === 1}>Remove</button>
                  </div>
                </div>
                <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Mini label="Quantity" value={`${repairLineQuantity(repairLine, repairCatalog) || 0} ${type.measurementBasis === "area" ? "m2" : type.measurementBasis === "each" ? "each" : type.measurementBasis === "manual" ? "manual" : "m"}`} />
                  <Mini label="Programme" value={`${days} day${days === 1 ? "" : "s"}`} />
                  <Mini label="Materials" value={money(materials)} />
                  <Mini label="Material Sell" value={money(estimatedLineValue)} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Select label="Repair Type" value={repairLine.repairTypeCode} options={repairCatalog.types.filter((item) => item.active).map((item) => item.code)} onChange={(v) => changeRepairType(index, v)} />
                  <Text label="Repair Name" value={repairLine.description || type.name} onChange={(v) => updateRepairLine(index, { description: v })} />
                  {repairMode === "Advanced" && <NumberInput label="Output Per Day" value={repairLine.outputPerDay || type.defaultOutputPerDay} onChange={(v) => updateRepairLine(index, { outputPerDay: v })} />}
                  {repairMode === "Advanced" && <Text label="Measure Basis" value={type.measurementBasis} onChange={() => undefined} />}
                  {type.measurementBasis === "linear" && <NumberInput label="Length m" value={repairLine.lengthM} onChange={(v) => updateRepairLine(index, { lengthM: v })} />}
                  {type.measurementBasis === "linear" && <NumberInput label="Width mm" value={repairLine.widthMm} onChange={(v) => updateRepairLine(index, { widthMm: v })} />}
                  {type.measurementBasis === "linear" && <NumberInput label="Depth mm" value={repairLine.depthMm} onChange={(v) => updateRepairLine(index, { depthMm: v })} />}
                  {type.measurementBasis === "area" && <NumberInput label="Area m2" value={repairLine.areaM2} onChange={(v) => updateRepairLine(index, { areaM2: v })} />}
                  {type.measurementBasis === "area" && <NumberInput label="Thickness mm" value={repairLine.thicknessMm} onChange={(v) => updateRepairLine(index, { thicknessMm: v })} />}
                  {type.measurementBasis === "each" && <NumberInput label="Quantity each" value={repairLine.eachQty} onChange={(v) => updateRepairLine(index, { eachQty: v })} />}
                  {type.measurementBasis === "each" && <NumberInput label="Hole Diameter mm" value={repairLine.holeDiameterMm} onChange={(v) => updateRepairLine(index, { holeDiameterMm: v })} />}
                  {type.measurementBasis === "each" && <NumberInput label="Hole Depth mm" value={repairLine.holeDepthMm} onChange={(v) => updateRepairLine(index, { holeDepthMm: v })} />}
                  {type.measurementBasis === "manual" && <NumberInput label="Manual Material Qty" value={repairLine.manualMaterialQty} onChange={(v) => updateRepairLine(index, { manualMaterialQty: v })} />}
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="mb-2 text-xs font-bold uppercase text-slate-500">Required Materials</div>
                    <div className="flex flex-wrap gap-2">
                      {required.length ? required.map((rule) => {
                        const material = repairCatalog.materials.find((item) => item.id === rule.materialId);
                        return material ? <span className="rounded-full bg-sky-700 px-3 py-1 text-xs font-bold text-white" key={rule.materialId}>{material.name}</span> : null;
                      }) : <span className="text-sm text-slate-500">No required materials assigned.</span>}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="mb-2 text-xs font-bold uppercase text-slate-500">Optional Materials</div>
                    <div className="flex flex-wrap gap-2">
                      {optionalSelected.length ? optionalSelected.map((rule) => {
                        const material = repairCatalog.materials.find((item) => item.id === rule.materialId);
                        return material ? <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200" key={rule.materialId}><span className="truncate">{material.name}</span><button className="rounded-full bg-slate-100 px-1.5 py-0.5" onClick={() => toggleMaterial(index, rule.materialId, false)}>Remove</button></span> : null;
                      }) : <span className="text-sm text-slate-500">No optional materials selected.</span>}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <select value={pendingOptionalValue} onChange={(event) => setPendingOptional({ ...pendingOptional, [repairLine.id]: event.target.value })} disabled={!optionalAvailable.length}>
                        {optionalAvailable.map((rule) => {
                          const material = repairCatalog.materials.find((item) => item.id === rule.materialId);
                          return material ? <option key={rule.materialId} value={rule.materialId}>{material.category} - {material.name}</option> : null;
                        })}
                      </select>
                      <button className="secondary-button" onClick={() => addOptionalMaterial(index, repairLine, pendingOptionalValue)} disabled={!optionalAvailable.length}>Add Optional</button>
                    </div>
                  </div>
                </div>
                {sealantMaterials.length > 0 && (
                  <div className="mt-4 rounded-lg border border-sky-100 bg-sky-50 p-3">
                    <div className="mb-2 text-xs font-bold uppercase text-sky-700">Sealant-Specific Dimensions</div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {sealantMaterials.map((material) => {
                        const selection = materialSelection(repairLine, material.id);
                        return (
                          <div className="rounded-lg bg-white p-3 ring-1 ring-sky-100" key={material.id}>
                            <div className="mb-2 truncate text-sm font-bold text-slate-950">{material.name}</div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <NumberInput label="Sealant Width mm" value={selection?.widthMm ?? repairLine.widthMm} onChange={(v) => patchMaterialSelection(index, repairLine, material.id, { widthMm: v })} />
                              <NumberInput label="Sealant Depth mm" value={selection?.depthMm ?? repairLine.depthMm} onChange={(v) => patchMaterialSelection(index, repairLine, material.id, { depthMm: v })} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {repairMode === "Advanced" && <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-bold uppercase text-slate-500">Material Take-Off Preview</div>
                  {materialCalcs.length ? (
                    <div className="table-shell border-0 bg-white">
                      <table>
                        <thead><tr><th>Material</th><th>Qty</th><th>Rate</th><th>Cost</th></tr></thead>
                        <tbody>{materialCalcs.map((calc) => <tr key={`${repairLine.id}-${calc.product}`}><td className="font-semibold">{calc.product.replace(`${repairLine.repairTypeCode} - `, "")}<div className="text-xs font-normal text-slate-500">{calc.formula}</div></td><td>{calc.quantity} {calc.unit}</td><td>{money(calc.rate)}</td><td className="font-bold">{money(calc.cost)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  ) : <div className="text-sm text-slate-500">No material quantity yet. Add dimensions/quantity or check the repair type material rules.</div>}
                </div>}
              </div>
            );
          })}
          <button className="secondary-button justify-self-start" onClick={() => patch({ repairLines: [...r.repairLines, createRepairLine(repairCatalog.types.find((type) => type.active)?.code ?? "Type 1", repairCatalog)] })}>Add Repair Type</button>
        </div>
      </div>
      <MaterialSummary materialCalcs={projectMaterialCalcs} materialMargin={rates.materialMargin} repairCatalog={repairCatalog} />
      <HaulageItems items={r.haulageItems} onChange={(items) => patch({ haulageItems: items })} />
      <RepairPageTabs repairPage={repairPage} setRepairPage={setRepairPage} placement="bottom" />
      </>}
      {repairPage === "Labour" && <>
      <div className="app-card-strong">
        <div className="panel-heading"><h2 className="text-xl font-semibold">Repair Labour Type</h2><p className="text-sm text-slate-500">Choose subcontract, in-house, or both. If both is selected, both sections are added to the quote.</p></div>
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          {(["subcontract", "in_house", "both"] as RepairLabourMode[]).map((mode) => (
            <button key={mode} className={labourMode === mode ? "primary-button" : "secondary-button"} onClick={() => patch({ labourMode: mode })}>{mode === "subcontract" ? "Subcontract" : mode === "in_house" ? "In-house" : "Both"}</button>
          ))}
        </div>
      </div>
      {usesSubcontract && <SubcontractLabourPanel items={r.repairSubcontractors} calculatedDays={effectiveRepairDays} onChange={(items) => patch({ repairSubcontractors: items })} />}
      {usesInHouse && <InHouseLabourPanel input={r} rates={rates} calculatedDays={repairLineDaysTotal} effectiveDays={effectiveRepairDays} mobilisationKm={mobilisationKm} hotelRoomNights={hotelRoomNights} onChange={patch} />}
      <RepairPageTabs repairPage={repairPage} setRepairPage={setRepairPage} placement="bottom" />
      </>}
      {repairPage === "Review" && <>
      <div className="app-card-strong">
        <div className="panel-heading"><h2 className="text-xl font-semibold">Repair Review</h2><p className="text-sm text-slate-500">Check materials, labour and haulage before saving the quote.</p></div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <Mini label="Labour Type" value={labourMode === "subcontract" ? "Subcontract" : labourMode === "in_house" ? "In-house" : "Both"} />
          <Mini label="Repair Days" value={r.labourDays > 0 ? `${effectiveRepairDays}${repairDaysOverridden ? " override" : " inputted"}` : `${repairLineDaysTotal} default`} />
          <Mini label="Material Types Required" value={`${materialTypesRequired} material type${materialTypesRequired === 1 ? "" : "s"}`} />
          <Mini label="Haulage" value={money(logisticsSellTotal)} />
        </div>
      </div>
      <MaterialSummary materialCalcs={projectMaterialCalcs} materialMargin={rates.materialMargin} repairCatalog={repairCatalog} />
      <CostBuildUp materialCost={repairLineMaterialTotal} materialMargin={rates.materialMargin} subcontractSell={usesSubcontract ? subcontractSellTotal : 0} inHouseSell={inHouseSellTotal} logisticsSell={logisticsSellTotal} />
      <RepairPageTabs repairPage={repairPage} setRepairPage={setRepairPage} placement="bottom" />
      </>}
    </div>
  );
}

function RepairPageTabs({ repairPage, setRepairPage, placement = "top" }: { repairPage: RepairPage; setRepairPage: (page: RepairPage) => void; placement?: "top" | "bottom" }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl bg-white p-2 shadow-sm ${placement === "bottom" ? "border border-slate-200" : ""}`}>
      {placement === "bottom" && <span className="px-2 text-[11px] font-bold uppercase text-slate-500">Repair Sections</span>}
      {(["Details", "Labour", "Review"] as RepairPage[]).map((page, index) => (
        <button key={page} onClick={() => setRepairPage(page)} className={`rounded-md px-3 py-2 text-sm font-bold ${repairPage === page ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-800 hover:bg-slate-200"}`}>{index + 1}. Repair {page}</button>
      ))}
    </div>
  );
}

function MaterialSummary({ materialCalcs, materialMargin, repairCatalog }: { materialCalcs: ReturnType<typeof calculateRepairLineMaterials>; materialMargin: number; repairCatalog: RepairCatalog }) {
  const grouped = Array.from(materialCalcs.reduce((map, calc) => {
    const materialName = calc.product.replace(/^Type\s*[\w. -]+ - /, "");
    const existing = map.get(materialName) ?? { ...calc, product: materialName, quantity: 0, cost: 0 };
    map.set(materialName, { ...existing, quantity: existing.quantity + calc.quantity, cost: existing.cost + calc.cost });
    return map;
  }, new Map<string, ReturnType<typeof calculateRepairLineMaterials>[number]>()).values());
  return (
    <div className="app-card-strong">
      <div className="panel-heading"><h2 className="text-xl font-semibold">Project Material Summary</h2><p className="text-sm text-slate-500">Same materials are combined across all repair types. Quantities are full purchasable units.</p></div>
      <div className="table-shell border-0">
        <table>
          <thead><tr><th>Material</th><th>Full Units</th><th>Unit Size</th><th>Cost / Unit</th><th>Material Cost</th><th>Sell With Margin</th></tr></thead>
          <tbody>
            {grouped.map((calc) => {
              const material = repairCatalog.materials.find((item) => item.name === calc.product);
              return <tr key={calc.product}><td className="font-semibold">{calc.product}</td><td>{Math.ceil(calc.quantity)} {calc.unit}</td><td>{material ? `${material.unitSize} ${material.unitType}` : "-"}</td><td>{money(calc.rate)}</td><td>{money(calc.cost)}</td><td className="font-bold">{money(calc.cost * (1 + materialMargin))}</td></tr>;
            })}
            {!grouped.length && <tr><td colSpan={6} className="text-slate-500">Add repair quantities to generate the material summary.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HaulageItems({ items, onChange }: { items: AdditionalItem[]; onChange: (items: AdditionalItem[]) => void }) {
  const normalise = (item: AdditionalItem): AdditionalItem => ({ ...item, unit: "item", quantity: 1, margin: Number.isFinite(item.margin) ? item.margin : 0.3 });
  const currentItems = items.length ? items.map(normalise) : [{ name: "Delivery of material", rate: 0, unit: "item", quantity: 1, margin: 0.3 }];
  const update = (index: number, next: Partial<AdditionalItem>) => onChange(currentItems.map((item, i) => i === index ? normalise({ ...item, ...next }) : item));
  return (
    <div className="app-card-strong">
      <div className="panel-heading"><h2 className="text-xl font-semibold">Haulage Items</h2><p className="text-sm text-slate-500">One delivery or haulage charge per line. Add another line for multiple deliveries.</p></div>
      <div className="grid gap-3 p-5">
        {currentItems.map((item, index) => (
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_160px_140px_140px_auto]" key={index}>
            <Text label="Name" value={item.name} onChange={(v) => update(index, { name: v })} />
            <NumberInput label="Rate" value={item.rate} onChange={(v) => update(index, { rate: v })} />
            <NumberInput label="Margin %" value={item.margin * 100} onChange={(v) => update(index, { margin: v / 100 })} />
            <Mini label="Sell" value={money(item.rate * (1 + item.margin))} />
            <button className="secondary-button self-end" onClick={() => onChange(currentItems.filter((_, i) => i !== index))} disabled={currentItems.length === 1}>Remove</button>
          </div>
        ))}
        <button className="secondary-button justify-self-start" onClick={() => onChange([...currentItems, { name: "New haulage item", rate: 0, unit: "item", quantity: 1, margin: 0.3 }])}>Add Haulage Item</button>
      </div>
    </div>
  );
}

function InHouseLabourPanel({ input, rates, calculatedDays, effectiveDays, mobilisationKm, hotelRoomNights, onChange }: { input: ProjectInput["repairs"]; rates: AdminRates; calculatedDays: number; effectiveDays: number; mobilisationKm: number; hotelRoomNights: number; onChange: (next: Partial<ProjectInput["repairs"]>) => void }) {
  const inputtedDays = input.labourDays > 0 ? input.labourDays : calculatedDays;
  const overridden = input.labourDays > 0 && input.labourDays !== calculatedDays;
  return (
    <div className="app-card-strong">
      <div className="panel-heading"><h2 className="text-xl font-semibold">In-House Labour & Mobilisation</h2><p className="text-sm text-slate-500">Use only when FACE is supplying labour. Distance is one-way km; return mileage is calculated.</p></div>
      <div className="grid gap-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Mini label="Calculated Repair Days" value={`${calculatedDays}`} />
          <div className={overridden ? "rounded-lg border border-amber-200 bg-amber-50 p-3" : ""}><NumberInput label="Inputted Repair Days" value={inputtedDays} onChange={(v) => onChange({ labourDays: v })} /></div>
          <NumberInput label="Men Per Team" value={input.labourMen} onChange={(v) => onChange({ labourMen: v })} />
          <Mini label="Labour Sell" value={money(Math.max(0, input.labourMen) * effectiveDays * rates.productionLabourDayRate * (1 + adminRateMargin(rates, "productionLabourDayRate", rates.defaultMargin)))} />
        </div>
        {overridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Repair days overridden from {calculatedDays} to {effectiveDays}.</div>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Toggle label="Weekend Days" checked={input.weekendRequired} onChange={(v) => onChange({ weekendRequired: v })} />
          {input.weekendRequired && <NumberInput label="Weekend Days Per Week" value={input.weekendDays} onChange={(v) => onChange({ weekendDays: v })} />}
          <Toggle label="Night Shifts" checked={input.nightShiftRequired} onChange={(v) => onChange({ nightShiftRequired: v })} />
          {input.nightShiftRequired && <NumberInput label="Number of Night Shifts" value={input.nightShiftHours} onChange={(v) => onChange({ nightShiftHours: v })} />}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Toggle label="Hotel / Subsistence" checked={input.hotelRequired} onChange={(v) => onChange({ hotelRequired: v, subsistenceRequired: v })} />
          {input.hotelRequired && <NumberInput label="Nights Per Team" value={input.hotelNights} onChange={(v) => onChange({ hotelNights: v })} />}
          {input.hotelRequired && <Mini label="Room Nights" value={`${hotelRoomNights}`} />}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <NumberInput label="Travel Days" value={input.travelDays} onChange={(v) => onChange({ travelDays: v })} />
          <NumberInput label="One-Way Distance km" value={input.mobilisationOneWayKm} onChange={(v) => onChange({ mobilisationOneWayKm: v })} />
          <NumberInput label="Vehicles / Vans" value={input.mobilisationVehicles} onChange={(v) => onChange({ mobilisationVehicles: v })} />
          <Mini label="Calculated Fuel km" value={`${mobilisationKm}`} />
        </div>
      </div>
    </div>
  );
}

function SubcontractLabourPanel({ items, calculatedDays, onChange, title = "Subcontract Labour", description = "Add each subcontractor separately. Mobilisation stays in subcontract costs, not travel.", addLabel = "Add Additional Subcontractor", defaultName = "Subcontractor" }: { items: RepairSubcontractor[]; calculatedDays: number; onChange: (items: RepairSubcontractor[]) => void; title?: string; description?: string; addLabel?: string; defaultName?: string }) {
  const currentItems = items.length ? items : [{ name: defaultName, priceType: "lump sum" as PriceType, rate: 0, days: calculatedDays || 0, margin: 0.3, mobilisationCost: 0, mobilisations: 0, mobilisationMargin: 0.3 }];
  const update = (index: number, next: Partial<RepairSubcontractor>) => onChange(currentItems.map((item, i) => i === index ? { ...item, ...next } : item));
  const add = () => onChange([...currentItems, { name: defaultName, priceType: "lump sum", rate: 0, days: calculatedDays || 0, margin: 0.3, mobilisationCost: 0, mobilisations: 0, mobilisationMargin: 0.3 }]);
  return (
    <div className="app-card-strong">
      <div className="panel-heading">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      <div className="grid gap-4 p-5">
        {currentItems.map((item, index) => {
          const method = item.priceType === "day" ? "Day Rate" : "Lump Sum";
          const labourQty = item.priceType === "day" ? item.days : item.rate ? 1 : 0;
          const labourCost = item.rate * labourQty;
          const mobilisationCost = item.mobilisationCost * item.mobilisations;
          const daysOverridden = item.priceType === "day" && item.days !== calculatedDays;
          return (
            <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4" key={index}>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_180px_160px_160px_140px_auto]">
                <Text label="Subcontractor / Scope" value={item.name} onChange={(v) => update(index, { name: v })} />
                <Select label="Pricing Method" value={method} options={["Lump Sum", "Day Rate"]} onChange={(v) => update(index, { priceType: v === "Day Rate" ? "day" : "lump sum", days: v === "Day Rate" ? item.days || calculatedDays || 0 : item.days })} />
                <NumberInput label={item.priceType === "day" ? "Day Rate Cost" : "Lump Sum Cost"} value={item.rate} onChange={(v) => update(index, { rate: v })} />
                {item.priceType === "day" ? <div className={daysOverridden ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Subcontract Days" value={item.days} onChange={(v) => update(index, { days: v })} /></div> : <Mini label="Quantity" value="1 lump sum" />}
                <NumberInput label="Margin %" value={item.margin * 100} onChange={(v) => update(index, { margin: v / 100 })} />
                <button className="secondary-button self-end" onClick={() => onChange(currentItems.filter((_, i) => i !== index))} disabled={currentItems.length === 1}>Remove</button>
              </div>
              {daysOverridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Subcontract days overridden from calculated {calculatedDays} to {item.days}.</div>}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_160px_160px_140px]">
                <NumberInput label="Mobilisation Cost" value={item.mobilisationCost} onChange={(v) => update(index, { mobilisationCost: v })} />
                <NumberInput label="No. of Mobilisations" value={item.mobilisations} onChange={(v) => update(index, { mobilisations: v })} />
                <NumberInput label="Mobilisation Margin %" value={item.mobilisationMargin * 100} onChange={(v) => update(index, { mobilisationMargin: v / 100 })} />
                <Mini label="Subcontract Sell" value={money((labourCost * (1 + item.margin)) + (mobilisationCost * (1 + item.mobilisationMargin)))} />
              </div>
            </div>
          );
        })}
        <button className="secondary-button justify-self-start" onClick={add}>{addLabel}</button>
      </div>
    </div>
  );
}

function CostBuildUp({ materialCost, materialMargin, subcontractSell, inHouseSell, logisticsSell }: { materialCost: number; materialMargin: number; subcontractSell: number; inHouseSell: number; logisticsSell: number }) {
  const materialSell = materialCost * (1 + materialMargin);
  const rows = [
    ["Materials incl. margin", materialSell],
    ["Subcontract labour/equipment", subcontractSell],
    ["In-house labour/mobilisation", inHouseSell],
    ["Haulage", logisticsSell]
  ] as const;
  return (
    <div className="app-card-strong">
      <div className="panel-heading"><h2 className="text-xl font-semibold">Repair Cost Build-Up</h2><p className="text-sm text-slate-500">A quick check that the quote includes the big buckets before review.</p></div>
      <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
        {rows.map(([label, value]) => <Mini key={label} label={label} value={money(value)} />)}
      </div>
    </div>
  );
}

function AdditionalItems({ title, items, onChange }: { title: string; items: AdditionalItem[]; onChange: (items: AdditionalItem[]) => void }) {
  const activeItems = items.filter((item) => item.quantity || item.rate);
  const update = (index: number, next: Partial<AdditionalItem>) => onChange(items.map((item, i) => i === index ? { ...item, ...next } : item));
  return (
    <details className="app-card p-4" open>
      <summary className="cursor-pointer list-none">
        <h3 className="font-bold">{title}</h3>
        <div className="mt-1 text-sm text-slate-500">{activeItems.length ? `${activeItems.length} active item${activeItems.length === 1 ? "" : "s"}` : "No active items"} - choose a P&L category for every project-wide extra.</div>
      </summary>
      <div className="grid gap-3">
        {items.map((item, index) => (
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-6" key={index}>
            <Text label="Name" value={item.name} onChange={(v) => update(index, { name: v })} />
            <Select label="P&L Category" value={item.plCategory ?? "Equipment"} options={plCategories} onChange={(v) => update(index, { plCategory: v as PLCategory })} />
            <NumberInput label="Budget Cost" value={item.rate} onChange={(v) => update(index, { rate: v })} />
            <Text label="Unit" value={item.unit} onChange={(v) => update(index, { unit: v })} />
            <NumberInput label="Quantity" value={item.quantity} onChange={(v) => update(index, { quantity: v })} />
            <NumberInput label="Margin %" value={item.margin * 100} onChange={(v) => update(index, { margin: v / 100 })} />
          </div>
        ))}
      </div>
      <button className="secondary-button mt-3" onClick={() => onChange([...items, { name: "New item", rate: 0, unit: "item", quantity: 0, margin: 0.2, plCategory: "Equipment" }])}>Add Item</button>
    </details>
  );
}

function ProjectDetail({ project, tab, setTab, actuals, setActuals, saveActuals, note, setNote, addNote, edit, updateStatus }: { project: ProjectRecord; tab: DetailTab; setTab: (tab: DetailTab) => void; actuals: ReturnType<typeof defaultActuals>; setActuals: (a: ReturnType<typeof defaultActuals>) => void; saveActuals: () => void; note: string; setNote: (v: string) => void; addNote: () => void; edit: () => void; updateStatus: (status: ProjectStatus) => void }) {
  const auth = useAuth();
  const canEdit = hasPermission(auth.role, "projects.update");
  const summary = calculatePL(project.calculations, actuals);
  useEffect(() => {
    if (!tabIsAllowed(tab, project.inputs)) setTab("Summary");
  // Project ID and active tab are sufficient; inputs are immutable in this view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, tab]);
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div><h2 className="text-2xl font-bold">{project.inputs.projectReference} - {project.inputs.client}</h2><div className="mt-1 text-sm text-slate-500">{project.inputs.location} / {project.calculations.serviceSummary} / {project.inputs.quoteCurrency}</div></div>
        <div className="flex flex-wrap gap-2"><Select label="" value={project.status} options={["Draft", "Quoted", "Won", "Lost", "Completed", "Closed"]} disabled={!canEdit} onChange={(value) => updateStatus(value as ProjectStatus)} /><button className="secondary-button" onClick={edit} disabled={!canEdit}>Edit Quote</button></div>
      </div>
      <DetailTabs tab={tab} setTab={setTab} input={project.inputs} />
      {tab === "Summary" && <SavedProjectSummary project={project} />}
      {tab === "Costing" && <SavedCosting project={project} />}
      {tab === "Commercial Review" && <SavedCommercialReview project={project} />}
      {tab === "Client Proposal" && <ClientProposal project={project} />}
      {tab === "Actual P&L" && <PLActualsPanel project={project} actuals={actuals} setActuals={setActuals} summary={summary} saveActuals={saveActuals} />}
      {tab === "Activity" && <ActivityPanel project={project} note={note} setNote={setNote} addNote={addNote} />}
    </div>
  );
}

function SavedProjectSummary({ project }: { project: ProjectRecord }) {
  const calculations = project.calculations;
  return <div className="grid gap-5">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Proposal" value={money(calculations.proposalTotal)} /><Metric label="Budget" value={money(calculations.budgetCost)} /><Metric label="Markup" value={percent(calculations.budgetMarkup ?? 0)} /><Metric label="Project Days" value={String(calculations.siteDays)} /></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="app-card p-5"><h3 className="font-bold text-slate-950">Project</h3><div className="mt-3 grid gap-2 text-sm"><div><b>Reference:</b> {project.inputs.projectReference}</div><div><b>Client:</b> {project.inputs.client}</div><div><b>Location:</b> {project.inputs.location}</div><div><b>Services:</b> {calculations.serviceSummary}</div><div><b>Status:</b> {project.status} / {project.accountsStatus}</div><div><b>Calculation:</b> {project.calculationVersion ?? "Legacy snapshot"}</div></div></div>
      <div className="app-card p-5"><h3 className="font-bold text-slate-950">Phase programme</h3><div className="mt-3 grid gap-2">{calculations.phaseRows?.map((row) => <div key={row.service} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><b>{row.service}</b><span>Day {row.startDay} to {row.endDay}{row.concurrent ? " / concurrent" : ""}</span></div>)}{!calculations.phaseRows?.length && <div className="text-sm text-slate-500">No phase schedule was saved on this legacy quote.</div>}</div></div>
    </div>
  </div>;
}

function downloadProjectCsv(project: ProjectRecord) {
  const blob = new Blob([projectCsv(project)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${project.inputs.projectReference || "project"}-internal-costing.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function SavedCosting({ project }: { project: ProjectRecord }) {
  const calculations = project.calculations;
  const categoryRows = plCategories.map((category) => ({ category, budget: calculations.budgetLines.filter((line) => linePLCategory(line) === category).reduce((sum, line) => sum + line.total, 0) })).filter((row) => row.budget);
  return <div className="grid gap-5"><div className="app-card-strong"><div className="panel-heading flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Budget Costing</h2><p className="text-sm text-slate-500">Read-only budget snapshot used when this quote was saved.</p></div><button className="secondary-button" onClick={() => downloadProjectCsv(project)}>Export internal CSV</button></div><div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">{categoryRows.map((row) => <Mini key={row.category} label={row.category} value={money(row.budget)} />)}</div></div><LineTable lines={calculations.budgetLines} /></div>;
}

function SavedCommercialReview({ project }: { project: ProjectRecord }) {
  const calculations = project.calculations;
  const rows = plCategories.map((category) => {
    const proposal = calculations.proposalLines.filter((line) => linePLCategory(line) === category).reduce((sum, line) => sum + line.total, 0);
    const budget = calculations.budgetLines.filter((line) => linePLCategory(line) === category).reduce((sum, line) => sum + line.total, 0);
    const profit = proposal - budget;
    return { category, proposal, budget, profit, markup: budget ? profit / budget * 100 : 0 };
  }).filter((row) => row.proposal || row.budget);
  return <div className="grid gap-5"><div className={`rounded-xl border p-4 ${calculations.budgetMarkup < 25 ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}><b>{calculations.budgetMarkup < 25 ? `Approved below threshold: ${percent(calculations.budgetMarkup)}` : `Commercial check passed: ${percent(calculations.budgetMarkup)} markup`}</b>{calculations.budgetMarkup < 25 && <div className="mt-2 text-sm">Reason: {project.inputs.markupOverrideReason || "No approval reason recorded"}<br />Approved by: {project.markupApprovedBy || "Not recorded"}</div>}</div><div className="table-shell"><table><thead><tr><th>Category</th><th>Budget</th><th>Proposal</th><th>Profit</th><th>Markup</th></tr></thead><tbody>{rows.map((row) => <tr key={row.category}><td className="font-bold">{row.category}</td><td>{money(row.budget)}</td><td>{money(row.proposal)}</td><td>{money(row.profit)}</td><td className={row.markup < 25 ? "font-bold text-red-700" : "font-bold text-emerald-700"}>{percent(row.markup)}</td></tr>)}</tbody></table></div></div>;
}

function proposalGroup(line: Line) {
  const source = `${line.source} ${line.item}`.toLowerCase();
  if (source.includes("grind")) return "Grinding";
  if (source.includes("screed")) return "Screeding";
  if (source.includes("repair") || source.includes("joint")) return "Repairs";
  if (source.includes("project manager") || source.includes("whole-project management")) return "Project Management";
  if (line.section === "Additional items") return "Additional Items";
  if (["Travel", "Hotel", "Subsistence"].includes(line.section)) return "Travel & Accommodation";
  return line.section;
}

function ClientProposal({ project }: { project: ProjectRecord }) {
  const [showDetail, setShowDetail] = useState(false);
  const active = project.calculations.proposalLines.filter((line) => line.total);
  const groups = Array.from(active.reduce((map, line) => map.set(proposalGroup(line), (map.get(proposalGroup(line)) ?? 0) + line.total), new Map<string, number>()).entries());
  return <div className="grid gap-5"><div className="app-card-strong"><div className="panel-heading flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Client Proposal</h2><p className="text-sm text-slate-500">Client-facing service summary. Budget costs and internal margins are excluded.</p></div><button className="secondary-button" onClick={() => window.print()}>Print / Save PDF</button></div><div className="p-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{groups.map(([group, total]) => <div className="rounded-xl border border-slate-200 bg-white p-4" key={group}><div className="text-sm font-bold text-slate-700">{group}</div><div className="mt-2 text-xl font-bold text-slate-950">{money(total)}</div></div>)}</div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5"><div><div className="text-sm font-bold uppercase text-slate-500">Proposal Total</div><div className="mt-1 text-3xl font-bold text-slate-950">{money(project.calculations.proposalTotal)}</div></div><button className="secondary-button" onClick={() => setShowDetail((value) => !value)}>{showDetail ? "Hide detail appendix" : "Show detail appendix"}</button></div></div></div>{showDetail && <div className="table-shell"><table><thead><tr><th>Service</th><th>Description</th><th>Quantity</th><th>Unit</th><th>Total</th></tr></thead><tbody>{active.map((line, index) => <tr key={`${line.item}-${index}`}><td>{proposalGroup(line)}</td><td className="font-semibold">{line.item}</td><td>{line.quantity}</td><td>{line.unit}</td><td className="font-bold">{money(line.total)}</td></tr>)}</tbody></table></div>}</div>;
}

function ActivityPanel({ project, note, setNote, addNote }: { project: ProjectRecord; note: string; setNote: (value: string) => void; addNote: () => void }) {
  return <div className="grid gap-5 lg:grid-cols-2"><div className="app-card p-5"><h3 className="font-bold">Notes</h3><textarea className="input mt-3 min-h-28 w-full" value={note} onChange={(event) => setNote(event.target.value)} /><button className="primary-button mt-3" onClick={addNote}>Add Note</button>{project.notes?.map((item) => <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm" key={item.id}><b>{item.author}</b><div className="mt-1">{item.text}</div></div>)}</div><div className="grid gap-5"><div className="app-card p-5"><h3 className="font-bold">Revisions</h3>{project.revisions?.map((revision) => <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm" key={revision.id}><b>{revision.label}</b><div>{money(revision.proposalTotal)} proposal / {money(revision.budgetCost)} budget</div></div>)}</div><div className="app-card p-5"><h3 className="font-bold">Change Log</h3>{project.changeLog?.map((entry) => <div className="mt-3 text-sm" key={entry.id}><History size={14} className="mr-2 inline" />{formatDateTime(entry.createdAt)} - <b>{entry.action}</b>: {entry.detail}</div>)}</div></div></div>;
}

function PLActualsPanel({ project, actuals, setActuals, summary, saveActuals }: { project: ProjectRecord; actuals: ReturnType<typeof defaultActuals>; setActuals: (a: ReturnType<typeof defaultActuals>) => void; summary: ReturnType<typeof calculatePL>; saveActuals: () => void }) {
  const auth = useAuth();
  const canEditActuals = hasPermission(auth.role, "pl.update");
  const calculatedWorkingDays = calculateWorkingDays(actuals.startDate, actuals.endDate, actuals.saturdayWorked, actuals.sundayWorked);
  const calculatedSiteDays = calculateActualSiteDays(actuals);
  const inputSiteDays = actuals.daysTakenToComplete || calculatedSiteDays;
  const patch = (next: Partial<typeof actuals>) => setActuals({ ...actuals, ...next });
  const setDatePatch = (next: Partial<typeof actuals>) => {
    const merged = { ...actuals, ...next };
    const siteDays = calculateActualSiteDays(merged);
    const previousCalculatedDays = calculateActualSiteDays(actuals);
    const wasUsingCalculatedDays = !actuals.daysTakenToComplete || actuals.daysTakenToComplete === previousCalculatedDays;
    setActuals({ ...merged, daysTakenToComplete: wasUsingCalculatedDays ? siteDays : actuals.daysTakenToComplete });
  };
  const actualRows: Array<{ key?: keyof typeof actuals; label: string; actual: number; budget: number; variance: number; readonly?: boolean; helper?: string; onChange?: (value: number) => void }> = summary.rows.map((row) => {
    if (row.item === "Survey Days") return { label: row.item, actual: row.actual, budget: row.budget, variance: row.variance, helper: `${actuals.surveyDays || actuals.labourInternalDays} days x ${money(actuals.surveyDayRate || actuals.labourInternalRate)}`, onChange: undefined };
    if (row.item === "Survey Travel Days") return { label: row.item, actual: row.actual, budget: row.budget, variance: row.variance, helper: `${actuals.surveyTravelDays} days x ${money(actuals.surveyTravelRate)}`, onChange: undefined };
    if (row.item === "BDM Bonus") return { label: row.item, actual: row.actual, budget: row.budget, variance: row.variance, readonly: true, helper: project.inputs.bdmBonusRequired ? "Auto-calculated at 1% of actual price because the quote opted in." : "Not selected on this quote." };
    const key = plRowActualKey(row.item);
    return { key, label: row.item, actual: row.actual, budget: row.budget, variance: row.variance, onChange: key ? (value) => patch({ [key]: value } as Partial<typeof actuals>) : undefined };
  });
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_420px]">
        <div className={`app-card-strong ${canEditActuals ? "" : "pointer-events-none opacity-70"}`}>
          <div className="panel-heading">
            <h2 className="text-xl font-semibold">P&L Actuals</h2>
            <p className="text-sm text-slate-500">Accounts enter actual costs here. Budget values are read-only and come from the saved project budget.</p>
          </div>
          <div className="grid gap-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Actual Price" value={actuals.actualPrice} onChange={(v) => patch({ actualPrice: v })} />
              <DateInput label="Start Date" value={actuals.startDate} onChange={(v) => setDatePatch({ startDate: v })} />
              <DateInput label="End Date" value={actuals.endDate} onChange={(v) => setDatePatch({ endDate: v })} />
              <Text label="Dates Required / Notes" value={actuals.datesRequired} onChange={(v) => patch({ datesRequired: v })} />
              <Toggle label="Saturday Worked" checked={actuals.saturdayWorked} onChange={(v) => setDatePatch({ saturdayWorked: v })} />
              <Toggle label="Sunday Worked" checked={actuals.sundayWorked} onChange={(v) => setDatePatch({ sundayWorked: v })} />
              <NumberInput label="Travel Days" value={actuals.travelDays} onChange={(v) => setDatePatch({ travelDays: v })} />
              <div className={inputSiteDays !== calculatedSiteDays ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Site Days Inputted" value={inputSiteDays} onChange={(v) => patch({ daysTakenToComplete: v })} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Working Days" value={`${calculatedWorkingDays}`} />
              <Mini label="Calculated Site Days" value={`${calculatedSiteDays}`} />
              <Mini label="Budget Site Days" value={`${project.calculations.siteDays}`} />
              <Mini label="Programme Status" value={summary.programmeStatus.replace("PROJECT ", "")} />
            </div>
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Survey Days" value={actuals.surveyDays || actuals.labourInternalDays} onChange={(v) => patch({ surveyDays: v, labourInternalDays: v })} />
              <NumberInput label="Survey Day Rate" value={actuals.surveyDayRate || actuals.labourInternalRate} onChange={(v) => patch({ surveyDayRate: v, labourInternalRate: v })} />
              <NumberInput label="Survey Travel Days" value={actuals.surveyTravelDays} onChange={(v) => patch({ surveyTravelDays: v })} />
              <NumberInput label="Survey Travel Rate" value={actuals.surveyTravelRate} onChange={(v) => patch({ surveyTravelRate: v })} />
            </div>
            <div className="table-shell border border-slate-200">
              <table>
                <thead><tr><th>Actual Cost Row</th><th>Actual</th><th>Budget</th><th>Variance</th></tr></thead>
                <tbody>
                  {actualRows.map((row) => (
                    <tr key={row.label}>
                      <td className="min-w-[210px] font-semibold text-slate-950">{row.label}{row.helper && <div className="text-xs font-normal text-slate-500">{row.helper}</div>}</td>
                      <td className="min-w-44">{row.readonly ? <span className="font-bold text-slate-700">{money(row.actual)}</span> : row.onChange ? <NumberInput label="" value={Number(row.key ? actuals[row.key] : row.actual)} onChange={row.onChange} /> : <span className="font-bold text-slate-700">{money(row.actual)}</span>}</td>
                      <td className="font-bold text-slate-700">{money(row.budget)}</td>
                      <td className={`font-bold ${varianceTone(row.variance)}`}>{money(row.variance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="primary-button justify-self-start" onClick={saveActuals} disabled={!canEditActuals}><Save size={16} /> Save P&L Actuals</button>
          </div>
        </div>
        <div className="grid content-start gap-4">
          <div className="app-card-strong">
            <div className="panel-heading"><h2 className="text-xl font-semibold">P&L Summary</h2><p className="text-sm text-slate-500">Live from actuals typed on the left.</p></div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <Mini label="Actual Cost" value={money(summary.actualCost)} />
              <Mini label="Actual Profit" value={money(summary.actualProfit)} />
              <Mini label="Actual Margin" value={percent(summary.actualMargin)} />
              <Mini label="Actual Markup" value={percent(summary.actualMarkup)} />
              <Mini label="Budget Cost" value={money(project.calculations.budgetCost)} />
              <Mini label="Budget Profit" value={money(summary.budgetProfit)} />
              <Mini label="Budget Margin" value={percent(summary.budgetMargin)} />
              <Mini label="Budget Markup" value={percent(summary.budgetMarkup)} />
            </div>
          </div>
          <div className="app-card-strong">
            <div className="panel-heading"><h2 className="text-xl font-semibold">Budget Read-Only</h2><p className="text-sm text-slate-500">Snapshot from the project budget. Editing actuals will not change this.</p></div>
            <div className="p-5">
              <div className="table-shell border border-slate-200">
                <table>
                  <thead><tr><th>Row</th><th>Budget</th></tr></thead>
                  <tbody>{summary.rows.map((row) => <tr key={row.item}><td>{row.item}</td><td className="font-bold">{money(row.budget)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Accounts status: <b className="text-slate-950">{project.accountsStatus}</b>. Saving this page marks the project as <b>Actuals Saved</b> and keeps the actuals on this project ID.
          </div>
        </div>
      </div>
    </div>
  );
}

function plRowActualKey(item: string): keyof ReturnType<typeof defaultActuals> | undefined {
  const map: Record<string, keyof ReturnType<typeof defaultActuals>> = {
    "Labour Internal": "labourInternal",
    "Labour Subcontract": "labourSubcontract",
    "Equipment Rental": "equipmentRental",
    Haulage: "haulage",
    Materials: "materials",
    "Engineering Report": "engineeringReport",
    Travel: "travel",
    Hotel: "hotel",
    Subsistence: "subsistence",
    Other: "other"
  };
  return map[item];
}

function varianceTone(value: number) {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-red-700";
  return "text-amber-600";
}

function Overview({ calculations, rates }: { calculations: ReturnType<typeof calculateProject>; rates: AdminRates }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Services" value={calculations.serviceSummary} /><Metric label="Original Proposal" value={money(calculations.originalProposalTotal)} /><Metric label="Discount" value={money(calculations.discountAmount)} /><Metric label="Proposal Total" value={money(calculations.proposalTotal)} /><Metric label="Budget Cost" value={money(calculations.budgetCost)} /><Metric label="Budget Margin" value={percent(calculations.budgetMargin)} /><Metric label="Daily Rate" value={money(calculations.dailyRate)} /><Metric label="Standby Rate" value={money(calculations.standbyRate || rates.hotel + rates.subsistence)} /></div>;
}

function LineTable({ lines }: { lines: Line[] }) {
  return <div className="table-shell"><table><thead><tr><th>Section</th><th>Item</th><th>Rate</th><th>Qty</th><th>Cost</th><th>Margin</th><th>Discount</th><th>Total</th></tr></thead><tbody>{lines.filter((l) => l.quantity || l.total).map((line, index) => <tr key={`${line.item}-${index}`}><td>{line.section}</td><td className="min-w-[220px] font-semibold">{line.item}<div className="text-xs font-normal text-slate-500">{line.source}</div></td><td>{money(line.rate)} / {line.unit}</td><td>{line.quantity}</td><td>{money(line.cost)}</td><td>{money(line.margin)}</td><td>{money(line.discount)}</td><td className="font-bold">{money(line.total)}</td></tr>)}</tbody></table></div>;
}

function SearchView({ projects, open, edit }: { projects: ProjectRecord[]; open: (project: ProjectRecord) => void; edit: (project: ProjectRecord) => void }) {
  const [q, setQ] = useState("");
  const filtered = projects.filter((p) => `${p.inputs.projectReference} ${p.inputs.client} ${p.inputs.location} ${p.calculations.serviceSummary}`.toLowerCase().includes(q.toLowerCase()));
  return <div className="app-card-strong"><div className="panel-heading"><h2 className="text-xl font-semibold"><Search className="mr-2 inline" />Project Search</h2><input className="mt-3 max-w-lg" placeholder="Search reference, client, location or service" value={q} onChange={(e) => setQ(e.target.value)} /></div><ProjectTable projects={filtered} open={open} edit={edit} /></div>;
}

function ProjectTable({ projects, open, edit }: { projects: ProjectRecord[]; open: (project: ProjectRecord) => void; edit?: (project: ProjectRecord) => void }) {
  return <div className="table-shell border-0"><table><thead><tr><th>Project</th><th>Services</th><th>Status</th><th>Proposal</th><th>Budget</th><th>Markup</th><th>Actions</th></tr></thead><tbody>{projects.map((p) => <tr key={p.id}><td><b>{p.inputs.projectReference || "Draft"}</b><div className="text-xs text-slate-500">{p.inputs.client} - {p.inputs.location}</div></td><td>{p.calculations.serviceSummary}</td><td>{p.status} / {p.accountsStatus}</td><td>{money(p.calculations.proposalTotal, p.inputs.quoteCurrency)}</td><td>{money(p.calculations.budgetCost, p.inputs.quoteCurrency)}</td><td>{percent(p.calculations.budgetMarkup ?? (p.calculations.budgetCost ? p.calculations.budgetProfit / p.calculations.budgetCost * 100 : 0))}</td><td><button className="secondary-button mr-2" onClick={() => open(p)}>Open</button>{edit && <button className="secondary-button" onClick={() => edit(p)}>Edit</button>}</td></tr>)}</tbody></table></div>;
}

function AdminRatesView({ rates, setRates, repairCatalog, setRepairCatalog, initialAdminTab, save }: { rates: AdminRates; setRates: (rates: AdminRates) => void; repairCatalog: RepairCatalog; setRepairCatalog: (catalog: RepairCatalog) => void; initialAdminTab: "Rates" | "Repair Types" | "Repair Materials"; save: () => void }) {
  const [adminTab, setAdminTab] = useState<"Rates" | "Repair Types" | "Repair Materials">(initialAdminTab);
  const [pendingRule, setPendingRule] = useState<Record<string, string>>({});
  const [adminSearch, setAdminSearch] = useState("");
  const search = adminSearch.trim().toLowerCase();
  const filteredRepairTypes = repairCatalog.types.filter((type) => `${type.code} ${type.name} ${type.description}`.toLowerCase().includes(search));
  const filteredMaterials = repairCatalog.materials.filter((material) => `${material.name} ${material.category} ${material.unitType} ${material.measuredUnitType} ${material.calcMethod} ${material.notes}`.toLowerCase().includes(search));
  useEffect(() => setAdminTab(initialAdminTab), [initialAdminTab]);
  const updateMaterial = (id: string, next: Partial<RepairMaterial>) => setRepairCatalog({ ...repairCatalog, materials: repairCatalog.materials.map((material) => material.id === id ? { ...material, ...next } : material) });
  const updateType = (code: string, next: Partial<RepairType>) => setRepairCatalog({ ...repairCatalog, types: repairCatalog.types.map((type) => type.code === code ? { ...type, ...next } : type) });
  const addMaterial = () => {
    const id = `material-${Date.now()}`;
    setRepairCatalog({ ...repairCatalog, materials: [...repairCatalog.materials, { id, name: "New repair material", category: "Other", unitType: "kg", unitSize: 0, costPerUnit: 0, calcMethod: "volume_lwd", measuredUnitType: "litres", coveragePerUnit: 0, wasteFactor: 1.1, sourceNote: "Admin", active: true, notes: "Fill out in full before using" }] });
    setAdminTab("Repair Materials");
  };
  const duplicateMaterial = (material: RepairMaterial) => {
    const id = `material-${Date.now()}`;
    setRepairCatalog({ ...repairCatalog, materials: [...repairCatalog.materials, { ...material, id, name: `${material.name} copy`, active: true }] });
  };
  const addRepairType = () => {
    const code = `New Type ${repairCatalog.types.length + 1}`;
    setRepairCatalog({ ...repairCatalog, types: [...repairCatalog.types, { code, name: "New repair type", measurementBasis: "linear", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 0, defaultOutputPerDay: 1, description: "", materialRules: [], active: true }] });
    setAdminTab("Repair Types");
  };
  const duplicateRepairType = (type: RepairType) => {
    const code = `${type.code} copy`;
    setRepairCatalog({ ...repairCatalog, types: [...repairCatalog.types, { ...type, code, name: `${type.name} copy`, active: true }] });
  };
  const setMaterialRule = (typeCode: string, materialId: string, role: "required" | "optional" | "none") => {
    const type = repairCatalog.types.find((item) => item.code === typeCode);
    if (!type) return;
    const without = type.materialRules.filter((rule) => rule.materialId !== materialId);
    const materialRules = role === "none" ? without : [...without, { materialId, role, defaultSelected: role === "required" }];
    updateType(typeCode, { materialRules });
  };
  const setRuleDefault = (typeCode: string, materialId: string, defaultSelected: boolean) => {
    const type = repairCatalog.types.find((item) => item.code === typeCode);
    if (!type) return;
    updateType(typeCode, { materialRules: type.materialRules.map((rule) => rule.materialId === materialId ? { ...rule, defaultSelected } : rule) });
  };
  const addMaterialRule = (type: RepairType, role: "required" | "optional") => {
    const key = `${type.code}-${role}`;
    const selectedId = pendingRule[key] || repairCatalog.materials.find((material) => !type.materialRules.some((rule) => rule.materialId === material.id))?.id || "";
    if (!selectedId) return;
    setMaterialRule(type.code, selectedId, role);
    setPendingRule({ ...pendingRule, [key]: "" });
  };
  const formulaHelp = (method: RepairMaterial["calcMethod"]) => method === "volume_lwd" ? "Volume: length x width x depth, add waste, divide by coverage per unit, round up" : method === "area_thickness" ? "Area/thickness: calculate requirement, add waste, divide by coverage per unit, round up" : method === "linear" ? "Linear: length, add waste, divide by coverage per unit, round up" : method === "each" ? "Each: quantity, add waste, divide by coverage per unit, round up" : "Manual: manual requirement, add waste, divide by coverage per unit, round up";
  const repairTypeStatus = (type: RepairType) => {
    if (!type.active) return { label: "Inactive", tone: "bg-slate-200 text-slate-700" };
    if (!type.materialRules.length) return { label: "Needs material", tone: "bg-amber-100 text-amber-900" };
    if (type.materialRules.some((rule) => (repairCatalog.materials.find((material) => material.id === rule.materialId)?.costPerUnit ?? 0) <= 0)) return { label: "Has placeholder costs", tone: "bg-amber-100 text-amber-900" };
    return { label: "Ready", tone: "bg-emerald-100 text-emerald-900" };
  };
  const missingMaterialSetup = repairCatalog.materials.filter((material) => material.active && (material.costPerUnit <= 0 || material.unitSize <= 0 || material.coveragePerUnit <= 0));
  const unusedMaterials = repairCatalog.materials.filter((material) => !repairCatalog.types.some((type) => type.materialRules.some((rule) => rule.materialId === material.id)));
  const updateRate = (key: RateValueKey, value: number) => setRates({ ...rates, [key]: value });
  const updateMarginRate = (key: RateValueKey, value: number) => updateRate(key, value / 100);
  const updateItemMargin = (key: RateValueKey, value: number) => setRates({ ...rates, rateMargins: { ...(rates.rateMargins ?? {}), [key]: value / 100 } });
  const resetRates = () => {
    if (window.confirm("Reset all admin rates back to the original defaults? Repair types and materials will not be changed.")) setRates(defaultRates);
  };
  return (
    <div className="grid gap-5">
      <div className="app-card-strong">
        <div className="panel-heading flex flex-wrap justify-between gap-3">
          <div><h2 className="text-xl font-semibold"><Settings className="mr-2 inline" />Admin</h2><p className="text-sm text-slate-500">Rates plus the repair type/material database. Margins are entered as percentages.</p></div>
          <button className="primary-button" onClick={save}>Save Admin Data</button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-white p-3">
          {(["Rates", "Repair Types", "Repair Materials"] as const).map((tab) => {
            const href = tab === "Rates" ? "/admin-rates" : tab === "Repair Types" ? "/admin-rates/repair-types" : "/admin-rates/repair-materials";
            return <Link key={tab} href={href} className={adminTab === tab ? "primary-button" : "secondary-button"} onClick={() => setAdminTab(tab)}>{tab}</Link>;
          })}
        </div>
        {adminTab === "Rates" && (
          <div className="grid gap-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-sky-100 bg-sky-50 p-4">
              <div className="min-w-0">
                <div className="text-sm font-bold text-sky-950">Admin Rate Control</div>
                <p className="mt-1 max-w-3xl text-sm text-sky-900">Update base rates used by new quotes. Saved project calculations keep their existing values unless the quote is edited and saved again.</p>
              </div>
              <button className="secondary-button" onClick={resetRates}>Reset to Defaults</button>
            </div>
            <RateSection
              title="Production Labour"
              description="Shared worker rates for grinding, screeding and in-house repair labour. These are separate from surveyor costs."
              badges={["Grinding", "Screeding", "Repairs"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "productionLabourDayRate", label: "Production Labour Day Rate", suffix: "/ man day" },
                { key: "productionLabourTravelDayRate", label: "Production Labour Travel Day Rate", suffix: "/ man day" },
                { key: "productionWeekendDayRate", label: "Weekend Extra / Man / Day", suffix: "/ man day" },
                { key: "productionNightShiftAllowance", label: "Night Shift Extra / Man / Night", suffix: "/ man night" }
              ]}
            />
            <RateSection
              title="Surveyor Labour"
              description="Surveyor rates are kept separate from production workers."
              badges={["Surveyor", "Labour"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "surveyorDayRate", label: "Surveyor Day Rate", suffix: "/ day" },
                { key: "surveyorTravelDayRate", label: "Surveyor Travel Day Rate", suffix: "/ day" }
              ]}
            />
            <RateSection
              title="Project Management"
              description="Whole-project management used once across grinding, screeding and repairs. It is not duplicated by service."
              badges={["Shared", "Project"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "projectManagerDayRate", label: "Project Manager Day Rate", suffix: "/ day" }
              ]}
            />
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="max-w-sm"><NumberInput label="Optional BDM Bonus %" value={rates.bdmBonusRate * 100} onChange={(value) => updateRate("bdmBonusRate", value / 100)} /></div>
              <p className="mt-2 text-sm text-slate-500">Applied to budget cost only when the quote explicitly selects the BDM bonus option.</p>
            </div>
            <RateSection
              title="Travel, Hotel & Subsistence"
              description="Shared movement, accommodation and daily allowance rates for workers and surveyors. Distance rates are in kilometres."
              badges={["Shared", "Travel"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "mileagePerKm", label: "Mileage / km", suffix: "/ km" },
                { key: "returnFlight", label: "Return Flight", suffix: "/ flight" },
                { key: "airportUberReturn", label: "Airport Uber Return", suffix: "/ return" },
                { key: "airportParkingPerDay", label: "Airport Parking", suffix: "/ day" },
                { key: "hotel", label: "Hotel", suffix: "/ night" },
                { key: "subsistence", label: "Subsistence", suffix: "/ day" },
                { key: "companyCar", label: "Company Car", suffix: "/ day" },
                { key: "travelMargin", label: "Travel Default Margin", margin: true, helper: "Used for project-entered travel costs that do not have their own rate row." },
                { key: "flightMargin", label: "Flight Default Margin", margin: true, helper: "Used for project-entered flight costs that do not have their own rate row." },
                { key: "hotelMargin", label: "Hotel Default Margin", margin: true, helper: "Fallback only. The hotel row above has its own item margin." },
                { key: "subsistenceMargin", label: "Subsistence Default Margin", margin: true, helper: "Fallback only. The subsistence row above has its own item margin." }
              ]}
            />
            <RateSection
              title="Subcontract, Materials & Equipment"
              description="Default margins for project-entered costs plus general report/equipment rates."
              badges={["All", "Margin"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "subcontractMargin", label: "Subcontract Default Margin", margin: true, helper: "Used when subcontract costs are entered inside a quote." },
                { key: "materialMargin", label: "Material Default Margin", margin: true, helper: "Used for repair materials and project-entered materials." },
                { key: "equipmentMargin", label: "Equipment Default Margin", margin: true, helper: "Used when equipment costs are entered inside a quote." },
                { key: "engineeringReport", label: "Engineering Report", suffix: "/ report" }
              ]}
            />
            <RateSection
              title="Grinding Equipment & Consumables"
              description="Default grinding equipment and consumable items used by the grinding costing sheet."
              badges={["Grinding", "Equipment"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "grindingSmallGeneratorDayRate", label: "10000 Watt Generator", suffix: "/ day" },
                { key: "grindingGrinderDayRate", label: "Grinders", suffix: "/ grinder day" },
                { key: "grindingPlanerDayRate", label: "Planers", suffix: "/ planer day" },
                { key: "grindingDustVacuumDayRate", label: "Vacuums", suffix: "/ vacuum day" },
                { key: "grindingExtensionCordsDayRate", label: "Extension Cords", suffix: "/ day" },
                { key: "grindingSegmentsDayRate", label: "Grinding Segments", suffix: "/ grinder day" },
                { key: "grindingConsumablesDayRate", label: "Grinding Consumables", suffix: "/ grinder day" }
              ]}
            />
            <RateSection
              title="Screeding Equipment & Consumables"
              description="Default screeding equipment and consumable items used only when screeding production includes in-house labour."
              badges={["Screeding", "Equipment"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "screedSmallGeneratorDayRate", label: "Screed Generator", suffix: "/ day" },
                { key: "screedDiamondGrinderPropaneDayRate", label: "Screed Grinders", suffix: "/ grinder day" },
                { key: "screedGasPlanerDayRate", label: "Screed Planers", suffix: "/ planer day" },
                { key: "screedDustVacuumDayRate", label: "Screed Vacuums", suffix: "/ vacuum day" },
                { key: "screedExtensionCordSetDayRate", label: "Screed Extension Cord Sets", suffix: "/ set day" },
                { key: "screedGrindingSegmentsDayRate", label: "Screed Grinding Segments", suffix: "/ grinder day" },
                { key: "screedConsumablesDayRate", label: "Screed Consumables", suffix: "/ grinder day" }
              ]}
            />
            <RateSection
              title="Repair Travel & Fuel"
              description="Repair labour now uses the shared production labour and shared hotel/subsistence rates above. Keep repair-specific fuel here."
              badges={["Repairs", "Travel"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "repairFuelPerKm", label: "Repair Fuel / km", suffix: "/ km" }
              ]}
            />
          </div>
        )}
        {adminTab === "Repair Types" && (
          <div className="grid gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-600">Edit the booklet code, repair name, measurement defaults, output rate, and the material rules used by the repair calculator.</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold uppercase">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{repairCatalog.types.length} repair types</span>
                  <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-900">{repairCatalog.types.filter((type) => type.active).length} active</span>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">{repairCatalog.types.filter((type) => !type.materialRules.length).length} need material</span>
                </div>
              </div>
              <button className="secondary-button" onClick={addRepairType}>Add Repair Type</button>
            </div>
            <input placeholder="Search repair type, code or description" value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} />
            {filteredRepairTypes.map((type) => (
              <details className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={type.code}>
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold uppercase text-sky-700">{type.code}</span>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${repairTypeStatus(type).tone}`}>{repairTypeStatus(type).label}</span>
                      </div>
                      <div className="mt-1 text-lg font-bold text-slate-950">{type.name}</div>
                      <div className="mt-1 text-sm text-slate-500">{type.measurementBasis} / {type.defaultOutputPerDay} per day / {type.materialRules.length} material rule{type.materialRules.length === 1 ? "" : "s"}</div>
                    </div>
                    <button className="secondary-button" onClick={(event) => { event.preventDefault(); duplicateRepairType(type); }}>Duplicate</button>
                  </div>
                </summary>
                {!type.materialRules.length && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">Add at least one required or optional material before using this repair type in a quote.</div>}
                <div className="grid gap-4 lg:grid-cols-4">
                  <Text label="Code" value={type.code} onChange={(v) => updateType(type.code, { code: v })} />
                  <Text label="Repair Name" value={type.name} onChange={(v) => updateType(type.code, { name: v })} />
                  <Select label="Measurement Basis" value={type.measurementBasis} options={["linear", "area", "each", "manual"]} onChange={(v) => updateType(type.code, { measurementBasis: v as RepairType["measurementBasis"] })} />
                  <NumberInput label="Output Per Day" value={type.defaultOutputPerDay} onChange={(v) => updateType(type.code, { defaultOutputPerDay: v })} />
                  <NumberInput label="Default Width mm" value={type.defaultWidthMm} onChange={(v) => updateType(type.code, { defaultWidthMm: v })} />
                  <NumberInput label="Default Depth mm" value={type.defaultDepthMm} onChange={(v) => updateType(type.code, { defaultDepthMm: v })} />
                  <NumberInput label="Default Thickness mm" value={type.defaultThicknessMm} onChange={(v) => updateType(type.code, { defaultThicknessMm: v })} />
                  <Toggle label="Active" checked={type.active} onChange={(v) => updateType(type.code, { active: v })} />
                </div>
                <div className="mt-4">
                  <Text label="Description" value={type.description} onChange={(v) => updateType(type.code, { description: v })} />
                </div>
                <div className="mt-4 rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold uppercase text-slate-500">Material Rules</div>
                    <button className="secondary-button" onClick={addMaterial}>Add Material</button>
                  </div>
                  <div className="grid gap-3">
                    {(["required", "optional"] as const).map((role) => {
                      const assignedRules = type.materialRules.filter((rule) => rule.role === role);
                      const assignedIds = new Set(type.materialRules.map((rule) => rule.materialId));
                      const availableMaterials = repairCatalog.materials.filter((material) => material.active && !assignedIds.has(material.id));
                      const selectKey = `${type.code}-${role}`;
                      const selectValue = pendingRule[selectKey] || availableMaterials[0]?.id || "";
                      return (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" key={`${type.code}-${role}`}>
                          <div className="mb-2 text-xs font-bold uppercase text-slate-500">{role === "required" ? "Required materials" : "Optional materials"}</div>
                          <div className="flex flex-wrap gap-2">
                            {assignedRules.length ? assignedRules.map((rule) => {
                              const material = repairCatalog.materials.find((item) => item.id === rule.materialId);
                              return material ? (
                                <span className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${role === "required" ? "bg-sky-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`} key={`${type.code}-${role}-${rule.materialId}`}>
                                  <span className="truncate">{material.name}</span>
                                  {rule.role === "optional" && <button className="rounded-full bg-black/10 px-1.5 py-0.5" onClick={() => setRuleDefault(type.code, rule.materialId, !rule.defaultSelected)}>{rule.defaultSelected ? "Default" : "Set default"}</button>}
                                  <button className="rounded-full bg-black/10 px-1.5 py-0.5" onClick={() => setMaterialRule(type.code, rule.materialId, "none")}>Remove</button>
                                </span>
                              ) : null;
                            }) : <span className="text-sm text-slate-500">No {role} materials assigned.</span>}
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                            <select value={selectValue} onChange={(event) => setPendingRule({ ...pendingRule, [selectKey]: event.target.value })} disabled={!availableMaterials.length}>
                              {availableMaterials.map((material) => <option key={material.id} value={material.id}>{material.category} - {material.name}</option>)}
                            </select>
                            <button className="secondary-button" onClick={() => addMaterialRule(type, role)} disabled={!availableMaterials.length}>Add {role === "required" ? "Required" : "Optional"}</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            ))}
            {!filteredRepairTypes.length && <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No repair types match that search.</div>}
          </div>
        )}
        {adminTab === "Repair Materials" && (
          <div className="grid gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-600">Edit purchase unit size, cost per unit, coverage and waste. New repair quotes use the latest costs; saved project calculations stay unchanged.</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold uppercase">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{repairCatalog.materials.length} materials</span>
                  <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-900">{repairCatalog.materials.filter((material) => material.active).length} active</span>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">{missingMaterialSetup.length} need setup</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{unusedMaterials.length} unused</span>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">{percent(rates.materialMargin)} material margin</span>
                </div>
              </div>
              <button className="secondary-button" onClick={addMaterial}>Add Material</button>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
                <div>
                  <div className="text-sm font-bold text-emerald-950">Repair material margin</div>
                  <p className="mt-1 text-sm text-emerald-900">Materials below are entered as cost per unit. New project repair costing sells them at cost plus this margin.</p>
                </div>
                <NumberInput label="Material Margin %" value={rates.materialMargin * 100} onChange={(v) => setRates({ ...rates, materialMargin: v / 100 })} />
              </div>
            </div>
            <input placeholder="Search material, method or notes" value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} />
            {filteredMaterials.map((material) => (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={material.id}>
                {(material.costPerUnit <= 0 || material.unitSize <= 0 || material.coveragePerUnit <= 0) && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">Needs setup. Add unit size, cost per unit and coverage before relying on it in a quote.</div>}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-bold text-slate-900">{material.name}</div>
                  <div className="flex flex-wrap gap-2">
                    <button className="secondary-button" onClick={() => duplicateMaterial(material)}>Duplicate</button>
                    <button className="secondary-button" onClick={() => updateMaterial(material.id, { active: !material.active })}>{material.active ? "Archive" : "Restore"}</button>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <Text label="Material Name" value={material.name} onChange={(v) => updateMaterial(material.id, { name: v })} />
                  <Select label="Category" value={material.category} options={materialCategories} onChange={(v) => updateMaterial(material.id, { category: v as RepairMaterialCategory })} />
                  <Select label="Unit Type" value={material.unitType} options={materialUnitTypes} onChange={(v) => updateMaterial(material.id, { unitType: v as RepairUnitType })} />
                  <NumberInput label="Unit Size" value={material.unitSize} onChange={(v) => updateMaterial(material.id, { unitSize: v })} />
                  <NumberInput label="Cost Per Unit" value={material.costPerUnit} onChange={(v) => updateMaterial(material.id, { costPerUnit: v })} />
                  <Toggle label="Active" checked={material.active} onChange={(v) => updateMaterial(material.id, { active: v })} />
                </div>
                <details className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                  <summary className="cursor-pointer list-none text-sm font-bold text-slate-800">Calculation setup</summary>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <Select label="Calc Method" value={material.calcMethod} options={["volume_lwd", "area_thickness", "linear", "each", "manual"]} onChange={(v) => updateMaterial(material.id, { calcMethod: v as RepairMaterial["calcMethod"] })} />
                    <Select label="Measured In" value={material.measuredUnitType} options={materialUnitTypes} onChange={(v) => updateMaterial(material.id, { measuredUnitType: v as RepairUnitType })} />
                    <NumberInput label="Covers Per Unit" value={material.coveragePerUnit} onChange={(v) => updateMaterial(material.id, { coveragePerUnit: v })} />
                    <NumberInput label="Waste Factor" value={material.wasteFactor} onChange={(v) => updateMaterial(material.id, { wasteFactor: v })} />
                    <NumberInput label="Density kg/L" value={material.densityKgPerL ?? 0} onChange={(v) => updateMaterial(material.id, { densityKgPerL: v || undefined })} />
                    <Text label="Source Note" value={material.sourceNote} onChange={(v) => updateMaterial(material.id, { sourceNote: v })} />
                    <Text label="Notes" value={material.notes} onChange={(v) => updateMaterial(material.id, { notes: v })} />
                  </div>
                </details>
                <div className="mt-3 flex flex-wrap gap-2">
                  <div className="rounded-lg bg-white px-3 py-2 text-xs font-bold uppercase text-slate-500 ring-1 ring-slate-200">{formulaHelp(material.calcMethod)}</div>
                  <div className="rounded-lg bg-white px-3 py-2 text-xs font-bold uppercase text-slate-600 ring-1 ring-slate-200">One unit: {material.unitSize} {material.unitType}, covers {material.coveragePerUnit} {material.measuredUnitType}</div>
                  <div className="rounded-lg bg-white px-3 py-2 text-xs font-bold uppercase text-emerald-700 ring-1 ring-emerald-200">Sell/unit at {percent(rates.materialMargin)} margin: {money(material.costPerUnit * (1 + rates.materialMargin))}</div>
                </div>
              </div>
            ))}
            {!filteredMaterials.length && <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No materials match that search.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

type RateValueKey = Exclude<keyof AdminRates, "rateMargins">;

type AdminRateField = {
  key: RateValueKey;
  label: string;
  suffix?: string;
  margin?: boolean;
  helper?: string;
};

function RateSection({ title, description, badges, fields, rates, onRateChange, onMarginChange, onItemMarginChange, compact = false }: { title: string; description: string; badges: string[]; fields: AdminRateField[]; rates: AdminRates; onRateChange: (key: RateValueKey, value: number) => void; onMarginChange: (key: RateValueKey, value: number) => void; onItemMarginChange: (key: RateValueKey, value: number) => void; compact?: boolean }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-950">{title}</h3>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold uppercase text-sky-900" key={badge}>{badge}</span>)}
          </div>
        </div>
      </div>
      <div className={`grid gap-4 p-4 ${compact ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"}`}>
        {fields.map((field) => {
          const rawValue = Number(rates[field.key]) || 0;
          const itemMargin = adminRateMargin(rates, field.key, 0);
          return (
            <div className="grid min-w-0 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3" key={field.key}>
              {field.margin ? (
                <>
                  <NumberInput label={field.label} value={rawValue * 100} onChange={(value) => onMarginChange(field.key, value)} />
                  <div className="flex min-h-5 flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-emerald-700">{rawValue * 100}% default margin</span>
                    {field.helper && <span>{field.helper}</span>}
                  </div>
                </>
              ) : (
                <>
                  <NumberInput label={`${field.label} - Budget Cost`} value={rawValue} onChange={(value) => onRateChange(field.key, value)} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <NumberInput label="Margin %" value={itemMargin * 100} onChange={(value) => onItemMarginChange(field.key, value)} />
                    <Mini label="Proposal Cost" value={money(rawValue * (1 + itemMargin))} />
                  </div>
                  <div className="flex min-h-5 flex-wrap items-center gap-2 text-xs text-slate-500">
                    {field.suffix && <span>{field.suffix}</span>}
                    {field.helper && <span>{field.helper}</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AuditPanel({ calculations }: { calculations: ReturnType<typeof calculateProject> }) {
  return <div className="app-card-strong"><div className="panel-heading"><h2 className="text-xl font-semibold"><FileSpreadsheet className="mr-2 inline" />Calculation Audit</h2><p className="text-sm text-slate-500">Workbook rows were unlocked/read with the supplied password and mapped into TypeScript calculations.</p></div><div className="grid gap-4 p-5 md:grid-cols-3"><Metric label="Grinding Days" value={String(calculations.grindingDays)} /><Metric label="Screed Days" value={String(calculations.screedDays)} /><Metric label="Repair Days" value={String(calculations.repairDays)} /></div><LineTable lines={calculations.repairMaterialCalcs.map((m) => ({ section: "Materials", item: m.product, rate: m.rate, unit: m.unit, quantity: m.quantity, cost: m.cost, margin: 0, total: m.cost, discount: 0, originalTotal: m.cost, source: m.formula })) as Line[]} /></div>;
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div className="grid min-w-0 gap-1"><label>{label}</label><input value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <div className="grid min-w-0 gap-1"><label>{label}</label><input type="number" min="0" step="any" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Math.max(0, Number(e.target.value)))} /></div>;
}

function Select({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  return <div className="grid min-w-0 gap-1"><label>{label}</label><select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o}>{o}</option>)}</select></div>;
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div className="grid min-w-0 gap-1"><label>{label}</label><input type="date" value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`flex min-h-11 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm font-bold leading-snug normal-case transition ${checked ? "border-sky-300 bg-sky-50 text-slate-950" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}>
      <span className="min-w-0 break-words">{label}</span>
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${checked ? "border-sky-700 bg-sky-700" : "border-slate-300 bg-white"}`}>
        <input type="checkbox" className="toggle-native" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {checked && <span className="h-2.5 w-1.5 rotate-45 border-b-2 border-r-2 border-white" />}
      </span>
    </label>
  );
}
