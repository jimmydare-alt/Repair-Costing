"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Calculator, Check, Download, FileSpreadsheet, History, Printer, Save, Search, Send, Settings, Trash2 } from "lucide-react";
import { calculatedHotelNights, calculateActualSiteDays, calculatePhaseSchedule, calculatePL, calculateProject, calculateProjectRepairMaterials, calculateRepairLineMaterials, calculateWorkingDays, defaultActuals, screedMaterialUnits, weekendDaysForProgramme } from "@/lib/calculations";
import { money, percent, formatDateTime, setMoneyCurrency } from "@/lib/format";
import { projectCsv } from "@/lib/export";
import { applyUsaWorkbookRates, createRemedialProjectInput, defaultRates, emptyInput } from "@/lib/rates";
import { createRepairLine, defaultRepairCatalog, repairTypeByCode, validateRepairCatalog } from "@/lib/repairCatalog";
import { addProjectNote, deleteProject, loadDeletedProjects, loadProjects, loadRates, loadRateVersions, loadRepairCatalog, purgeProject, recordProjectHandover, restoreProject, saveActuals, saveAdminData, saveProject, saveProjectPackageSelection, setStorageContext, updateProjectWorkflow } from "@/lib/storage";
import { useAuth } from "@/lib/authContext";
import { distanceUnitCopy, hasPermission } from "@/lib/company";
import { createBrowserSupabaseClient } from "@/lib/supabaseClient";
import { allowedStatusTransitions, normaliseProjectStatus, statusIsLocked } from "@/lib/workflow";
import { buildHandoverSummary } from "@/lib/handover";
import { adjacentBuilderStep, builderStepLabels, costingInputsEqual, parseEditRoute, resolveBuilderStep, visibleBuilderSteps, type BuilderStep } from "@/lib/builder";
import { ProductShell } from "@/components/AppShell";
import { SurveyBuilder } from "@/components/survey/SurveyBuilder";
import { SurveyRatesAdmin } from "@/components/survey/SurveyRatesAdmin";
import { CompanyAdminView as CompanyAdminPanel } from "@/components/company-admin/CompanyAdminView";
import { NumericField } from "@/components/ui/NumericField";
import { createEmptySurveyInput, normaliseSurveyRates } from "@/lib/costing/survey/defaults";
import { calculateSurveyProject } from "@/lib/costing/survey/calculations";
import { createSurveyProjectInput, syncSurveyProjectInput } from "@/lib/costing/survey/project";
import { chargeableJourneyDistance, effectiveReturnFlights } from "@/lib/travel";
import { reportAppError } from "@/lib/monitoring";
import { emptyDashboardFilters, filterDashboardProjects, type DashboardFilters } from "@/lib/dashboard";
import { createSelectablePackages, createWorkPackage, packageCode, packageProjectInput, updatePackageFromProjectInput } from "@/lib/workPackages";
import type { AppModuleKey, CurrencyCode, DistanceUnit, MembershipRole, Permission } from "@/lib/company";
import type { AdditionalItem, AdminRates, AirportTransport, DestinationTransport, DetailTab, LabourMode, Line, PLCategory, PriceType, ProjectInput, ProjectRecord, ProjectServiceKey, ProjectStatus, RateVersionRecord, RemedialWorkPackage, RepairCatalog, RepairLabourMode, RepairLineItem, RepairMaterial, RepairMaterialCategory, RepairSubcontractor, RepairType, RepairUnitType, ScreedTeam, TravelMode, View } from "@/lib/types";

const detailTabs: DetailTab[] = ["Summary", "Costing", "Commercial Review", "PM Handover", "Actual P&L", "Activity"];
type AdminTab = "Rates" | "Survey Rates" | "Repair Types" | "Repair Materials";
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

function scrollToCostingSection(anchor = "costing-builder-content") {
  window.requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function serviceFlags(input: ProjectInput) {
  if (input.pricingMode === "selectable") {
    return {
      grinding: input.workPackages.some((item) => item.service === "Grinding"),
      screeding: input.workPackages.some((item) => item.service === "Screeding"),
      repairs: input.workPackages.some((item) => item.service === "Repairs")
    };
  }
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
  if (!labourMode) blockers.push("Select a repair labour type.");
  if (!input.repairs.repairLines.length) blockers.push("Add at least one repair type.");
  if (usesSubcontract && !input.repairs.repairSubcontractors.some((item) => item.rate > 0 && (item.priceType === "lump sum" || item.days > 0))) blockers.push("Add at least one repair subcontractor as a lump sum or day rate.");
  if (usesInHouse && input.repairs.labourMen <= 0) blockers.push("Add the number of in-house repair men.");
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
      if (material.calcMethod === "area_thickness" && material.id === "fastprime-5" && !repairLine.areaM2 && !hasHoleVolume) blockers.push(`${line}: ${material.name} needs an area or each/hole dimensions.`);
      if (material.calcMethod === "manual" && repairLine.manualMaterialQty <= 0) blockers.push(`${line}: ${material.name} needs a manual material quantity.`);
    });
  });
  const calculatedRepairDays = Math.ceil(input.repairs.repairLines.reduce((sum, repairLine) => sum + repairLineDays(repairLine, repairCatalog), 0));
  if (input.repairs.labourDays > 0 && input.repairs.labourDays !== calculatedRepairDays) warnings.push(`Repair days are manually overridden from ${calculatedRepairDays} to ${input.repairs.labourDays}.`);
  if (usesInHouse && input.repairs.travelMode === "Drive" && (input.repairs.mobilisationOneWayKm > 0 || input.repairs.mobilisationSecondaryOneWayKm > 0) && input.repairs.mobilisationVehicles <= 0) blockers.push("Add at least one repair vehicle when driving is selected.");
  if (usesInHouse && input.repairs.travelMode !== "None" && input.repairs.travelDays > 0 && !input.repairs.hotelRequired) warnings.push("Travel is included without hotel/subsistence. Check this is a local or same-day job.");
  if (usesInHouse && input.repairs.travelMode === "Fly" && input.repairs.airportTransport === "N/A") warnings.push("Repair flights are selected without home-airport transport. Confirm no transfer or parking cost is needed.");
  if (input.repairs.materialInputs.some((item) => item.lengthM || item.areaM2 || item.widthMm || item.depthMm || item.thicknessMm)) warnings.push("Legacy material inputs are ignored; use repair lines/material rules only.");
  return { blockers, warnings };
}

function grindingReadiness(input: ProjectInput): RepairReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!input.includeGrinding || !input.grinding.enabled) return { blockers, warnings };
  const g = input.grinding;
  const days = g.estimatedDays;
  const productionMode = g.productionLabourMode ?? "in_house";
  const surveyorMode = g.surveyorLabourMode ?? "in_house";
  const usesProductionInHouse = productionMode === "in_house" || productionMode === "both";
  const usesProductionSubcontract = productionMode === "subcontract" || productionMode === "both";
  const usesSurveyorInHouse = surveyorMode === "in_house" || surveyorMode === "both";
  const usesSurveyorSubcontract = surveyorMode === "subcontract" || surveyorMode === "both";
  if (days <= 0) blockers.push("Add estimated grinding days.");
  if (!surveyorMode) blockers.push("Surveyor labour must be selected.");
  if (usesSurveyorInHouse && g.surveyorCount <= 0) blockers.push("Add at least one grinding surveyor.");
  if (usesSurveyorSubcontract && !g.surveyorSubcontractors.some((item) => item.rate > 0 && (item.priceType === "lump sum" || item.days > 0))) blockers.push("Add at least one surveyor subcontractor cost.");
  if (usesProductionInHouse && g.productionMen <= 0) blockers.push("Add production men for in-house grinding labour.");
  if (usesProductionSubcontract && !g.productionSubcontractors.some((item) => item.rate > 0 && (item.priceType === "lump sum" || item.days > 0))) blockers.push("Add at least one grinding production subcontractor cost.");
  if (usesProductionInHouse && g.productionMen <= 0) warnings.push("In-house grinding is selected but no production men are entered for grinder days.");
  if (usesProductionInHouse && !g.dustVacuums) warnings.push("In-house grinding is selected but no dust vacuums are entered.");
  if (g.nightShiftRequired && !g.nightShifts && !g.productionNightShifts && !g.surveyorNightShifts) blockers.push("Night shift is selected but no night shifts are entered.");
  if (usesProductionInHouse && g.productionTravelMode === "Drive" && (g.productionOneWayKm > 0 || g.productionSecondaryOneWayKm > 0) && g.productionVehicles <= 0) blockers.push("Add at least one production vehicle when grinding driving is selected.");
  if (usesSurveyorInHouse && g.surveyorTravelMode === "Drive" && (g.surveyorOneWayKm > 0 || g.surveyorSecondaryOneWayKm > 0) && g.surveyorVehicles <= 0) blockers.push("Add at least one surveyor vehicle when grinding driving is selected.");
  if (usesProductionInHouse && g.productionTravelMode === "Fly" && !g.equipmentShipping) warnings.push("Grinding production is flying but equipment shipping is zero. Confirm tools are already available at the destination.");
  if (g.productionLabourDays > 0 && g.productionLabourDays !== days) warnings.push(`Production labour days are overridden from ${days} to ${g.productionLabourDays}.`);
  if (g.surveyorDays > 0 && g.surveyorDays !== days) warnings.push(`Surveyor labour days are overridden from ${days} to ${g.surveyorDays}.`);
  return { blockers, warnings };
}

function screedReadiness(input: ProjectInput): RepairReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!input.includeScreeding || !input.screeding.enabled) return { blockers, warnings };
  const s = input.screeding;
  const days = s.preparationDays + s.screedingDays + s.grindingDays;
  const productionMode = s.productionLabourMode ?? "subcontract";
  const surveyorMode = s.surveyorLabourMode ?? "in_house";
  const usesProductionInHouse = productionMode === "in_house" || productionMode === "both";
  const usesProductionSubcontract = productionMode === "subcontract" || productionMode === "both";
  const usesSurveyorInHouse = surveyorMode === "in_house" || surveyorMode === "both";
  const usesSurveyorSubcontract = surveyorMode === "subcontract" || surveyorMode === "both";
  if (days <= 0) blockers.push("Add total screeding days on site.");
  if (s.areaM2 <= 0) warnings.push("Screeding area is zero. Check materials and programme are intentional.");
  if (!surveyorMode) blockers.push("Surveyor labour must be selected for screeding.");
  if (usesSurveyorInHouse && s.surveyors <= 0) blockers.push("Add at least one screeding surveyor.");
  if (usesSurveyorSubcontract && !s.surveyorSubcontractors.some((item) => item.rate > 0 && (item.priceType === "lump sum" || item.days > 0))) blockers.push("Add at least one screeding surveyor subcontractor cost.");
  if (usesProductionInHouse && s.productionMen <= 0) blockers.push("Add production men for in-house screeding labour.");
  if (usesProductionSubcontract && !s.teams.some((team) => team.rate > 0 && (team.priceType === "lump sum" || team.preparationDays + team.screedingDays + team.grindingDays > 0))) blockers.push("Add at least one screeding production subcontractor cost.");
  if (s.nightShiftRequired && !s.nightShifts && !s.productionNightShifts && !s.surveyorNightShifts) blockers.push("Night shift is selected but no night shifts are entered.");
  if (usesProductionInHouse && s.productionTravelMode === "Drive" && (s.productionOneWayKm > 0 || s.productionSecondaryOneWayKm > 0) && s.productionVehicles <= 0) blockers.push("Add at least one production vehicle when screeding driving is selected.");
  if (usesSurveyorInHouse && s.surveyorTravelMode === "Drive" && (s.surveyorOneWayKm > 0 || s.surveyorSecondaryOneWayKm > 0) && s.surveyorVehicles <= 0) blockers.push("Add at least one surveyor vehicle when screeding driving is selected.");
  if (usesProductionInHouse && s.productionTravelMode === "Fly" && !s.equipmentShipping) warnings.push("Screeding production is flying but equipment shipping is zero. Confirm tools are already available at the destination.");
  if (s.productionLabourDays > 0 && s.productionLabourDays !== days) warnings.push(`Production labour days are overridden from ${days} to ${s.productionLabourDays}.`);
  if (s.surveyorDays > 0 && s.surveyorDays !== days) warnings.push(`Surveyor labour days are overridden from ${days} to ${s.surveyorDays}.`);
  if (s.ukSupervisorRequired) warnings.push("UK supervisor is no longer priced in the screeding model. Use surveyor labour instead.");
  return { blockers, warnings };
}

function projectReadiness(input: ProjectInput, budgetMarkupExact: number, duplicateReference = false, hasCommercialValue = false, repairCatalog: RepairCatalog = defaultRepairCatalog): RepairReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  void repairCatalog;
  const hasSelectedService = input.pricingMode === "selectable"
    ? input.workPackages.length > 0
    : input.includeGrinding || input.includeScreeding || input.includeRepairs;
  if (!hasSelectedService) warnings.push("No service has been selected.");
  if (input.pricingMode !== "selectable") {
    if (input.includeGrinding && !input.grinding.enabled) warnings.push("Grinding is selected but its costing section is not enabled.");
    if (input.includeScreeding && !input.screeding.enabled) warnings.push("Screeding is selected but its costing section is not enabled.");
    if (input.includeRepairs && !input.repairs.enabled) warnings.push("Repairs are selected but their costing section is not enabled.");
  }
  if (!input.projectReference.trim()) warnings.push("Project reference is blank.");
  if (!input.client.trim()) warnings.push("Client name is blank.");
  if (!input.location.trim()) warnings.push("Project location is blank.");
  if (input.exchangeRateToCompanyCurrency <= 0 || input.exchangeRateToGroupCurrency <= 0) warnings.push("Exchange rates should be greater than zero.");
  if (hasCommercialValue && budgetMarkupExact < 25) warnings.push(`Overall markup is ${percent(budgetMarkupExact)}, below 25%.`);
  if (duplicateReference && input.projectReference.trim()) warnings.push("This project reference already exists. Confirm this is intentional before saving.");
  if (input.projectManagement.enabled && input.projectManagement.days <= 0) warnings.push("Project management is enabled but no management days are entered.");
  if (input.projectManagement.enabled && input.projectManagement.travelMode === "Drive" && chargeableJourneyDistance(input.officeCount, input.projectManagement.oneWayKm, input.projectManagement.secondaryOneWayKm, input.projectManagement.vehicles, input.projectManagement.visits) <= 0) warnings.push("Project manager driving is selected but the office journey or vehicle count is zero.");
  if (input.projectManagement.enabled && input.projectManagement.travelMode === "Drive" && input.projectManagement.vehicles <= 0) warnings.push("Project manager driving is selected but no vehicles are entered.");
  if (input.projectManagement.enabled && input.projectManagement.travelMode === "Fly" && input.projectManagement.airportTransport === "N/A") warnings.push("Project manager flying is selected without home-airport transport. Confirm no transfer or parking cost is needed.");
  return { blockers, warnings };
}

export default function Workspace() {
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const routeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1] ? decodeURIComponent(pathname.match(/^\/projects\/([^/]+)/)![1]) : "";
  const editRoute = parseEditRoute(pathname);
  const surveyEditMatch = pathname.match(/^\/survey\/new-project\/([^/]+)(?:\/(revision))?$/);
  const routeIsSurvey = pathname.startsWith("/survey") || pathname.includes("/admin-rates/survey");
  const routeEditProjectId = surveyEditMatch?.[1] ? decodeURIComponent(surveyEditMatch[1]) : editRoute.projectId;
  const routeEditStep = editRoute.step;
  const routeCreatesRevision = surveyEditMatch?.[2] === "revision" || editRoute.createsRevision;
  const routeView = pathname.startsWith("/projects/") ? "Project Detail" : pathname.includes("new-project") || pathname.includes("grinding") || pathname.includes("screeding") || pathname.includes("repairs") ? "New Project" : pathname.includes("project-search") ? "Project Search" : pathname.includes("admin-rates") ? "Admin Rates" : pathname.includes("company-admin") ? "Company Admin" : "Dashboard";
  const routeTab: DetailTab = pathname.includes("grinding") ? "Grinding" : pathname.includes("screeding") ? "Screeding" : pathname.includes("repairs") ? "Repairs" : pathname.includes("proposal") ? "PM Handover" : pathname.includes("budget") ? "Costing" : pathname.includes("pl") ? "Actual P&L" : "Summary";
  const routeAdminTab: AdminTab = pathname.includes("repair-types") ? "Repair Types" : pathname.includes("repair-materials") ? "Repair Materials" : pathname.includes("admin-rates/survey") ? "Survey Rates" : "Rates";
  const initialRouteInput = routeIsSurvey ? createSurveyProjectInput("EUR", "km") : cloneInput(emptyInput);
  const [view, setView] = useState<View>(routeView);
  const [detailTab, setDetailTab] = useState<DetailTab>(routeTab);
  const [input, setInput] = useState<ProjectInput>(() => initialRouteInput);
  const [baselineInput, setBaselineInput] = useState<ProjectInput>(() => cloneInput(initialRouteInput));
  const [rates, setRatesState] = useState<AdminRates>(defaultRates);
  const [baselineRates, setBaselineRates] = useState<AdminRates>(defaultRates);
  const [repairCatalog, setRepairCatalog] = useState<RepairCatalog>(defaultRepairCatalog);
  const [baselineRepairCatalog, setBaselineRepairCatalog] = useState<RepairCatalog>(defaultRepairCatalog);
  const [pricingRates, setPricingRates] = useState<AdminRates>(defaultRates);
  const [pricingCatalog, setPricingCatalog] = useState<RepairCatalog>(defaultRepairCatalog);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [deletedProjects, setDeletedProjects] = useState<ProjectRecord[]>([]);
  const [rateVersions, setRateVersions] = useState<RateVersionRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [note, setNote] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "autosaving" | "saving" | "saved">("idle");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const autosaveInFlight = useRef(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [adminTab, setAdminTab] = useState<AdminTab>(routeAdminTab);
  const companyLoadToken = useRef(0);
  const [actuals, setActuals] = useState(defaultActuals(calculateProject(emptyInput, defaultRates, defaultRepairCatalog)));
  const calculations = useMemo(() => calculateProject(input, pricingRates, pricingCatalog), [input, pricingRates, pricingCatalog]);
  const selected = projects.find((project) => project.id === selectedId);
  const selectedCalcs = selected?.calculations ?? calculations;
  const pl = calculatePL(selectedCalcs, selected?.actuals ?? actuals);
  const routeModule = routeModuleKey(pathname);
  const routePermission = routePermissionFor(pathname);
  const moduleBlocked = routeModule && (!auth.enabledModules.includes(routeModule) || !hasPermission(auth.role, routePermission));
  const displayCurrency = view === "New Project" ? input.quoteCurrency : view === "Project Detail" && selected ? selected.inputs.quoteCurrency : auth.activeCompany.defaultCurrency;
  const hasUnsavedChanges = view === "New Project" && !costingInputsEqual(input, baselineInput);
  const hasUnsavedAdminChanges = view === "Admin Rates" && (JSON.stringify(rates) !== JSON.stringify(baselineRates) || JSON.stringify(repairCatalog) !== JSON.stringify(baselineRepairCatalog));
  const hasUnsavedWork = hasUnsavedChanges || hasUnsavedAdminChanges;
  const duplicateProjectReference = Boolean(input.projectReference.trim()) && projects.some((project) => project.id !== editingId && project.inputs.projectReference.trim().toLowerCase() === input.projectReference.trim().toLowerCase());
  setMoneyCurrency(displayCurrency);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedWork) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedWork]);

  useEffect(() => {
    setView(routeView);
    setDetailTab(routeTab);
    setAdminTab(routeAdminTab);
  }, [pathname, routeAdminTab, routeTab, routeView]);

  useEffect(() => {
    if (auth.configured && (!auth.session || !auth.companies.length)) return;
    setStorageContext({
      companyId: auth.activeCompany.id,
      actorName: auth.session?.user.email ?? "James Dare",
      userId: auth.session?.user.id
    });
    const loadToken = ++companyLoadToken.current;
    setWorkspaceLoading(true);
    setWorkspaceLoaded(false);
    setWorkspaceError("");
    void Promise.all([loadRates(), loadProjects(), loadRepairCatalog(), loadDeletedProjects(), loadRateVersions()]).then(([loadedRates, loadedProjects, loadedRepairCatalog, loadedDeletedProjects, loadedRateVersions]) => {
      if (loadToken !== companyLoadToken.current) return;
      setRatesState(loadedRates);
      setBaselineRates(JSON.parse(JSON.stringify(loadedRates)) as AdminRates);
      setRepairCatalog(loadedRepairCatalog);
      setBaselineRepairCatalog(JSON.parse(JSON.stringify(loadedRepairCatalog)) as RepairCatalog);
      setPricingRates(loadedRates);
      setPricingCatalog(loadedRepairCatalog);
      setProjects(loadedProjects);
      setDeletedProjects(loadedDeletedProjects);
      setRateVersions(loadedRateVersions);
      const companyBlank = createRemedialProjectInput(loadedRates, auth.activeCompany.defaultCurrency, auth.activeCompany.distanceUnit, auth.activeCompany.officeCount);
      const routedBlank = routeIsSurvey ? createSurveyProjectInput(auth.activeCompany.defaultCurrency, auth.activeCompany.distanceUnit, undefined, auth.activeCompany.officeCount) : companyBlank;
      setInput(routedBlank);
      setBaselineInput(cloneInput(routedBlank));
      setEditingId("");
      setSelectedId("");
      setLastSavedAt("");
      setActuals(defaultActuals(routeIsSurvey && routedBlank.survey ? calculateSurveyProject(routedBlank.survey, loadedRates.surveyRates) : calculateProject(companyBlank, loadedRates, loadedRepairCatalog)));
      setWorkspaceLoaded(true);
    }).catch((error: unknown) => { if (loadToken === companyLoadToken.current) setWorkspaceError(error instanceof Error ? error.message : "Could not load the company workspace."); }).finally(() => { if (loadToken === companyLoadToken.current) setWorkspaceLoading(false); });
    return () => { if (loadToken === companyLoadToken.current) companyLoadToken.current += 1; };
  }, [auth.activeCompany.defaultCurrency, auth.activeCompany.distanceUnit, auth.activeCompany.id, auth.activeCompany.officeCount, auth.companies.length, auth.configured, auth.session, auth.session?.user.email, auth.session?.user.id, routeIsSurvey]);

  useEffect(() => {
    if (!routeProjectId) return;
    const routedProject = projects.find((project) => project.id === routeProjectId);
    if (!routedProject) return;
    setSelectedId(routedProject.id);
    setActuals(routedProject.actuals ?? defaultActuals(routedProject.calculations));
  }, [projects, routeProjectId]);

  useEffect(() => {
    if (!routeEditProjectId || !workspaceLoaded) return;
    const project = projects.find((item) => item.id === routeEditProjectId);
    if (!project) return;
    if (editingId === project.id) return;
    const editable = cloneInput(project.inputs);
    if (routeCreatesRevision) {
      const numericRevision = Number.parseInt(editable.revision, 10);
      editable.revision = Number.isFinite(numericRevision) ? String(numericRevision + 1) : `${editable.revision || "1"}.1`;
    }
    if (routeEditStep) editable.uiProgress = { ...editable.uiProgress, builderStep: routeEditStep };
    setInput(editable);
    setBaselineInput(cloneInput(project.inputs));
    setPricingRates(project.rateSnapshot ?? rates);
    setPricingCatalog(project.repairCatalogSnapshot ?? repairCatalog);
    setEditingId(project.id);
    setSelectedId(project.id);
    setActuals(project.actuals ?? defaultActuals(project.calculations));
  // Loading an edit route is intentionally keyed to the routed record, not input edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, routeEditProjectId, routeEditStep, routeCreatesRevision, workspaceLoaded]);

  useEffect(() => {
    if (selected) setActuals(selected.actuals ?? defaultActuals(selected.calculations));
  }, [selected, selectedId]);

  async function refresh() {
    const [active, deleted] = await Promise.all([loadProjects(), loadDeletedProjects()]);
    setProjects(active);
    setDeletedProjects(deleted);
  }

  function startNewProject() {
    const blank = createRemedialProjectInput(rates, auth.activeCompany.defaultCurrency, auth.activeCompany.distanceUnit, auth.activeCompany.officeCount);
    blank.exchangeRateToCompanyCurrency = 1;
    blank.exchangeRateToGroupCurrency = auth.activeCompany.defaultCurrency === auth.activeCompany.reportingCurrency ? 1 : blank.exchangeRateToGroupCurrency;
    setInput(blank);
    setBaselineInput(cloneInput(blank));
    setPricingRates(rates);
    setPricingCatalog(repairCatalog);
    setSelectedId("");
    setEditingId("");
    setActuals(defaultActuals(calculateProject(blank, rates, repairCatalog)));
    setLastSavedAt("");
    setSaveState("idle");
    setView("New Project");
    setDetailTab("Summary");
    if (pathname !== "/new-project") router.push("/new-project");
  }

  function startNewSurveyProject() {
    const blank = createSurveyProjectInput(auth.activeCompany.defaultCurrency, auth.activeCompany.distanceUnit, undefined, auth.activeCompany.officeCount);
    setInput(blank);
    setBaselineInput(cloneInput(blank));
    setPricingRates(rates);
    setPricingCatalog(repairCatalog);
    setSelectedId("");
    setEditingId("");
    setActuals(defaultActuals(calculateSurveyProject(blank.survey!, rates.surveyRates)));
    setLastSavedAt("");
    setSaveState("idle");
    setView("New Project");
    setDetailTab("Summary");
    if (pathname !== "/survey/new-project") router.push("/survey/new-project");
  }

  async function saveCurrentProject(status: ProjectStatus = "Draft") {
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
      setLastSavedAt(new Date().toISOString());
      router.push(`/projects/${encodeURIComponent(saved.id)}`);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "The project could not be saved.");
      setSaveState("idle");
    }
  }

  useEffect(() => {
    if (view !== "New Project" || !workspaceLoaded || !hasUnsavedChanges || duplicateProjectReference || !input.projectReference.trim() || saveState === "saving" || saveState === "autosaving") return;
    const timer = window.setTimeout(() => {
      if (autosaveInFlight.current) return;
      autosaveInFlight.current = true;
      setSaveState("autosaving");
      const existingId = editingId || undefined;
      void saveProject(input, pricingRates, existingId, auth.session?.user.email ?? "System", pricingCatalog, "Draft", { autosave: true }).then((saved) => {
        setBaselineInput(cloneInput(saved.inputs));
        setEditingId(saved.id);
        setSelectedId(saved.id);
        setProjects((current) => [saved, ...current.filter((project) => project.id !== saved.id)]);
        setLastSavedAt(new Date().toISOString());
        setSaveState("saved");
        if (!existingId) router.replace(`${saved.inputs.costingModule === "survey" ? "/survey/new-project" : "/new-project"}/${encodeURIComponent(saved.id)}`);
      }).catch((error) => {
        setWorkspaceError(error instanceof Error ? error.message : "The draft could not be autosaved.");
        setSaveState("idle");
      }).finally(() => { autosaveInFlight.current = false; });
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [auth.session?.user.email, duplicateProjectReference, editingId, hasUnsavedChanges, input, pricingCatalog, pricingRates, router, saveState, view, workspaceLoaded]);

  useEffect(() => {
    if (!workspaceError || workspaceError.includes("Reference ERR-")) return;
    const original = workspaceError;
    void reportAppError({ companyId: auth.activeCompany.id, userId: auth.session?.user.id, area: "workspace", error: original, path: pathname }).then((reference) => {
      setWorkspaceError((current) => current === original ? `${original} Reference ${reference}.` : current);
    });
  }, [auth.activeCompany.id, auth.session?.user.id, pathname, workspaceError]);

  useEffect(() => {
    const reportRuntimeError = (event: ErrorEvent) => { void reportAppError({ companyId: auth.activeCompany.id, userId: auth.session?.user.id, area: "runtime", error: event.error ?? event.message, path: pathname }); };
    const reportRejection = (event: PromiseRejectionEvent) => { void reportAppError({ companyId: auth.activeCompany.id, userId: auth.session?.user.id, area: "unhandled-promise", error: event.reason, path: pathname }); };
    window.addEventListener("error", reportRuntimeError);
    window.addEventListener("unhandledrejection", reportRejection);
    return () => {
      window.removeEventListener("error", reportRuntimeError);
      window.removeEventListener("unhandledrejection", reportRejection);
    };
  }, [auth.activeCompany.id, auth.session?.user.id, pathname]);

  function editProject(project: ProjectRecord, requestedStep?: BuilderStep) {
    const locked = statusIsLocked(project.status);
    const currentStatus = normaliseProjectStatus(project.status);
    if (["Lost", "Completed", "Closed"].includes(currentStatus)) {
      alert(`${currentStatus} projects are locked and cannot be revised.`);
      return;
    }
    if (locked && !confirm("This costing is locked. Create a new editable revision while preserving the approved version?")) return;
    if (project.inputs.costingModule === "survey") {
      router.push(`/survey/new-project/${encodeURIComponent(project.id)}${locked ? "/revision" : ""}`);
      return;
    }
    const stepSegment = requestedStep && ["Grinding", "Screeding", "Repairs"].includes(requestedStep) ? `/${requestedStep.toLowerCase()}` : "";
    router.push(`/new-project/${encodeURIComponent(project.id)}${stepSegment}${locked ? "/revision" : ""}`);
  }

  function openProject(project: ProjectRecord, tab: DetailTab = "Summary") {
    setSelectedId(project.id);
    setView("Project Detail");
    setDetailTab(tab);
    router.push(`/projects/${encodeURIComponent(project.id)}`);
  }

  const selectedContext = selected ? `${selected.inputs.projectReference || "Draft"} - ${selected.inputs.client || "No client"} - ${selected.calculations.serviceSummary}` : "No project selected";
  const shellServices = view === "Project Detail" && selected ? serviceFlags(selected.inputs) : serviceFlags(input);
  const moduleEnabled = (module: "survey" | "remedial") => auth.enabledModules.includes(module === "survey" ? "survey_costing" : "remedial_costing");
  const requestedCostingModule = selected?.inputs.costingModule ?? input.costingModule ?? (routeIsSurvey ? "survey" : "remedial");
  const activeCostingModule = moduleEnabled(requestedCostingModule) ? requestedCostingModule : moduleEnabled("survey") ? "survey" : "remedial";
  const visibleProjects = projects.filter((project) => moduleEnabled(project.inputs.costingModule ?? "remedial"));
  const selectedModuleBlocked = Boolean(selected && !moduleEnabled(selected.inputs.costingModule ?? "remedial"));
  const activeBuilderStep = input.uiProgress?.builderStep as BuilderStep | undefined;
  const confirmNavigation = () => !hasUnsavedWork || confirm(`${hasUnsavedAdminChanges ? "Admin data" : "This costing"} has unsaved changes. Leave and discard them?`);
  const navigateBuilder = (step: "Services" | "Grinding" | "Screeding" | "Repairs") => {
    if (view === "New Project") {
      setInput({ ...input, uiProgress: { ...input.uiProgress, builderStep: input.pricingMode === "selectable" && step !== "Services" ? "Packages" : step } });
      scrollToCostingSection();
      return;
    }
    if (step === "Services") {
      startNewProject();
      return;
    }
    if (selected) {
      editProject(selected, step);
      return;
    }
    startNewProject();
  };

  if (auth.configured && auth.session && !auth.companies.length) return <div className="min-h-screen bg-slate-100 p-8"><div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold">No company access</h1><p className="mt-2 text-sm text-slate-600">Your account is signed in but has no active company membership. Ask a super admin to restore the company membership.</p></div></div>;

  return (
    <ProductShell view={view} pathname={pathname} selectedContext={selectedContext} activeServices={shellServices} activeCostingModule={activeCostingModule} activeBuilderStep={activeBuilderStep} activeAdminTab={adminTab} onNewProject={activeCostingModule === "survey" ? startNewSurveyProject : startNewProject} onCostingModule={(module) => module === "survey" ? startNewSurveyProject() : startNewProject()} onBuilderStep={navigateBuilder} onAdminTab={setAdminTab} canNavigate={confirmNavigation}>
      <section className="workspace-page">
        {workspaceError && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{workspaceError}</div>}
        {workspaceLoading && <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-600">Loading company workspace...</div>}
        {saveState === "autosaving" && <div className="mb-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-800">Saving draft securely...</div>}
        {saveState === "saved" && !hasUnsavedChanges && <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Project saved to the company workspace{lastSavedAt ? ` at ${new Date(lastSavedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}.</div>}
        {(moduleBlocked || selectedModuleBlocked) && <ModuleBlocked moduleKey={selectedModuleBlocked ? (selected?.inputs.costingModule === "survey" ? "survey_costing" : "remedial_costing") : routeModule!} />}
        {!moduleBlocked && !selectedModuleBlocked && <>
        <WorkspaceBanner view={view} selected={selected} projects={visibleProjects} />
        {view === "Dashboard" && <Dashboard projects={visibleProjects} companyCurrency={auth.activeCompany.defaultCurrency} open={(project) => openProject(project)} />}
        {view === "New Project" && input.costingModule === "survey" && input.survey && <SurveyBuilder input={input.survey} onChange={(survey) => setInput(syncSurveyProjectInput(input, survey))} rates={normaliseSurveyRates(pricingRates.surveyRates)} onSave={(complete) => void saveCurrentProject(complete ? "Costing Complete" : "Draft")} saving={saveState === "saving" || saveState === "autosaving"} duplicateReference={duplicateProjectReference} />}
        {view === "New Project" && input.costingModule !== "survey" && <ProjectBuilder input={input} setInput={setInput} rates={pricingRates} repairCatalog={pricingCatalog} calculations={calculations} onSave={saveCurrentProject} duplicateReference={duplicateProjectReference} usingSnapshot={Boolean(editingId && selected?.rateSnapshot)} saving={saveState === "saving" || saveState === "autosaving"} dirty={hasUnsavedChanges} reprice={() => { setPricingRates(rates); setPricingCatalog(repairCatalog); setInput({ ...input, exchangeRateLockedAt: new Date().toISOString() }); }} />}
        {view === "Project Search" && <SearchView projects={visibleProjects} deletedProjects={deletedProjects.filter((project) => moduleEnabled(project.inputs.costingModule ?? "remedial"))} open={(project) => openProject(project)} edit={editProject} restore={async (project) => { try { await restoreProject(project.id); await refresh(); } catch (error) { setWorkspaceError(error instanceof Error ? error.message : "The project could not be restored."); throw error; } }} purge={async (project) => { try { await purgeProject(project.id); await refresh(); } catch (error) { setWorkspaceError(error instanceof Error ? error.message : "The project could not be permanently deleted."); throw error; } }} />}
        {view === "Admin Rates" && <AdminRatesView rates={rates} setRates={setRatesState} repairCatalog={repairCatalog} setRepairCatalog={setRepairCatalog} adminTab={adminTab} setAdminTab={setAdminTab} rateVersions={rateVersions} restoreRateVersion={(version) => setRatesState(version.rates)} save={async () => { try { await saveAdminData(rates, repairCatalog); setBaselineRates(JSON.parse(JSON.stringify(rates)) as AdminRates); setBaselineRepairCatalog(JSON.parse(JSON.stringify(repairCatalog)) as RepairCatalog); setRateVersions(await loadRateVersions()); alert("Admin data saved and versioned. New costings use these values; saved projects keep their pricing snapshot until explicitly repriced."); } catch (error) { setWorkspaceError(error instanceof Error ? error.message : "Admin data could not be saved."); } }} />}
        {view === "Company Admin" && <CompanyAdminPanel />}
        {view === "Project Detail" && selected && (
          <ProjectDetail
            project={selected}
            tab={detailTab}
            setTab={setDetailTab}
            actuals={actuals}
            setActuals={setActuals}
            saveActuals={async (finalise = false) => {
              try {
                if (finalise) {
                  if (!["Completed", "Closed"].includes(normaliseProjectStatus(selected.status))) throw new Error("Complete the project before finalising its P&L actuals.");
                  if (!actuals.actualPrice || !actuals.startDate || !actuals.endDate || !actuals.daysTakenToComplete) throw new Error("Actual price, start date, end date and site days are required before finalising actuals.");
                  if (new Date(`${actuals.endDate}T00:00:00`) < new Date(`${actuals.startDate}T00:00:00`)) throw new Error("The P&L end date cannot be before the start date.");
                  if (actuals.travelDays > calculateWorkingDays(actuals.startDate, actuals.endDate, actuals.saturdayWorked, actuals.sundayWorked)) throw new Error("Travel days cannot exceed the working days in the selected date range.");
                  if (!confirm("Finalise these actuals? Confirm that every actual cost category has been checked, including any genuine zero values.")) return;
                }
                const saved = await saveActuals(selected.id, actuals, auth.session?.user.email ?? "James Dare", finalise);
                setActuals(saved);
                await refresh();
              } catch (error) { setWorkspaceError(error instanceof Error ? error.message : "P&L actuals could not be saved."); }
            }}
            recordHandover={async (issued) => { try { await recordProjectHandover(selected.id, auth.session?.user.email ?? "James Dare", issued); await refresh(); } catch (error) { setWorkspaceError(error instanceof Error ? error.message : "The handover event could not be recorded."); throw error; } }}
            addNote={async () => { if (note.trim()) { try { await addProjectNote(selected.id, { author: auth.session?.user.email ?? "James Dare", category: "General", text: note.trim() }); setNote(""); await refresh(); } catch (error) { setWorkspaceError(error instanceof Error ? error.message : "The note could not be saved."); } } }}
            savePackageSelection={async (selectedPackageIds, reason) => { try { await saveProjectPackageSelection(selected.id, selectedPackageIds, auth.session?.user.email ?? "James Dare", reason); await refresh(); } catch (error) { setWorkspaceError(error instanceof Error ? error.message : "The client package selection could not be saved."); throw error; } }}
            note={note}
            setNote={setNote}
            edit={() => editProject(selected)}
            updateStatus={async (status) => { try { await updateProjectWorkflow(selected.id, status, undefined, auth.session?.user.email ?? "James Dare"); await refresh(); } catch (error) { setWorkspaceError(error instanceof Error ? error.message : "Project status could not be updated."); } }}
            deleteProjectRecord={async (reason) => {
              try {
                await deleteProject(selected.id, reason);
                setSelectedId("");
                setEditingId("");
                await refresh();
                router.push("/project-search");
              } catch (error) {
                setWorkspaceError(error instanceof Error ? error.message : "The project could not be moved to the recycle bin.");
                throw error;
              }
            }}
          />
        )}
        {view === "Project Detail" && workspaceLoaded && routeProjectId && !selected && <div className="app-card-strong p-6"><h2 className="text-xl font-semibold">Project not found</h2><p className="mt-2 text-sm text-slate-600">This project does not exist or is not available in the active company.</p><button className="secondary-button mt-4" onClick={() => router.push("/project-search")}>Open Project Search</button></div>}
        {view === "New Project" && workspaceLoaded && routeEditProjectId && !projects.some((project) => project.id === routeEditProjectId) && <div className="app-card-strong p-6"><h2 className="text-xl font-semibold">Draft not found</h2><p className="mt-2 text-sm text-slate-600">The saved costing does not exist or belongs to another company.</p><button className="secondary-button mt-4" onClick={startNewProject}>Start New Project</button></div>}
        </>}
      </section>
    </ProductShell>
  );
}

function routeModuleKey(pathname: string): AppModuleKey | null {
  if (pathname.startsWith("/survey")) return "survey_costing";
  if (pathname.includes("admin-rates/repair-types") || pathname.includes("admin-rates/repair-materials")) return "repair_database";
  if (pathname.includes("admin-rates")) return "admin_rates";
  if (pathname.includes("company-admin")) return "company_admin";
  if (pathname.includes("new-project") || pathname.includes("grinding") || pathname.includes("screeding") || pathname.includes("repairs")) return "remedial_costing";
  if (pathname.includes("project-search")) return "projects";
  if (pathname.startsWith("/projects/")) return "projects";
  if (pathname.includes("proposal") || pathname.includes("budget") || pathname.includes("pl")) return "reports";
  return "dashboard";
}

function routePermissionFor(pathname: string): Permission {
  if (pathname.includes("admin-rates")) return "rates.update";
  if (pathname.includes("company-admin")) return "company.manage";
  if (pathname.includes("new-project") || pathname.includes("grinding") || pathname.includes("screeding") || pathname.includes("repairs")) return "projects.create";
  return "projects.read";
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
  const approved = projects.filter((project) => ["Costing Complete", "Won", "Handover Issued"].includes(normaliseProjectStatus(project.status))).reduce((sum, project) => sum + (project.calculations.proposalCompanyCurrency ?? project.calculations.proposalTotal), 0);
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
          <Mini label={`Costings Complete ${auth.activeCompany.defaultCurrency}`} value={money(approved, auth.activeCompany.defaultCurrency)} />
          <Mini label="Won" value={String(projects.filter((p) => ["Won", "Handover Issued"].includes(normaliseProjectStatus(p.status))).length)} />
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
  const [newCompanyDistanceUnit, setNewCompanyDistanceUnit] = useState<DistanceUnit>("km");
  const [companyName, setCompanyName] = useState(auth.activeCompany.name);
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>(auth.activeCompany.defaultCurrency);
  const [reportingCurrency, setReportingCurrency] = useState<CurrencyCode>(auth.activeCompany.reportingCurrency);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(auth.activeCompany.distanceUnit);
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
    setDistanceUnit(auth.activeCompany.distanceUnit);
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
      distance_unit: distanceUnit,
      primary_colour: primaryColour,
      accent_colour: accentColour,
      branding_status: "draft",
      branding_updated_at: new Date().toISOString()
    }).eq("id", auth.activeCompany.id);
    if (error) {
      setMessage(error.message.includes("distance_unit")
        ? "Distance units are not enabled in the live database yet. Apply Supabase migrations 008 and 009, then save again."
        : error.message);
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
      distance_unit: newCompanyDistanceUnit,
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
          <Select label="Distance Unit" value={distanceUnit} options={["km", "miles"]} onChange={(value) => setDistanceUnit(value as DistanceUnit)} disabled={!canManageModules} />
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 lg:col-span-2">
            New costings will use {distanceUnitCopy(distanceUnit).plural}. Per-distance rate labels will change to &quot;per {distanceUnitCopy(distanceUnit).singular}&quot;. Existing saved costings retain their recorded unit and pricing snapshot; rate values are not converted automatically.
          </div>
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
            <Select label="Distance Unit" value={newCompanyDistanceUnit} options={["km", "miles"]} onChange={(value) => setNewCompanyDistanceUnit(value as DistanceUnit)} />
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
          <Select label="Role" value={inviteRole} options={auth.role === "super_admin" ? ["viewer", "reviewer", "accounts", "manager_editor", "company_admin"] : ["viewer", "reviewer", "accounts", "manager_editor"]} onChange={(value) => setInviteRole(value as MembershipRole)} />
          <button className="primary-button self-end" disabled={!canInvite} onClick={() => void sendInvite()}>Invite</button>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-400"><tr><th className="py-2">User</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-t border-slate-100">
                  <td className="py-3"><div className="font-bold text-slate-950">{member.full_name || member.email || member.user_id}</div><div className="text-xs text-slate-500">{member.email || member.user_id}</div></td>
                  <td><select className="input min-h-10" value={member.role} disabled={!hasPermission(auth.role, "users.role.update")} onChange={(event) => void setMemberRole(member.id, event.target.value as MembershipRole)}><option value="viewer">Viewer</option><option value="reviewer">Reviewer</option><option value="accounts">Accounts</option><option value="manager_editor">Manager Editor</option>{auth.role === "super_admin" && <option value="company_admin">Company Admin</option>}</select></td>
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
  const [filters, setFilters] = useState<DashboardFilters>(emptyDashboardFilters);
  const filteredProjects = filterDashboardProjects(projects, filters);
  const hasFilters = Boolean(filters.query.trim() || filters.module !== "All" || filters.status !== "All" || filters.service !== "All");
  const patchFilters = (next: Partial<DashboardFilters>) => setFilters((current) => ({ ...current, ...next }));
  const draftProjects = filteredProjects.filter((project) => normaliseProjectStatus(project.status) === "Draft");
  const pipelineProjects = filteredProjects.filter((project) => normaliseProjectStatus(project.status) === "Costing Complete");
  const wonProjects = filteredProjects.filter((project) => ["Won", "Handover Issued"].includes(normaliseProjectStatus(project.status)));
  const pipeline = pipelineProjects.reduce((sum, project) => sum + (project.calculations.proposalCompanyCurrency ?? project.calculations.proposalTotal), 0);
  const won = wonProjects.reduce((sum, project) => sum + (project.calculations.proposalCompanyCurrency ?? project.calculations.proposalTotal), 0);
  const commercialProjects = [...pipelineProjects, ...wonProjects];
  const commercialBudget = commercialProjects.reduce((sum, project) => sum + (project.calculations.budgetCompanyCurrency ?? project.calculations.budgetCost), 0);
  const commercialProfit = commercialProjects.reduce((sum, project) => sum + ((project.calculations.proposalCompanyCurrency ?? project.calculations.proposalTotal) - (project.calculations.budgetCompanyCurrency ?? project.calculations.budgetCost)), 0);
  const weightedMarkup = commercialBudget ? commercialProfit / commercialBudget * 100 : 0;
  const moduleSummary = (["survey", "remedial"] as const).map((module) => {
    const moduleProjects = filteredProjects.filter((project) => (project.inputs.costingModule ?? "remedial") === module);
    return { module, projects: moduleProjects.length, sell: moduleProjects.reduce((sum, project) => sum + project.calculations.proposalTotal, 0), budget: moduleProjects.reduce((sum, project) => sum + project.calculations.budgetCost, 0) };
  });
  return (
    <div className="grid gap-5">
      <div className="app-card-strong p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_170px_190px_170px_auto] lg:items-end">
          <div className="grid min-w-0 gap-1"><label htmlFor="dashboard-project-search">Search projects</label><div className="dashboard-search-control"><Search aria-hidden="true" size={17} /><input id="dashboard-project-search" className="dashboard-search-input" placeholder="Reference, client, location or estimator" value={filters.query} onChange={(event) => patchFilters({ query: event.target.value })} /></div></div>
          <Select label="Module" value={filters.module} options={["All", "survey", "remedial"]} onChange={(module) => patchFilters({ module: module as DashboardFilters["module"] })} />
          <Select label="Status" value={filters.status} options={["All", "Draft", "Costing Complete", "Won", "Handover Issued", "Lost", "Completed", "Closed"]} onChange={(status) => patchFilters({ status })} />
          <Select label="Service" value={filters.service} options={["All", "Survey", "Grinding", "Screeding", "Repairs"]} onChange={(service) => patchFilters({ service })} />
          <button className="secondary-button" disabled={!hasFilters} onClick={() => setFilters(emptyDashboardFilters)}>Clear</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500"><span>Showing <b className="text-slate-800">{filteredProjects.length}</b> of {projects.length} projects. Dashboard figures use the filtered results.</span>{hasFilters && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-800">Filters active</span>}</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Draft / Review" value={String(draftProjects.length)} />
        <Metric label={`Costings Complete (${companyCurrency})`} value={money(pipeline, companyCurrency)} />
        <Metric label={`Won Backlog (${companyCurrency})`} value={money(won, companyCurrency)} />
        <Metric label="Weighted Markup" value={percent(weightedMarkup)} />
        <Metric label="Awaiting Accounts" value={String(filteredProjects.filter((project) => project.accountsStatus === "Awaiting Accounts").length)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">{moduleSummary.map((row) => <div className="app-card p-5" key={row.module}><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-black uppercase text-[var(--brand-primary)]">{row.module} costing</div><div className="mt-1 text-xl font-bold capitalize">{row.projects} project{row.projects === 1 ? "" : "s"}</div></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase text-slate-600">{row.module}</span></div><div className="mt-4 grid grid-cols-2 gap-3"><Mini label="Sell Value" value={money(row.sell, companyCurrency)} /><Mini label="Budget" value={money(row.budget, companyCurrency)} /></div></div>)}</div>
      <div className="app-card-strong">
        <div className="panel-heading"><div><h2 className="text-xl font-semibold">{hasFilters ? "Matching Projects" : "Recent Projects"}</h2><p className="text-sm text-slate-500">{filteredProjects.length > 10 ? `Showing the 10 most recent of ${filteredProjects.length} matches.` : `${filteredProjects.length} project${filteredProjects.length === 1 ? "" : "s"} shown.`}</p></div></div>
        <ProjectTable projects={filteredProjects.slice(0, 10)} open={open} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="app-card min-w-0 border-t-4 border-t-sky-500 p-4"><div className="text-[11px] font-bold uppercase text-slate-500">{label}</div><div className="mt-2 break-words text-xl font-bold text-slate-950 sm:text-2xl">{value}</div></div>;
}

function ProjectBuilder({ input, setInput, rates, repairCatalog, calculations, onSave, duplicateReference, usingSnapshot, saving, dirty, reprice }: { input: ProjectInput; setInput: (input: ProjectInput) => void; rates: AdminRates; repairCatalog: RepairCatalog; calculations: ReturnType<typeof calculateProject>; onSave: (status?: ProjectStatus) => void; duplicateReference: boolean; usingSnapshot: boolean; saving: boolean; dirty: boolean; reprice: () => void }) {
  const steps = visibleBuilderSteps(input).map((key) => ({ key, label: builderStepLabels[key] }));
  const builderStep = resolveBuilderStep(input);
  const activeIndex = Math.max(0, steps.findIndex((step) => step.key === builderStep));
  const setStep = (step: typeof builderStep) => {
    setInput({ ...input, uiProgress: { ...input.uiProgress, builderStep: step } });
    scrollToCostingSection();
  };
  const nextStep = () => setStep(adjacentBuilderStep(input, 1));
  const previousStep = () => setStep(adjacentBuilderStep(input, -1));
  const selectable = input.pricingMode === "selectable";
  const readiness = selectable ? { blockers: [], warnings: [] } : repairReadiness(input, repairCatalog);
  const grindingChecks = selectable ? { blockers: [], warnings: [] } : grindingReadiness(input);
  const screedChecks = selectable ? { blockers: [], warnings: [] } : screedReadiness(input);
  const packageChecks = selectable ? [
    ...(!input.workPackages.length ? ["Add at least one work package."] : []),
    ...input.workPackages.filter((item) => !item.name.trim()).map((item) => `${item.code || "Package"} needs a package name.`),
    ...input.workPackages.filter((item, index, items) => items.findIndex((candidate) => candidate.code.trim().toLowerCase() === item.code.trim().toLowerCase()) !== index).map((item) => `Package code ${item.code || "(blank)"} is duplicated.`),
    ...input.workPackages.filter((item) => (item.productiveRateOverride != null || item.standbyRateOverride != null) && !item.rateOverrideReason.trim()).map((item) => `${item.code} needs a reason for its rate override.`)
  ] : [];
  const exactMarkup = calculations.budgetCost ? calculations.budgetProfit / calculations.budgetCost * 100 : 0;
  const projectChecks = projectReadiness(input, exactMarkup, duplicateReference, calculations.proposalTotal > 0 || calculations.budgetCost > 0, repairCatalog);
  const approvalBlockers = [...projectChecks.blockers, ...grindingChecks.blockers, ...screedChecks.blockers, ...readiness.blockers, ...packageChecks];
  const issueStep = (issue: string): BuilderStep => selectable && /package|selection|rate override/i.test(issue) ? "Packages" : issue.toLowerCase().includes("grind") ? "Grinding" : issue.toLowerCase().includes("screed") ? "Screeding" : issue.toLowerCase().includes("repair") || issue.toLowerCase().includes("material") ? "Repairs" : issue.toLowerCase().includes("programme") || issue.toLowerCase().includes("phase") ? "Phase Schedule" : "Project";
  const stepState = (step: BuilderStep) => {
    if (step === "Services") return input.includeGrinding || input.includeScreeding || input.includeRepairs ? "Complete" : "Needs attention";
    if (step === "Project") return input.projectReference.trim() && input.client.trim() && input.location.trim() ? "Complete" : "In progress";
    if (step === "Packages") return packageChecks.length ? "Needs attention" : "Complete";
    if (step === "Grinding") return grindingChecks.blockers.length ? "Needs attention" : "Complete";
    if (step === "Screeding") return screedChecks.blockers.length ? "Needs attention" : "Complete";
    if (step === "Repairs") return readiness.blockers.length ? "Needs attention" : "Complete";
    if (step === "Review") return approvalBlockers.length ? "Needs attention" : "Complete";
    return "Complete";
  };

  return (
    <div className="grid gap-5">
      <div className="app-card p-3" id="costing-builder-navigation">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 text-[11px] font-bold uppercase text-slate-500">Costing Builder</div>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {steps.map((step, index) => (
              <button key={step.key} title={stepState(step.key)} onClick={() => setStep(step.key)} className={`inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${builderStep === step.key ? "bg-sky-700 text-white" : stepState(step.key) === "Needs attention" ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : stepState(step.key) === "Complete" ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-100" : "bg-slate-100 text-slate-800 hover:bg-slate-200"}`}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/70 text-[10px] text-slate-700">{index + 1}</span>
                <span className="truncate">{step.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="grid min-w-0 gap-5">
      {usingSnapshot && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><div><b>Saved pricing snapshot in use.</b> Admin rate changes do not alter this revision unless you explicitly reprice it.</div><button className="secondary-button" onClick={reprice}>Reprice with current admin rates</button></div>}
      {projectChecks.warnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="font-bold uppercase">Project checks</div>{projectChecks.warnings.map((warning) => <div className="mt-1" key={warning}>{warning}</div>)}</div>}
      {input.includeRepairs && (readiness.blockers.length > 0 || readiness.warnings.length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-bold uppercase">Repair sense checks</div>
          <div className="mt-1">{readiness.blockers.length + readiness.warnings.length} item{readiness.blockers.length + readiness.warnings.length === 1 ? "" : "s"} to review. These checks do not block saving or completing the costing.</div>
          <button className="secondary-button mt-3" onClick={() => setStep("Repairs")}>Open Repairs</button>
        </div>
      )}
      {approvalBlockers.length > 0 && !input.includeRepairs && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-bold uppercase">Costing sense checks</div>
          <div className="mt-1">{approvalBlockers.length} item{approvalBlockers.length === 1 ? "" : "s"} to review. These checks do not block the costing.</div>
        </div>
      )}
      <div className="app-card-strong" id="costing-builder-content">
        <div className="panel-heading flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">New Project</h2>{dirty && <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold uppercase text-amber-800">Unsaved changes</span>}</div><p className="text-sm text-slate-500">Pick services first, then complete only the sections needed for this costing.</p></div>
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={() => onSave("Draft")} disabled={saving}><Save size={16} /> {saving ? "Saving..." : "Save Draft"}</button>
            {builderStep === "Review" && <button className="primary-button" onClick={() => onSave("Costing Complete")} disabled={saving}><Save size={16} /> {saving ? "Saving..." : "Complete Costing"}</button>}
          </div>
        </div>
        <div className="p-5">
          {builderStep === "Services" && <ServiceStep input={input} setInput={setInput} setStep={setStep} />}
          {builderStep === "Project" && <ProjectBasics input={input} setInput={setInput} duplicateReference={duplicateReference} />}
          {builderStep === "Packages" && <WorkPackagesStep input={input} setInput={setInput} rates={rates} repairCatalog={repairCatalog} calculations={calculations} />}
          {builderStep === "Phase Schedule" && <PhaseScheduleStep input={input} setInput={setInput} repairCatalog={repairCatalog} calculations={calculations} />}
          {builderStep === "Grinding" && <GrindingForm input={input} setInput={setInput} rates={rates} />}
          {builderStep === "Screeding" && <ScreedForm input={input} setInput={setInput} rates={rates} />}
          {builderStep === "Repairs" && <RepairsForm input={input} setInput={setInput} repairCatalog={repairCatalog} rates={rates} projectMaterialCalcs={calculations.repairMaterialCalcs} />}
          {builderStep === "Project Management" && <ProjectManagementStep input={input} setInput={setInput} rates={rates} />}
          {builderStep === "Extras" && <ExtrasStep input={input} setInput={setInput} />}
          {builderStep === "Review" && <ReviewStep calculations={calculations} input={input} setInput={setInput} />}
          {builderStep === "Review" && <div className={`mt-5 rounded-xl border p-4 ${approvalBlockers.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}><div className="font-bold text-slate-950">Final Costing Sense Checks</div>{approvalBlockers.length ? <div className="mt-3 grid gap-2">{approvalBlockers.map((issue) => <button className="flex min-h-10 items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-sm font-semibold text-amber-950 ring-1 ring-amber-200" onClick={() => setStep(issueStep(issue))} key={issue}><span>{issue}</span><span className="ml-3 text-xs uppercase">Open section</span></button>)}</div> : <div className="mt-2 text-sm font-semibold text-emerald-900">No costing checks are currently flagged.</div>}</div>}
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-3">
        <button className="secondary-button" onClick={previousStep} disabled={activeIndex === 0}>Back</button>
        <div className="flex flex-wrap gap-2">
          {activeIndex === steps.length - 1 && <button className="secondary-button" onClick={() => onSave("Draft")} disabled={saving}>Save Draft</button>}
          <button className="primary-button" onClick={activeIndex === steps.length - 1 ? () => onSave("Costing Complete") : nextStep} disabled={saving}>{activeIndex === steps.length - 1 ? saving ? "Saving..." : "Complete Costing" : "Next"}</button>
        </div>
      </div>
      <QuoteSummary calculations={calculations} />
      </section>
    </div>
  );
}

function ServiceStep({ input, setInput, setStep }: { input: ProjectInput; setInput: (input: ProjectInput) => void; setStep: (step: BuilderStep) => void }) {
  const service = (key: "includeGrinding" | "includeScreeding" | "includeRepairs", title: string, detail: string, step: "Grinding" | "Screeding" | "Repairs") => {
    const serviceName = title as ProjectServiceKey;
    const checked = input.pricingMode === "selectable" ? input.workPackages.some((item) => item.service === serviceName) : input[key];
    const toggleService = () => {
      if (input.pricingMode === "selectable") {
        if (checked && !window.confirm(`Remove every ${serviceName} package and its costing data?`)) return;
        const workPackages = checked
          ? input.workPackages.filter((item) => item.service !== serviceName)
          : [...input.workPackages, createWorkPackage(serviceName, input, input.workPackages.length)];
        setInput({
          ...input,
          workPackages,
          activeWorkPackageId: workPackages.some((item) => item.id === input.activeWorkPackageId) ? input.activeWorkPackageId : workPackages[0]?.id ?? "",
          includeGrinding: workPackages.some((item) => item.service === "Grinding"),
          includeScreeding: workPackages.some((item) => item.service === "Screeding"),
          includeRepairs: workPackages.some((item) => item.service === "Repairs")
        });
        return;
      }
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
        {checked && <button type="button" onClick={() => setStep(input.pricingMode === "selectable" ? "Packages" : step)} className="mt-4 rounded-md bg-white px-3 py-2 text-sm font-bold text-sky-800 ring-1 ring-sky-200">{input.pricingMode === "selectable" ? "Open packages" : "Open detail"}</button>}
      </div>
    );
  };
  return (
    <div>
      <div className="mb-5">
        <h3 className="text-2xl font-bold text-slate-950">What are we pricing?</h3>
        <p className="mt-1 text-sm text-slate-600">Choose one combined price for the whole job, or separate selectable work packages when the client may award only part of the scope.</p>
      </div>
      <div className="mb-5 grid gap-3 md:grid-cols-2">
        <Choice active={input.pricingMode !== "selectable"} title="Combined project price" detail="One overall proposal and budget. This keeps the existing costing workflow unchanged." onClick={() => setInput({ ...input, pricingMode: "combined" })} />
        <Choice active={input.pricingMode === "selectable"} title="Selectable work packages" detail="Each package is priced independently; project-wide costs are charged once." onClick={() => {
          const workPackages = input.workPackages.length ? input.workPackages : createSelectablePackages(input);
          const sharedCosts = input.sharedCosts.filter((item) => item.rate > 0 || item.quantity > 1 || !/^common mobilisation(?: and demobilisation| and shared costs)?$/i.test(item.name.trim()));
          setInput({ ...input, pricingMode: "selectable", workPackages, sharedCosts, selectionConfirmed: false, activeWorkPackageId: input.activeWorkPackageId || workPackages[0]?.id || "" });
        }} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {service("includeGrinding", "Grinding", "Grinding labour, subcontract team, generators, grinders, vacuums, tooling and consumables.", "Grinding")}
        {service("includeScreeding", "Screeding", "Flexible subcontractors, screed materials, primer, sand, surveyor labour and in-house tool options.", "Screeding")}
        {service("includeRepairs", "Repairs", "Joint repair resources, repair material calculator, subcontractors and haulage.", "Repairs")}
      </div>
      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        {input.pricingMode === "selectable" ? "Recommended flow: choose the services above, price every offered package, then add project-wide management and extras once. Record the client's award later from the saved project summary." : "Recommended flow: choose services, add project details, confirm the phase schedule, complete each service, add shared project management and extras, then complete the commercial review."}
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
        <Select label="Costing Currency" value={input.quoteCurrency} options={currencies} onChange={(v) => setInput({ ...input, quoteCurrency: v as ProjectInput["quoteCurrency"], exchangeRateToCompanyCurrency: v === auth.activeCompany.defaultCurrency ? 1 : input.exchangeRateToCompanyCurrency, exchangeRateToGroupCurrency: v === auth.activeCompany.reportingCurrency ? 1 : input.exchangeRateToGroupCurrency, exchangeRateLockedAt: new Date().toISOString() })} />
        <NumberInput label={`1 ${input.quoteCurrency} = Company ${auth.activeCompany.defaultCurrency}`} value={input.exchangeRateToCompanyCurrency} min={0.00000001} onChange={(v) => setInput({ ...input, exchangeRateToCompanyCurrency: v, exchangeRateLockedAt: new Date().toISOString() })} />
        <NumberInput label={`1 ${input.quoteCurrency} = Group ${auth.activeCompany.reportingCurrency}`} value={input.exchangeRateToGroupCurrency} min={0.00000001} onChange={(v) => setInput({ ...input, exchangeRateToGroupCurrency: v, exchangeRateLockedAt: new Date().toISOString() })} />
      </div>
      {input.exchangeRateLockedAt && <div className="mt-4 text-xs text-slate-500">Exchange rate locked for this costing: {formatDateTime(input.exchangeRateLockedAt)}</div>}
    </div>
  );
}

function WorkPackagesStep({ input, setInput, rates, repairCatalog, calculations }: { input: ProjectInput; setInput: (input: ProjectInput) => void; rates: AdminRates; repairCatalog: RepairCatalog; calculations: ReturnType<typeof calculateProject> }) {
  const packages = input.workPackages;
  const active = packages.find((item) => item.id === input.activeWorkPackageId) ?? packages[0];
  const setPackages = (workPackages: RemedialWorkPackage[], activeWorkPackageId = input.activeWorkPackageId) => setInput({
    ...input,
    workPackages,
    activeWorkPackageId: workPackages.some((item) => item.id === activeWorkPackageId) ? activeWorkPackageId : workPackages[0]?.id ?? "",
    includeGrinding: workPackages.some((item) => item.service === "Grinding"),
    includeScreeding: workPackages.some((item) => item.service === "Screeding"),
    includeRepairs: workPackages.some((item) => item.service === "Repairs")
  });
  const patchPackage = (id: string, next: Partial<RemedialWorkPackage>) => setPackages(packages.map((item) => item.id === id ? { ...item, ...next } : item), id);
  const addPackage = (service: ProjectServiceKey) => {
    let index = 0;
    const usedCodes = new Set(packages.map((item) => item.code.trim().toLowerCase()));
    while (usedCodes.has(packageCode(index).toLowerCase())) index += 1;
    const added = createWorkPackage(service, input, index);
    setPackages([...packages, added], added.id);
  };
  const duplicatePackage = () => {
    if (!active) return;
    let index = 0;
    const usedCodes = new Set(packages.map((item) => item.code.trim().toLowerCase()));
    while (usedCodes.has(packageCode(index).toLowerCase())) index += 1;
    const base = createWorkPackage(active.service, input, index);
    const duplicate = { ...JSON.parse(JSON.stringify(active)) as RemedialWorkPackage, id: base.id, code: base.code, name: `${active.name} copy`, selected: true, startDay: 0 };
    setPackages([...packages, duplicate], duplicate.id);
  };
  const activeInput = active ? packageProjectInput(input, active) : null;
  const updateActiveInput = (next: ProjectInput) => active && setPackages(packages.map((item) => item.id === active.id ? updatePackageFromProjectInput(item, next) : item), active.id);
  const activeMaterialCalcs = activeInput ? calculateProjectRepairMaterials(activeInput.repairs.repairLines, repairCatalog) : [];
  const activeSummary = calculations.packageSummaries?.find((item) => item.id === active?.id);
  const activeRate = calculations.rateSchedules?.find((item) => item.workPackageId === active?.id);
  return <div className="grid gap-5">
    <div><h3 className="text-2xl font-bold text-slate-950">Selectable work packages</h3><p className="mt-1 text-sm text-slate-600">Price every option independently. Client package selection is confirmed later from the saved project Summary.</p></div>
    <div className="grid gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
      <aside className="grid content-start gap-3">
        <div className="app-card p-3"><div className="mb-2 text-[11px] font-black uppercase text-slate-500">Packages</div><div className="grid gap-2">{packages.map((item) => {
          const summary = calculations.packageSummaries?.find((row) => row.id === item.id);
          return <button className={`rounded-lg border p-3 text-left ${active?.id === item.id ? "border-sky-600 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"}`} onClick={() => setInput({ ...input, activeWorkPackageId: item.id })} key={item.id}><div className="flex items-center justify-between gap-2"><b>{item.code}. {item.name}</b><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-600">{item.service}</span></div><div className="mt-2 flex justify-between text-xs text-slate-500"><span>{item.pricingBasis === "day_rate" ? "Day rate" : "Fixed price"}</span><b className="text-slate-800">{money(summary?.proposalTotal ?? 0)}</b></div></button>;
        })}{!packages.length && <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">Add the first package below.</div>}</div></div>
        <div className="app-card p-3"><div className="mb-2 text-[11px] font-black uppercase text-slate-500">Add package</div><div className="grid gap-2">{(["Repairs", "Grinding", "Screeding"] as ProjectServiceKey[]).map((service) => <button className="secondary-button justify-start" key={service} onClick={() => addPackage(service)}>Add {service}</button>)}</div></div>
      </aside>
      <div className="grid min-w-0 gap-5">
        {active && activeInput ? <>
          <section className="app-card-strong"><div className="panel-heading flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-black uppercase text-sky-700">Package {active.code}</div><h3 className="mt-1 text-xl font-semibold">{active.name}</h3></div><div className="flex flex-wrap gap-2"><button className="secondary-button" onClick={duplicatePackage}>Duplicate</button><button className="secondary-button border-red-200 text-red-700" onClick={() => { if (window.confirm(`Remove package ${active.code}. ${active.name} and all of its costing data?`)) setPackages(packages.filter((item) => item.id !== active.id)); }}>Remove</button></div></div><div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4"><Text label="Package Code" value={active.code} onChange={(code) => patchPackage(active.id, { code })} /><Text label="Package Name" value={active.name} onChange={(name) => patchPackage(active.id, { name })} /><Select label="Pricing Basis" value={active.pricingBasis === "day_rate" ? "Day Rate" : "Fixed Price"} options={active.service === "Grinding" ? ["Fixed Price", "Day Rate"] : ["Fixed Price"]} onChange={(value) => patchPackage(active.id, { pricingBasis: value === "Day Rate" ? "day_rate" : "fixed" })} /><Toggle label="Mobilisation already included in another package" checked={active.mobilisationMode !== "separate"} onChange={(includedElsewhere) => patchPackage(active.id, { mobilisationMode: includedElsewhere ? "shared" : "separate" })} /><div className="sm:col-span-2 xl:col-span-4"><Text label="Package Description" value={active.description} onChange={(description) => patchPackage(active.id, { description })} /></div><p className="text-xs font-semibold text-slate-500 sm:col-span-2 xl:col-span-4">Leave the mobilisation box unticked unless the same internal team journey has already been included in another package. Subcontractor mobilisation always remains with its subcontract package.</p></div></section>
          {active.pricingBasis === "day_rate" && <section className="app-card-strong"><div className="panel-heading"><h3 className="text-xl font-semibold">Commercial rate schedule</h3><p className="text-sm text-slate-500">The productive and stand-down rates are calculated from the detailed package. Overrides remain visible and require a reason.</p></div><div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4"><Mini label="Calculated Productive / Day" value={money(activeRate?.productiveProposalRate ?? 0)} /><Mini label="Mobilisation" value={money(activeRate?.mobilisationProposal ?? 0)} /><Mini label="Calculated Stand-Down / Day" value={money(activeRate?.standbyProposalRate ?? 0)} /><NumberInput label="Expected Stand-Down Days" value={active.expectedStandDownDays} onChange={(expectedStandDownDays) => patchPackage(active.id, { expectedStandDownDays })} /><NumberInput label="Productive Rate Override" value={active.productiveRateOverride ?? activeRate?.productiveProposalRate ?? 0} onChange={(value) => patchPackage(active.id, { productiveRateOverride: value === activeRate?.productiveProposalRate ? null : value })} /><NumberInput label="Stand-Down Rate Override" value={active.standbyRateOverride ?? activeRate?.standbyProposalRate ?? 0} onChange={(value) => patchPackage(active.id, { standbyRateOverride: value === activeRate?.standbyProposalRate ? null : value })} /><div className="sm:col-span-2"><Text label="Override Reason" value={active.rateOverrideReason} onChange={(rateOverrideReason) => patchPackage(active.id, { rateOverrideReason })} /></div></div></section>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Package Proposal" value={money(activeSummary?.proposalTotal ?? 0)} /><Metric label="Package Budget" value={money(activeSummary?.budgetCost ?? 0)} /><Metric label="Markup" value={percent(activeSummary?.budgetMarkup ?? 0)} /><Metric label="Duration" value={`${activeSummary?.days ?? 0} days`} /></div>
          {active.service === "Grinding" && <GrindingForm input={activeInput} setInput={updateActiveInput} rates={rates} showStandby={active.pricingBasis === "day_rate"} />}
          {active.service === "Screeding" && <ScreedForm input={activeInput} setInput={updateActiveInput} rates={rates} />}
          {active.service === "Repairs" && <RepairsForm input={activeInput} setInput={updateActiveInput} repairCatalog={repairCatalog} rates={rates} projectMaterialCalcs={activeMaterialCalcs} />}
          <AdditionalItems title={`${active.code}. ${active.name} additional items`} items={active.additionalItems} onChange={(additionalItems) => patchPackage(active.id, { additionalItems })} />
        </> : <div className="app-card p-8 text-center text-sm text-slate-500">Add a package to begin pricing.</div>}
      </div>
    </div>
    <AdditionalItems title="Project-Wide Additional Costs" items={input.sharedCosts} onChange={(sharedCosts) => setInput({ ...input, sharedCosts })} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="All Options Offered" value={money(calculations.allOptionsProposalTotal ?? calculations.proposalTotal)} /><Metric label="Mobilisation Sell" value={money(calculations.mobilisationRate)} /><Metric label="Mobilisation Budget" value={money(calculations.mobilisationBudget ?? 0)} /><Metric label="Packages" value={String(packages.length)} /></div>
  </div>;
}

function PhaseScheduleStep({ input, setInput, repairCatalog, calculations }: { input: ProjectInput; setInput: (input: ProjectInput) => void; repairCatalog: RepairCatalog; calculations: ReturnType<typeof calculateProject> }) {
  if (input.pricingMode === "selectable") {
    const rows = calculations.phaseRows ?? [];
    const maxDay = Math.max(1, ...rows.map((row) => row.endDay));
    let automaticStart = 1;
    return <div className="grid gap-5"><div><h3 className="text-2xl font-bold text-slate-950">Package programme</h3><p className="mt-1 text-sm text-slate-600">Durations come from each package. Leave start day at 0 for automatic sequencing, or enter a day to create an overlap.</p></div><div className="grid gap-4">{input.workPackages.map((item) => {
      const row = rows.find((candidate) => candidate.workPackageId === item.id);
      const autoForThis = automaticStart;
      automaticStart += row?.calculatedDays ?? 0;
      return <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[minmax(190px,1fr)_140px_180px_180px] lg:items-center" key={item.id}><div><div className="font-bold text-slate-950">{item.code}. {item.name}</div><div className="text-xs text-slate-500">{item.service}</div></div><Mini label="Duration" value={`${row?.calculatedDays ?? 0} days`} /><NumberInput label="Start Day (0 = automatic)" value={item.startDay} onChange={(startDay) => setInput({ ...input, workPackages: input.workPackages.map((candidate) => candidate.id === item.id ? { ...candidate, startDay: Math.max(0, Math.ceil(startDay)) } : candidate) })} /><Mini label="Programme" value={row?.calculatedDays ? `Day ${row.startDay || autoForThis} to ${row.endDay}` : "No days entered"} /></div>;
    })}</div><div className="grid gap-4 rounded-xl border border-sky-200 bg-sky-50 p-4 sm:grid-cols-2"><Mini label="Overall Project Duration" value={`${calculations.siteDays} days`} /><Mini label="Overlap" value={rows.some((row) => row.concurrent) ? "Packages overlap" : "Sequential"} /></div></div>;
  }
  const schedule = calculatePhaseSchedule(input, repairCatalog);
  const maxDay = Math.max(1, schedule.calculatedProjectDays);
  return (
    <div className="grid gap-5">
      <div><h3 className="text-2xl font-bold text-slate-950">Phase programme</h3><p className="mt-1 text-sm text-slate-600">Durations come directly from each costing sheet. Set the start day to sequence or overlap services.</p></div>
      <div className="grid gap-4">
        {schedule.rows.map((row) => (
          <div key={row.service} className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[170px_140px_minmax(240px,1fr)_160px] lg:items-center">
            <div><div className="text-lg font-bold text-slate-950">{row.service}</div><div className="text-xs font-semibold text-slate-500">From costing sheet</div></div>
            <Mini label="Duration" value={`${row.calculatedDays} days`} />
            <div>
              <NumberInput label="Start Day" value={row.startDay} onChange={(value) => setInput({ ...input, phaseSchedule: { ...input.phaseSchedule, startDays: { ...input.phaseSchedule.startDays, [row.service]: Math.max(1, Math.ceil(value)) } } })} />
              <input aria-label={`${row.service} start day`} className="mt-2 h-2 w-full cursor-pointer accent-sky-700" type="range" min="1" max={Math.max(maxDay + 10, row.startDay)} step="1" value={row.startDay} onChange={(event) => setInput({ ...input, phaseSchedule: { ...input.phaseSchedule, startDays: { ...input.phaseSchedule.startDays, [row.service]: Number(event.target.value) } } })} />
            </div>
            <Mini label="Programme" value={row.calculatedDays ? `Day ${row.startDay} to ${row.endDay}` : "No days entered"} />
          </div>
        ))}
      </div>
      <div className="grid gap-4 rounded-xl border border-sky-200 bg-sky-50 p-4 sm:grid-cols-2">
        <Mini label="Overall Project Duration" value={`${schedule.projectDays} days`} />
        <Mini label="Overlap" value={schedule.rows.some((row) => row.concurrent) ? "Phases overlap" : "Sequential"} />
      </div>
    </div>
  );
}

type InternalTravelFormValue = {
  mode: TravelMode;
  travelDays: number;
  primaryOneWay: number;
  secondaryOneWay: number;
  vehicles: number;
  returnFlights: number;
  airportTransport: AirportTransport;
  airportTransferReturns: number;
  airportParkingDays: number;
  destinationTransport: DestinationTransport;
  rentalVehicles: number;
  rentalVehicleDays: number;
};

function InternalTravelFields({ value, officeCount, distanceUnit, people, journeys = 1, onChange }: { value: InternalTravelFormValue; officeCount: ProjectInput["officeCount"]; distanceUnit: ProjectInput["distanceUnit"]; people: number; journeys?: number; onChange: (next: Partial<InternalTravelFormValue>) => void }) {
  const returnFlights = effectiveReturnFlights(value.returnFlights, people);
  const airportReturns = value.airportTransferReturns || 1;
  const journeyDistance = chargeableJourneyDistance(officeCount, value.primaryOneWay, value.secondaryOneWay, value.vehicles, journeys);
  return <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Select label="Travel Method" value={value.mode} options={["None", "Drive", "Fly"]} onChange={(mode) => onChange({ mode: mode as TravelMode })} />
      {value.mode !== "None" && <NumberInput label="Travel Days" value={value.travelDays} onChange={(travelDays) => onChange({ travelDays })} />}
      {value.mode === "None" && <div className="sm:col-span-1 xl:col-span-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">No internal travel cost will be added. Hidden drive and flight inputs are ignored.</div>}
    </div>
    {value.mode === "Drive" && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <NumberInput label={`${officeCount === 2 ? "Primary Office to Site" : "Office to Site"} (${distanceUnit})`} value={value.primaryOneWay} onChange={(primaryOneWay) => onChange({ primaryOneWay })} />
      {officeCount === 2 && <NumberInput label={`Site to Secondary Office (${distanceUnit})`} value={value.secondaryOneWay} onChange={(secondaryOneWay) => onChange({ secondaryOneWay })} />}
      <NumberInput label="Vehicles / Vans" value={value.vehicles} step={1} onChange={(vehicles) => onChange({ vehicles })} />
      <Mini label={`Chargeable ${distanceUnit}`} value={`${journeyDistance}`} />
    </div>}
    {value.mode === "Fly" && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Mini label="People Flying" value={`${people}`} />
        <div className={value.returnFlights > 0 && value.returnFlights !== people ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Return Flights" value={returnFlights} step={1} onChange={(returnFlights) => onChange({ returnFlights: returnFlights === people ? 0 : returnFlights })} />{value.returnFlights > 0 && <button className="mt-2 text-xs font-bold text-sky-700" onClick={() => onChange({ returnFlights: 0 })}>Reset to people flying ({people})</button>}</div>
        <Select label="Home Airport Transport" value={value.airportTransport} options={["N/A", "Drive", "Uber"]} onChange={(airportTransport) => onChange({ airportTransport: airportTransport as AirportTransport })} />
        {value.airportTransport === "Drive" && <NumberInput label="Airport Vehicles" value={value.vehicles} step={1} onChange={(vehicles) => onChange({ vehicles })} />}
        {value.airportTransport === "Drive" && <NumberInput label="Airport Parking Days" value={value.airportParkingDays} step={1} onChange={(airportParkingDays) => onChange({ airportParkingDays })} />}
        {value.airportTransport === "Uber" && <NumberInput label="Return Airport Transfers" value={airportReturns} step={1} onChange={(airportTransferReturns) => onChange({ airportTransferReturns: airportTransferReturns === 1 ? 0 : airportTransferReturns })} />}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Select label="Destination Transport" value={value.destinationTransport} options={["None", "Rental Car", "Rental Van"]} onChange={(destinationTransport) => onChange({ destinationTransport: destinationTransport as DestinationTransport })} />
        {value.destinationTransport !== "None" && <NumberInput label="Rental Vehicles" value={value.rentalVehicles || 1} step={1} onChange={(rentalVehicles) => onChange({ rentalVehicles })} />}
        {value.destinationTransport !== "None" && <NumberInput label="Rental Vehicle Days" value={value.rentalVehicleDays} step={1} onChange={(rentalVehicleDays) => onChange({ rentalVehicleDays })} />}
      </div>
    </>}
  </div>;
}

function ProjectManagementStep({ input, setInput, rates }: { input: ProjectInput; setInput: (input: ProjectInput) => void; rates: AdminRates }) {
  const pm = input.projectManagement;
  const patch = (next: Partial<typeof pm>) => setInput({ ...input, projectManagement: { ...pm, ...next } });
  const sell = (rate: number, quantity: number, key: keyof AdminRates, fallback: number) => rate * quantity * (1 + adminRateMargin(rates, key, fallback));
  const labourSell = sell(rates.projectManagerDayRate, pm.days, "projectManagerDayRate", rates.defaultMargin);
  const pmMileage = chargeableJourneyDistance(input.officeCount, pm.oneWayKm, pm.secondaryOneWayKm, pm.vehicles, pm.visits);
  const travelSell = pm.travelMode === "None" ? 0 : sell(rates.otherInternalTravelDayRate, pm.travelDays, "otherInternalTravelDayRate", rates.travelMargin)
    + (pm.travelMode === "Drive" ? sell(rates.mileagePerKm, pmMileage, "mileagePerKm", rates.travelMargin) : 0)
    + (pm.travelMode === "Fly" ? sell(rates.returnFlight, effectiveReturnFlights(pm.returnFlights, 1), "returnFlight", rates.flightMargin)
      + (pm.airportTransport === "Uber" ? sell(rates.airportUberReturn, pm.airportTransferReturns || 1, "airportUberReturn", rates.travelMargin) : 0)
      + (pm.airportTransport === "Drive" ? sell(rates.airportParkingPerDay, pm.airportParkingDays * Math.max(1, pm.vehicles), "airportParkingPerDay", rates.travelMargin) : 0)
      + (pm.destinationTransport === "Rental Car" ? sell(rates.rentalCar, Math.max(1, pm.rentalVehicles) * pm.rentalVehicleDays, "rentalCar", rates.travelMargin) : 0)
      + (pm.destinationTransport === "Rental Van" ? sell(rates.rentalVan, Math.max(1, pm.rentalVehicles) * pm.rentalVehicleDays, "rentalVan", rates.travelMargin) : 0) : 0);
  const staySell = sell(rates.hotel, pm.hotelNights, "hotel", rates.hotelMargin) + sell(rates.subsistence, pm.hotelNights, "subsistence", rates.subsistenceMargin);
  return (
    <div className="grid gap-5">
      <div><h3 className="text-2xl font-bold text-slate-950">Project management</h3><p className="mt-1 text-sm text-slate-600">Whole-project management is entered once here, even when several services are included.</p></div>
      <Toggle label="Include Project Management" checked={pm.enabled} onChange={(enabled) => patch({ enabled })} />
      {!pm.enabled ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No project-management cost will be added.</div> : <div className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <NumberInput label="Project Manager Days" value={pm.days} onChange={(days) => patch({ days })} />
          <NumberInput label="Number of Visits" value={pm.visits} onChange={(visits) => patch({ visits })} />
          <Mini label="Labour Sell" value={money(labourSell)} />
        </div>
        <InternalTravelFields officeCount={input.officeCount} distanceUnit={input.distanceUnit} people={1} journeys={pm.visits} value={{ mode: pm.travelMode, travelDays: pm.travelDays, primaryOneWay: pm.oneWayKm, secondaryOneWay: pm.secondaryOneWayKm, vehicles: pm.vehicles, returnFlights: pm.returnFlights, airportTransport: pm.airportTransport, airportTransferReturns: pm.airportTransferReturns, airportParkingDays: pm.airportParkingDays, destinationTransport: pm.destinationTransport, rentalVehicles: pm.rentalVehicles, rentalVehicleDays: pm.rentalVehicleDays }} onChange={(next) => patch({ travelMode: next.mode ?? pm.travelMode, travelDays: next.travelDays ?? pm.travelDays, oneWayKm: next.primaryOneWay ?? pm.oneWayKm, secondaryOneWayKm: next.secondaryOneWay ?? pm.secondaryOneWayKm, vehicles: next.vehicles ?? pm.vehicles, returnFlights: next.returnFlights ?? pm.returnFlights, airportTransport: next.airportTransport ?? pm.airportTransport, airportTransferReturns: next.airportTransferReturns ?? pm.airportTransferReturns, airportParkingDays: next.airportParkingDays ?? pm.airportParkingDays, destinationTransport: next.destinationTransport ?? pm.destinationTransport, rentalVehicles: next.rentalVehicles ?? pm.rentalVehicles, rentalVehicleDays: next.rentalVehicleDays ?? pm.rentalVehicleDays })} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><NumberInput label="Hotel Nights" value={pm.hotelNights} onChange={(hotelNights) => patch({ hotelNights })} /></div>
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
          <Mini label="Travel Sell" value={money(travelSell)} />
          <Mini label="Hotel + Subsistence Sell" value={money(staySell)} />
          <Mini label="Total Project Management Sell" value={money(labourSell + travelSell + staySell)} />
        </div>
      </div>}
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
        <p className="mt-1 text-sm text-slate-600">Use this for extras that belong to the whole project, not just repairs, grinding or screeding. Pick the P&L category so the cost reports correctly later.</p>
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
    calculations.proposalTotal && overallExactMarkup < 25 ? `Overall markup is ${percent(overallExactMarkup)}, below 25%.` : "",
    ...categoryRows
      .filter((row) => row.budget > 0 && row.markup < 25)
      .map((row) => `${row.category} markup is ${percent(row.markup)}, below 25%.`)
  ].filter(Boolean);
  return (
    <div className="grid gap-5">
      <div>
        <h3 className="text-2xl font-bold text-slate-950">Commercial review</h3>
        <p className="mt-1 text-sm text-slate-600">Check the service totals, markup, optional bonus and discount before saving.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={input.pricingMode === "selectable" ? "All Options Offered" : "Proposal"} value={money(calculations.proposalTotal)} />
        <Metric label="Budget" value={money(calculations.budgetCost)} />
        <Metric label="Markup" value={percent(calculations.budgetMarkup)} />
        <Metric label="Site Days" value={String(calculations.siteDays)} />
      </div>
      <RemedialRateSummary calculations={calculations} />
      {input.pricingMode === "selectable" && <>
        <div className="grid gap-4 sm:grid-cols-2"><Metric label="Project-Wide Costs" value={money(calculations.commonProposalTotal ?? 0)} /><Metric label="Packages Offered" value={String(calculations.packageSummaries?.length ?? 0)} /></div>
        <div className="table-shell"><table><thead><tr><th>Package</th><th>Service</th><th>Basis</th><th>Status</th><th>Budget</th><th>Proposal</th><th>Markup</th></tr></thead><tbody>{calculations.packageSummaries?.map((item) => <tr key={item.id}><td className="font-bold">{item.code}. {item.name}</td><td>{item.service}</td><td>{item.pricingBasis === "day_rate" ? "Day rate" : "Fixed price"}</td><td>Offered</td><td>{money(item.budgetCost)}</td><td>{money(item.proposalTotal)}</td><td className={item.budgetMarkup < 25 ? "font-bold text-amber-700" : "font-bold text-emerald-700"}>{percent(item.budgetMarkup)}</td></tr>)}</tbody></table></div>
      </>}
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
            {(markupWarnings.length > 0 || input.discountPercentage > 0) && <div className="mt-4"><Text label="Reason for low markup or discount" value={input.markupOverrideReason} onChange={(markupOverrideReason) => setInput({ ...input, markupOverrideReason })} /></div>}
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Discount is applied across proposal lines. Budget cost is not discounted.</div>
        </div>
      </div>
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
              {!categoryRows.length && <tr><td colSpan={6} className="text-slate-500">No active costing lines yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <LineTable lines={calculations.proposalLines} />
    </div>
  );
}

function RemedialRateSummary({ calculations }: { calculations: ReturnType<typeof calculateProject> }) {
  const schedules = calculations.rateSchedules ?? [];
  const productiveRate = schedules.length > 1 ? "Per package below" : schedules.length === 1 ? money(schedules[0].productiveProposalRate) : calculations.pricingMode === "selectable" ? "Fixed price" : money(calculations.dailyRate);
  const standbyRate = schedules.length > 1 ? "Per package below" : schedules.length === 1 ? money(schedules[0].standbyProposalRate) : "Not scheduled";
  return <div className="app-card p-4">
    <div className="mb-3"><h4 className="font-bold text-slate-950">Remedial Commercial Rates</h4><p className="text-sm text-slate-500">Client-facing productive, mobilisation and stand-down rates calculated from this costing.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Mini label="Productive / Day" value={productiveRate} />
      <Mini label="Mobilisation Sell" value={money(calculations.mobilisationRate)} />
      <Mini label="Mobilisation Budget" value={money(calculations.mobilisationBudget ?? 0)} />
      <Mini label="Stand-Down / Day" value={standbyRate} />
    </div>
    {!!schedules.length && <div className="table-shell mt-4"><table><thead><tr><th>Rate Schedule</th><th>Productive / Day</th><th>Mobilisation</th><th>Stand-Down / Day</th><th>Expected Stand-Down</th><th>Basis</th></tr></thead><tbody>{schedules.map((row) => <tr key={row.workPackageId ?? row.workPackageName}><td className="font-bold">{row.workPackageCode ? `${row.workPackageCode}. ` : ""}{row.workPackageName}</td><td>{money(row.productiveProposalRate)}</td><td>{money(row.mobilisationProposal)}</td><td>{money(row.standbyProposalRate)}</td><td>{row.expectedStandDownDays} days</td><td>{row.productiveRateOverridden || row.standbyRateOverridden ? row.overrideReason || "Override reason required" : "Calculated"}</td></tr>)}</tbody></table></div>}
  </div>;
}

function QuoteSummary({ calculations }: { calculations: ReturnType<typeof calculateProject> }) {
  const lowMarkup = calculations.proposalTotal > 0 && calculations.budgetCost > 0 && calculations.budgetProfit / calculations.budgetCost < 0.25;
  const scheduleCount = calculations.rateSchedules?.length ?? 0;
  return (
    <div className="app-card-strong">
      <div className="panel-heading">
        <div className="flex items-center gap-2 text-sm font-bold uppercase text-slate-500"><Calculator size={16} /> Live Costing</div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <SummaryRow label="Proposal" value={money(calculations.proposalTotal)} strong />
        <SummaryRow label="Budget" value={money(calculations.budgetCost)} />
        <SummaryRow label={lowMarkup ? "Markup - Review" : "Markup"} value={percent(calculations.budgetMarkup)} alert={lowMarkup} />
        <SummaryRow label="Site Days" value={String(calculations.siteDays)} />
        <SummaryRow label="Productive / Day" value={scheduleCount > 1 ? "Per package" : money(scheduleCount === 1 ? calculations.rateSchedules![0].productiveProposalRate : calculations.dailyRate)} />
        <SummaryRow label="Mobilisation" value={money(calculations.mobilisationRate)} />
        <SummaryRow label="Stand-Down / Day" value={scheduleCount > 1 ? "Per package" : scheduleCount === 1 ? money(calculations.rateSchedules![0].standbyProposalRate) : "Not scheduled"} />
        <SummaryRow label="Haulage" value={money(calculations.haulageTotal ?? 0)} />
      </div>
    </div>
  );
}

function SummaryRow({ label, value, strong = false, alert = false }: { label: string; value: string; strong?: boolean; alert?: boolean }) {
  return <div className={`min-w-0 rounded-lg border px-3 py-3 ${alert ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-white"}`}><span className={`block text-xs font-bold uppercase ${alert ? "text-amber-700" : "text-slate-500"}`}>{label}</span><b className={`mt-1 block break-words ${strong ? "text-xl text-sky-800" : alert ? "text-base text-amber-950" : "text-base text-slate-950"}`}>{value}</b></div>;
}

function DetailTabs({ tab, setTab, input }: { tab: DetailTab; setTab: (tab: DetailTab) => void; input: ProjectInput }) {
  const visibleTabs = detailTabs.filter((item) => tabIsAllowed(item, input));
  return <div className="flex flex-wrap gap-2 rounded-xl bg-white p-2 shadow-sm">{visibleTabs.map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-md px-3 py-2 text-sm font-bold ${tab === item ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-800"}`}>{item === "PM Handover" ? "Delivery Summary" : item === "Activity" ? "Notes & History" : item}</button>)}</div>;
}

function GrindingForm({ input, setInput, rates, showStandby = false }: { input: ProjectInput; setInput: (input: ProjectInput) => void; rates: AdminRates; showStandby?: boolean }) {
  const g = input.grinding;
  const [grindingPage, setGrindingPageState] = useState<GrindingPage>(input.uiProgress?.grindingPage ?? "Programme");
  const patch = (next: Partial<typeof g>) => setInput({ ...input, grinding: { ...g, ...next } });
  const setGrindingPage = (page: GrindingPage) => {
    setGrindingPageState(page);
    setInput({ ...input, uiProgress: { ...input.uiProgress, grindingPage: page } });
    scrollToCostingSection();
  };
  const estimatedDays = g.estimatedDays;
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
  const calculatedProductionWeekendDays = weekendDaysForProgramme(productionDays, 5, g.weekendDaysPerWeek);
  const calculatedSurveyorWeekendDays = weekendDaysForProgramme(surveyorDays, 5, g.weekendDaysPerWeek);
  const calculatedProductionHotelNights = calculatedHotelNights(productionDays, g.weekendDaysPerWeek, g.productionTravelMode === "None" ? 0 : g.productionTravelDays);
  const calculatedSurveyorHotelNights = calculatedHotelNights(surveyorDays, g.weekendDaysPerWeek, g.surveyorTravelMode === "None" ? 0 : g.surveyorTravelDays);
  const productionHotelNights = g.productionHotelNights || calculatedProductionHotelNights;
  const surveyorHotelNights = g.surveyorHotelNights || calculatedSurveyorHotelNights;
  const productionSubcontractSell = repairSubcontractorSell(g.productionSubcontractors);
  const surveyorSubcontractSell = repairSubcontractorSell(g.surveyorSubcontractors);
  const productionLabourSell = usesProductionInHouse ? g.productionMen * productionDays * rates.productionLabourDayRate * (1 + adminRateMargin(rates, "productionLabourDayRate", rates.defaultMargin)) : 0;
  const surveyorLabourSell = usesSurveyorInHouse ? (
    g.surveyorCount * surveyorDays * rates.grindingSurveyorDayRate * (1 + adminRateMargin(rates, "grindingSurveyorDayRate", 0)) +
    g.surveyorCount * calculatedSurveyorWeekendDays * rates.grindingSurveyorWeekendDayRate * (1 + adminRateMargin(rates, "grindingSurveyorWeekendDayRate", rates.defaultMargin)) +
    (g.nightShiftRequired ? g.surveyorCount * g.surveyorNightShifts * rates.surveyorNightShiftAllowance * (1 + adminRateMargin(rates, "surveyorNightShiftAllowance", rates.defaultMargin)) : 0)
  ) : 0;
  const toolDays = usesProductionInHouse ? productionDays : 0;
  const grinderDays = g.productionMen * toolDays;
  const planerDays = g.gasPlaners * toolDays;
  const vacuumDays = g.dustVacuums * toolDays;
  const generatorDays = (g.generatorRequired ? g.generatorCount * toolDays : 0) + (g.largeGeneratorRequired ? toolDays : 0);
  const toolSell = usesProductionInHouse ? (
    (g.generatorRequired ? rates.grindingSmallGeneratorDayRate * g.generatorCount * toolDays * (1 + adminRateMargin(rates, "grindingSmallGeneratorDayRate", rates.equipmentMargin)) : 0) +
    (g.largeGeneratorRequired ? ((g.largeGeneratorRate * toolDays) + g.largeGeneratorDelivery + g.largeGeneratorCollection) * (1 + rates.equipmentMargin) : 0) +
    (grinderDays * rates.grindingGrinderDayRate * (1 + adminRateMargin(rates, "grindingGrinderDayRate", rates.equipmentMargin))) +
    (g.gasPlaners * toolDays * rates.grindingPlanerDayRate * (1 + adminRateMargin(rates, "grindingPlanerDayRate", rates.equipmentMargin))) +
    (g.dustVacuums * toolDays * rates.grindingDustVacuumDayRate * (1 + adminRateMargin(rates, "grindingDustVacuumDayRate", rates.equipmentMargin))) +
    (g.grindingSegmentsRequired ? grinderDays * rates.grindingSegmentsDayRate * (1 + adminRateMargin(rates, "grindingSegmentsDayRate", rates.equipmentMargin)) : 0) +
    (g.extensionCordsRequired ? toolDays * rates.grindingExtensionCordsDayRate * (1 + adminRateMargin(rates, "grindingExtensionCordsDayRate", rates.equipmentMargin)) : 0) +
    (g.consumablesRequired ? grinderDays * rates.grindingConsumablesDayRate * (1 + adminRateMargin(rates, "grindingConsumablesDayRate", rates.equipmentMargin)) : 0) +
    (g.equipmentShipping ? g.equipmentShipping * (1 + g.equipmentShippingMargin) : 0) +
    g.additionalTools.reduce((sum, item) => sum + item.rate * (1 + item.margin), 0)
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
          <Mini label="Sense Checks" value={readiness.blockers.length + readiness.warnings.length ? `${readiness.blockers.length + readiness.warnings.length} flagged` : "Clear"} />
        </div>
      </div>
      {readiness.blockers.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="mb-2 font-bold uppercase">Grinding sense checks</div><div className="grid gap-1">{readiness.blockers.slice(0, 8).map((warning) => <div key={warning}>{warning}</div>)}</div></div>}
      {!readiness.blockers.length && readiness.warnings.length > 0 && <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><div className="mb-2 font-bold uppercase">Grinding review notes</div><div className="grid gap-1">{readiness.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div></div>}
      <GrindingPageTabs grindingPage={grindingPage} setGrindingPage={setGrindingPage} />
      {grindingPage === "Programme" && <>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Grinding Programme</h2><p className="text-sm text-slate-500">Set the expected site duration first. These days drive default labour, surveyor and equipment quantities.</p></div>
          <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
            <NumberInput label="Estimated Grinding Days" value={g.estimatedDays} onChange={(v) => patch({ estimatedDays: v })} />
            <NumberInput label="Weekend Days Worked Per Week" value={g.weekendDaysPerWeek} max={2} step={1} onChange={(v) => patch({ weekendDaysPerWeek: v, productionWeekendDays: v, surveyorWeekendDays: v })} />
            <Toggle label="Night Shifts" checked={g.nightShiftRequired} onChange={(v) => patch({ nightShiftRequired: v })} />
            {g.nightShiftRequired && <NumberInput label="Number of Night Shifts" value={g.nightShifts} onChange={(v) => patch({ nightShifts: v, productionNightShifts: v, surveyorNightShifts: v })} />}
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
        {usesProductionSubcontract && <SubcontractLabourPanel items={g.productionSubcontractors} calculatedDays={estimatedDays} onChange={(items) => patch({ productionSubcontractors: items })} title="Grinding Production Subcontractors" description="Add each grinding subcontractor separately. Their price should include labour, equipment and normal grinding tools." addLabel="Add Grinding Subcontractor" defaultName="Grinding subcontractor" showStandby={showStandby} />}
        {usesProductionInHouse && <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">In-House Grinding Labour</h2><p className="text-sm text-slate-500">Uses the shared production labour rates from Admin. Hotel nights are per team, then multiplied by men.</p></div>
          <div className="grid gap-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Estimated Days" value={`${estimatedDays}`} />
              <div className={productionDaysOverridden ? "rounded-lg border border-amber-200 bg-amber-50 p-3" : ""}><NumberInput label="Inputted Production Days" value={productionDays} onChange={(v) => patch({ productionLabourDays: v })} /></div>
              <NumberInput label="Production Men" value={g.productionMen} step={1} onChange={(v) => patch({ productionMen: v, grindersOnSite: v })} />
              <Mini label="Production Labour Sell" value={money(productionLabourSell)} />
            </div>
            {productionDaysOverridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Production labour days overridden from {estimatedDays} to {productionDays}.</div>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Weekend Days On Project" value={`${calculatedProductionWeekendDays}`} />
              <NumberInput label="Night Shifts" value={g.productionNightShifts} step={1} onChange={(v) => patch({ productionNightShifts: v })} />
              <Toggle label="Hotel / Subsistence" checked={g.productionHotelRequired} onChange={(v) => patch({ productionHotelRequired: v })} />
              {g.productionHotelRequired && <div className={g.productionHotelNights > 0 && g.productionHotelNights !== calculatedProductionHotelNights ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Hotel Nights Per Team" value={productionHotelNights} step={1} onChange={(v) => patch({ productionHotelNights: v === calculatedProductionHotelNights ? 0 : v })} />{g.productionHotelNights > 0 && <button className="mt-2 text-xs font-bold text-sky-700" onClick={() => patch({ productionHotelNights: 0 })}>Reset to calculated {calculatedProductionHotelNights}</button>}</div>}
            </div>
            <InternalTravelFields officeCount={input.officeCount} distanceUnit={input.distanceUnit} people={g.productionMen} value={{ mode: g.productionTravelMode, travelDays: g.productionTravelDays, primaryOneWay: g.productionOneWayKm, secondaryOneWay: g.productionSecondaryOneWayKm, vehicles: g.productionVehicles, returnFlights: g.productionReturnFlights, airportTransport: g.productionAirportTransport, airportTransferReturns: g.productionAirportTransferReturns, airportParkingDays: g.productionAirportParkingDays, destinationTransport: g.productionDestinationTransport, rentalVehicles: g.productionRentalVehicles, rentalVehicleDays: g.productionRentalVehicleDays }} onChange={(next) => patch({ productionTravelMode: next.mode ?? g.productionTravelMode, productionTravelDays: next.travelDays ?? g.productionTravelDays, productionOneWayKm: next.primaryOneWay ?? g.productionOneWayKm, productionSecondaryOneWayKm: next.secondaryOneWay ?? g.productionSecondaryOneWayKm, productionVehicles: next.vehicles ?? g.productionVehicles, productionReturnFlights: next.returnFlights ?? g.productionReturnFlights, productionAirportTransport: next.airportTransport ?? g.productionAirportTransport, productionAirportTransferReturns: next.airportTransferReturns ?? g.productionAirportTransferReturns, productionAirportParkingDays: next.airportParkingDays ?? g.productionAirportParkingDays, productionDestinationTransport: next.destinationTransport ?? g.productionDestinationTransport, productionRentalVehicles: next.rentalVehicles ?? g.productionRentalVehicles, productionRentalVehicleDays: next.rentalVehicleDays ?? g.productionRentalVehicleDays })} />
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
        {usesSurveyorSubcontract && <SubcontractLabourPanel items={g.surveyorSubcontractors} calculatedDays={estimatedDays} onChange={(items) => patch({ surveyorSubcontractors: items })} title="Surveyor Subcontractors" description="Add subcontracted surveyor/supervisor support separately from production subcontractors." addLabel="Add Surveyor Subcontractor" defaultName="Surveyor subcontractor" showStandby={showStandby} />}
        {usesSurveyorInHouse && <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">In-House Surveyor Labour</h2><p className="text-sm text-slate-500">Uses the surveyor labour rates from Admin. Hotel nights are per team, then multiplied by surveyors.</p></div>
          <div className="grid gap-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Estimated Days" value={`${estimatedDays}`} />
              <div className={surveyorDaysOverridden ? "rounded-lg border border-amber-200 bg-amber-50 p-3" : ""}><NumberInput label="Inputted Surveyor Days" value={surveyorDays} onChange={(v) => patch({ surveyorDays: v })} /></div>
              <NumberInput label="Surveyors" value={g.surveyorCount} step={1} onChange={(v) => patch({ surveyorCount: v, surveyorsOnSite: v })} />
              <Mini label="Surveyor Labour Sell" value={money(surveyorLabourSell)} />
            </div>
            {surveyorDaysOverridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Surveyor days overridden from {estimatedDays} to {surveyorDays}.</div>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Weekend Days On Project" value={`${calculatedSurveyorWeekendDays}`} />
              <NumberInput label="Night Shifts" value={g.surveyorNightShifts} step={1} onChange={(v) => patch({ surveyorNightShifts: v })} />
              <Toggle label="Engineering Report" checked={g.engineeringReport} onChange={(v) => patch({ engineeringReport: v })} />
              <Toggle label="Hotel / Subsistence" checked={g.surveyorHotelRequired} onChange={(v) => patch({ surveyorHotelRequired: v })} />
              {g.surveyorHotelRequired && <div className={g.surveyorHotelNights > 0 && g.surveyorHotelNights !== calculatedSurveyorHotelNights ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Hotel Nights Per Team" value={surveyorHotelNights} onChange={(v) => patch({ surveyorHotelNights: v === calculatedSurveyorHotelNights ? 0 : v })} />{g.surveyorHotelNights > 0 && <button className="mt-2 text-xs font-bold text-sky-700" onClick={() => patch({ surveyorHotelNights: 0 })}>Reset to calculated {calculatedSurveyorHotelNights}</button>}</div>}
            </div>
            <InternalTravelFields officeCount={input.officeCount} distanceUnit={input.distanceUnit} people={g.surveyorCount} value={{ mode: g.surveyorTravelMode, travelDays: g.surveyorTravelDays, primaryOneWay: g.surveyorOneWayKm, secondaryOneWay: g.surveyorSecondaryOneWayKm, vehicles: g.surveyorVehicles, returnFlights: g.surveyorReturnFlights, airportTransport: g.surveyorAirportTransport, airportTransferReturns: g.surveyorAirportTransferReturns, airportParkingDays: g.surveyorAirportParkingDays, destinationTransport: g.surveyorDestinationTransport, rentalVehicles: g.surveyorRentalVehicles, rentalVehicleDays: g.surveyorRentalVehicleDays }} onChange={(next) => patch({ surveyorTravelMode: next.mode ?? g.surveyorTravelMode, surveyorTravelDays: next.travelDays ?? g.surveyorTravelDays, surveyorOneWayKm: next.primaryOneWay ?? g.surveyorOneWayKm, surveyorSecondaryOneWayKm: next.secondaryOneWay ?? g.surveyorSecondaryOneWayKm, surveyorVehicles: next.vehicles ?? g.surveyorVehicles, surveyorReturnFlights: next.returnFlights ?? g.surveyorReturnFlights, surveyorAirportTransport: next.airportTransport ?? g.surveyorAirportTransport, surveyorAirportTransferReturns: next.airportTransferReturns ?? g.surveyorAirportTransferReturns, surveyorAirportParkingDays: next.airportParkingDays ?? g.surveyorAirportParkingDays, surveyorDestinationTransport: next.destinationTransport ?? g.surveyorDestinationTransport, surveyorRentalVehicles: next.rentalVehicles ?? g.surveyorRentalVehicles, surveyorRentalVehicleDays: next.rentalVehicleDays ?? g.surveyorRentalVehicleDays })} />
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
              <Toggle label="10000 watt generator" checked={g.generatorRequired} onChange={(v) => patch({ generatorRequired: v, generatorCount: v ? g.generatorCount || 1 : 0 })} />
              {g.generatorRequired && <NumberInput label="10000 watt Generators On Site" value={g.generatorCount} step={1} onChange={(v) => patch({ generatorCount: v })} />}
              <Toggle label="Large Generator" checked={g.largeGeneratorRequired} onChange={(v) => patch({ largeGeneratorRequired: v })} />
              {g.largeGeneratorRequired && <NumberInput label="Large Generator Rate" value={g.largeGeneratorRate} onChange={(v) => patch({ largeGeneratorRate: v })} />}
              {g.largeGeneratorRequired && <NumberInput label="Delivery" value={g.largeGeneratorDelivery} onChange={(v) => patch({ largeGeneratorDelivery: v })} />}
              {g.largeGeneratorRequired && <NumberInput label="Collection" value={g.largeGeneratorCollection} onChange={(v) => patch({ largeGeneratorCollection: v })} />}
              <Mini label="Grinders" value={`${g.productionMen} men x ${toolDays} days = ${grinderDays}`} />
              <NumberInput label="Planers" value={g.gasPlaners} onChange={(v) => patch({ gasPlaners: v })} />
              <NumberInput label="Vacuums" value={g.dustVacuums} onChange={(v) => patch({ dustVacuums: v })} />
              <Toggle label="Extension Cords" checked={g.extensionCordsRequired} onChange={(v) => patch({ extensionCordsRequired: v })} />
              <Toggle label="Grinding Segments" checked={g.grindingSegmentsRequired} onChange={(v) => patch({ grindingSegmentsRequired: v })} />
              <Toggle label="Consumables" checked={g.consumablesRequired} onChange={(v) => patch({ consumablesRequired: v })} />
              <NumberInput label="Equipment Shipping" value={g.equipmentShipping} onChange={(v) => patch({ equipmentShipping: v })} />
              <NumberInput label="Shipping Markup %" value={g.equipmentShippingMargin * 100} onChange={(v) => patch({ equipmentShippingMargin: v / 100 })} />
            </div>
            <AdditionalTools items={g.additionalTools} onChange={(additionalTools) => patch({ additionalTools })} />
          </div>}
        </div>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Grinding Review</h2><p className="text-sm text-slate-500">Quick check before moving to the next costing section.</p></div>
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
  const [screedPage, setScreedPageState] = useState<ScreedPage>(input.uiProgress?.screedPage ?? "Programme");
  const patch = (next: Partial<typeof s>) => setInput({ ...input, screeding: { ...s, ...next } });
  const setScreedPage = (page: ScreedPage) => {
    setScreedPageState(page);
    setInput({ ...input, uiProgress: { ...input.uiProgress, screedPage: page } });
    scrollToCostingSection();
  };
  const updateTeam = (index: number, next: Partial<ScreedTeam>) => patch({ teams: s.teams.map((team, i) => i === index ? { ...team, ...next } : team) });
  const removeTeam = (index: number) => patch({ teams: s.teams.filter((_, i) => i !== index) });
  const screedDays = s.preparationDays + s.screedingDays + s.grindingDays;
  const addTeam = () => patch({ teams: [...s.teams, { enabled: true, contractorName: `Screed subcontractor ${s.teams.length + 1}`, scabble: false, prep: false, screed: true, grind: false, mobilisation: 0, mobilisationMargin: 0.3, priceType: "day", daysProgrammed: screedDays, preparationDays: 0, screedingDays: s.screedingDays, grindingDays: 0, rate: 0, margin: 0.3 }] });
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
  const calculatedProductionWeekendDays = weekendDaysForProgramme(productionDays, 5, s.weekendDaysPerWeek);
  const calculatedSurveyorWeekendDays = weekendDaysForProgramme(surveyorDays, 5, s.weekendDaysPerWeek);
  const calculatedProductionHotelNights = calculatedHotelNights(productionDays, s.weekendDaysPerWeek, s.productionTravelMode === "None" ? 0 : s.productionTravelDays);
  const calculatedSurveyorHotelNights = calculatedHotelNights(surveyorDays, s.weekendDaysPerWeek, s.surveyorTravelMode === "None" ? 0 : s.surveyorTravelDays);
  const productionHotelNights = s.productionHotelNights || calculatedProductionHotelNights;
  const surveyorHotelNights = s.surveyorHotelNights || calculatedSurveyorHotelNights;
  const productionSubcontractSell = s.teams.reduce((sum, team) => {
    const activityDays = (team.prep ? team.preparationDays : 0) + (team.screed ? team.screedingDays : 0) + (team.grind ? team.grindingDays : 0);
    const qty = team.priceType === "day" ? activityDays : team.rate ? 1 : 0;
    return sum + (team.mobilisation * (1 + (team.mobilisationMargin ?? rates.subcontractMargin))) + (team.rate * qty * (1 + (team.margin ?? rates.subcontractMargin)));
  }, 0);
  const surveyorSubcontractSell = repairSubcontractorSell(s.surveyorSubcontractors);
  const productionLabourSell = usesProductionInHouse ? s.productionMen * productionDays * rates.productionLabourDayRate * (1 + adminRateMargin(rates, "productionLabourDayRate", rates.defaultMargin)) : 0;
  const surveyorLabourSell = usesSurveyorInHouse ? (
    s.surveyors * surveyorDays * rates.screedSurveyorDayRate * (1 + adminRateMargin(rates, "screedSurveyorDayRate", 0)) +
    s.surveyors * calculatedSurveyorWeekendDays * rates.screedSurveyorWeekendDayRate * (1 + adminRateMargin(rates, "screedSurveyorWeekendDayRate", rates.defaultMargin)) +
    (s.nightShiftRequired ? s.surveyors * s.surveyorNightShifts * rates.surveyorNightShiftAllowance * (1 + adminRateMargin(rates, "surveyorNightShiftAllowance", rates.defaultMargin)) : 0)
  ) : 0;
  const screedUnits = screedMaterialUnits(s.screedMaterialBags, s.screedMaterialContingency, s.screedMaterialWaste);
  const primerTotalUnits = screedMaterialUnits(s.primerUnits, s.primerContingency, s.primerWaste);
  const sandTotalBags = screedMaterialUnits(s.sandBags, s.sandContingency, s.sandWaste);
  const materialSell = (screedUnits * s.screedMaterialRate * (1 + s.screedMaterialMargin)) + (primerTotalUnits * s.primerRate * (1 + s.primerMargin)) + (sandTotalBags * s.sandRate * (1 + s.sandMargin)) + (s.materialShipping ? s.materialShipping * (1 + s.materialShippingMargin) : 0);
  const toolDays = usesProductionInHouse ? productionDays : 0;
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
    (s.equipmentShipping ? s.equipmentShipping * (1 + s.equipmentShippingMargin) : 0)
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
          <Mini label="Sense Checks" value={readiness.blockers.length + readiness.warnings.length ? `${readiness.blockers.length + readiness.warnings.length} flagged` : "Clear"} />
        </div>
      </div>
      {readiness.blockers.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="mb-2 font-bold uppercase">Screeding sense checks</div><div className="grid gap-1">{readiness.blockers.slice(0, 8).map((warning) => <div key={warning}>{warning}</div>)}</div></div>}
      {!readiness.blockers.length && readiness.warnings.length > 0 && <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><div className="mb-2 font-bold uppercase">Screeding review notes</div><div className="grid gap-1">{readiness.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div></div>}
      <ScreedPageTabs screedPage={screedPage} setScreedPage={setScreedPage} />
      {screedPage === "Programme" && <>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Screeding Programme</h2><p className="text-sm text-slate-500">Set the expected site duration first. These days drive default labour, surveyor and in-house equipment quantities.</p></div>
          <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
            <NumberInput label="Area m2" value={s.areaM2} onChange={(v) => patch({ areaM2: v })} />
            <NumberInput label="Preparation Days" value={s.preparationDays} onChange={(v) => patch({ preparationDays: v })} />
            <NumberInput label="Screeding Days" value={s.screedingDays} onChange={(v) => patch({ screedingDays: v })} />
            <NumberInput label="Grinding Days" value={s.grindingDays} onChange={(v) => patch({ grindingDays: v })} />
            <Mini label="Total Site Days" value={String(screedDays)} />
            <NumberInput label="Weekend Days Worked Per Week" value={s.weekendDaysPerWeek} max={2} step={1} onChange={(v) => patch({ weekendDaysPerWeek: v, productionWeekendDays: v, surveyorWeekendDays: v })} />
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
              const scope = [team.prep && "Preparation", team.screed && "Screeding", team.grind && "Grinding"].filter(Boolean).join(", ") || "Scope not set";
              const activityDays = (team.prep ? team.preparationDays : 0) + (team.screed ? team.screedingDays : 0) + (team.grind ? team.grindingDays : 0);
              const qty = team.priceType === "day" ? activityDays : team.rate ? 1 : 0;
              const prepDifferent = team.prep && team.preparationDays !== s.preparationDays;
              const screedDifferent = team.screed && team.screedingDays !== s.screedingDays;
              const grindDifferent = team.grind && team.grindingDays !== s.grindingDays;
              const sell = (team.mobilisation * (1 + (team.mobilisationMargin ?? rates.subcontractMargin))) + (team.rate * qty * (1 + (team.margin ?? rates.subcontractMargin)));
              return (
                <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4" key={index}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><div className="text-xs font-bold uppercase text-slate-500">Subcontractor {index + 1}</div><h3 className="font-bold text-slate-950">{team.contractorName || "Unnamed subcontractor"}</h3><p className="text-sm text-slate-500">{scope}</p></div>
                    <button className="secondary-button" onClick={() => removeTeam(index)}>Remove</button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <Text label="Subcontractor" value={team.contractorName} onChange={(v) => updateTeam(index, { contractorName: v })} />
                    <Select label="Price Type" value={team.priceType} options={["day", "lump sum"]} onChange={(v) => updateTeam(index, { priceType: v as ScreedTeam["priceType"] })} />
                    <NumberInput label="Rate / Budget Cost" value={team.rate} onChange={(v) => updateTeam(index, { rate: v })} />
                    <NumberInput label="Markup %" value={(team.margin ?? rates.subcontractMargin) * 100} onChange={(v) => updateTeam(index, { margin: v / 100 })} />
                    {team.priceType === "day" ? <Mini label="Total Subcontractor Days" value={`${activityDays}`} /> : <Mini label="Quantity" value="1 lump sum" />}
                    <Mini label="Proposal Cost" value={money(sell)} />
                    <NumberInput label="Mobilisation" value={team.mobilisation} onChange={(v) => updateTeam(index, { mobilisation: v })} />
                    <NumberInput label="Mobilisation Markup %" value={(team.mobilisationMargin ?? rates.subcontractMargin) * 100} onChange={(v) => updateTeam(index, { mobilisationMargin: v / 100 })} />
                    <Toggle label="Preparation" checked={team.prep} onChange={(v) => updateTeam(index, { prep: v, preparationDays: v ? s.preparationDays : 0 })} />
                    <Toggle label="Screeding" checked={team.screed} onChange={(v) => updateTeam(index, { screed: v, screedingDays: v ? s.screedingDays : 0 })} />
                    <Toggle label="Grinding" checked={team.grind} onChange={(v) => updateTeam(index, { grind: v, grindingDays: v ? s.grindingDays : 0 })} />
                  </div>
                  {team.priceType === "day" && <div className="grid gap-3 sm:grid-cols-3">
                    {team.prep && <div className={prepDifferent ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Preparation Days" value={team.preparationDays} onChange={(v) => updateTeam(index, { preparationDays: v })} />{prepDifferent && <div className="mt-1 text-xs font-bold text-amber-900">Programme: {s.preparationDays} days</div>}</div>}
                    {team.screed && <div className={screedDifferent ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Screeding Days" value={team.screedingDays} onChange={(v) => updateTeam(index, { screedingDays: v })} />{screedDifferent && <div className="mt-1 text-xs font-bold text-amber-900">Programme: {s.screedingDays} days</div>}</div>}
                    {team.grind && <div className={grindDifferent ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Grinding Days" value={team.grindingDays} onChange={(v) => updateTeam(index, { grindingDays: v })} />{grindDifferent && <div className="mt-1 text-xs font-bold text-amber-900">Programme: {s.grindingDays} days</div>}</div>}
                  </div>}
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
              <NumberInput label="Production Men" value={s.productionMen} step={1} onChange={(v) => patch({ productionMen: v, propaneGrinders: v || s.propaneGrinders })} />
              <Mini label="Production Labour Sell" value={money(productionLabourSell)} />
            </div>
            {productionDaysOverridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Production labour days overridden from {screedDays} to {productionDays}.</div>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Weekend Days On Project" value={`${calculatedProductionWeekendDays}`} />
              <NumberInput label="Night Shifts" value={s.productionNightShifts} step={1} onChange={(v) => patch({ productionNightShifts: v })} />
              <Toggle label="Hotel / Subsistence" checked={s.productionHotelRequired} onChange={(v) => patch({ productionHotelRequired: v })} />
              {s.productionHotelRequired && <div className={s.productionHotelNights > 0 && s.productionHotelNights !== calculatedProductionHotelNights ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Hotel Nights Per Team" value={productionHotelNights} onChange={(v) => patch({ productionHotelNights: v === calculatedProductionHotelNights ? 0 : v })} />{s.productionHotelNights > 0 && <button className="mt-2 text-xs font-bold text-sky-700" onClick={() => patch({ productionHotelNights: 0 })}>Reset to calculated {calculatedProductionHotelNights}</button>}</div>}
            </div>
            <InternalTravelFields officeCount={input.officeCount} distanceUnit={input.distanceUnit} people={s.productionMen} value={{ mode: s.productionTravelMode, travelDays: s.productionTravelDays, primaryOneWay: s.productionOneWayKm, secondaryOneWay: s.productionSecondaryOneWayKm, vehicles: s.productionVehicles, returnFlights: s.productionReturnFlights, airportTransport: s.productionAirportTransport, airportTransferReturns: s.productionAirportTransferReturns, airportParkingDays: s.productionAirportParkingDays, destinationTransport: s.productionDestinationTransport, rentalVehicles: s.productionRentalVehicles, rentalVehicleDays: s.productionRentalVehicleDays }} onChange={(next) => patch({ productionTravelMode: next.mode ?? s.productionTravelMode, productionTravelDays: next.travelDays ?? s.productionTravelDays, productionOneWayKm: next.primaryOneWay ?? s.productionOneWayKm, productionSecondaryOneWayKm: next.secondaryOneWay ?? s.productionSecondaryOneWayKm, productionVehicles: next.vehicles ?? s.productionVehicles, productionReturnFlights: next.returnFlights ?? s.productionReturnFlights, productionAirportTransport: next.airportTransport ?? s.productionAirportTransport, productionAirportTransferReturns: next.airportTransferReturns ?? s.productionAirportTransferReturns, productionAirportParkingDays: next.airportParkingDays ?? s.productionAirportParkingDays, productionDestinationTransport: next.destinationTransport ?? s.productionDestinationTransport, productionRentalVehicles: next.rentalVehicles ?? s.productionRentalVehicles, productionRentalVehicleDays: next.rentalVehicleDays ?? s.productionRentalVehicleDays })} />
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
              <NumberInput label="Surveyors" value={s.surveyors} step={1} onChange={(v) => patch({ surveyors: v })} />
              <Mini label="Surveyor Labour Sell" value={money(surveyorLabourSell)} />
            </div>
            {surveyorDaysOverridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Surveyor days overridden from {screedDays} to {surveyorDays}.</div>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Weekend Days On Project" value={`${calculatedSurveyorWeekendDays}`} />
              <NumberInput label="Night Shifts" value={s.surveyorNightShifts} step={1} onChange={(v) => patch({ surveyorNightShifts: v })} />
              <Toggle label="Engineering Report" checked={s.engineeringReport} onChange={(v) => patch({ engineeringReport: v })} />
              <Toggle label="Hotel / Subsistence" checked={s.surveyorHotelRequired || s.hotelRequired} onChange={(v) => patch({ surveyorHotelRequired: v, hotelRequired: v })} />
              {(s.surveyorHotelRequired || s.hotelRequired) && <div className={s.surveyorHotelNights > 0 && s.surveyorHotelNights !== calculatedSurveyorHotelNights ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Hotel Nights Per Team" value={surveyorHotelNights} onChange={(v) => patch({ surveyorHotelNights: v === calculatedSurveyorHotelNights ? 0 : v })} />{s.surveyorHotelNights > 0 && <button className="mt-2 text-xs font-bold text-sky-700" onClick={() => patch({ surveyorHotelNights: 0 })}>Reset to calculated {calculatedSurveyorHotelNights}</button>}</div>}
            </div>
            <InternalTravelFields officeCount={input.officeCount} distanceUnit={input.distanceUnit} people={s.surveyors} value={{ mode: s.surveyorTravelMode, travelDays: s.surveyorTravelDays, primaryOneWay: s.surveyorOneWayKm, secondaryOneWay: s.surveyorSecondaryOneWayKm, vehicles: s.surveyorVehicles, returnFlights: s.surveyorReturnFlights, airportTransport: s.surveyorAirportTransport, airportTransferReturns: s.surveyorAirportTransferReturns, airportParkingDays: s.surveyorAirportParkingDays, destinationTransport: s.surveyorDestinationTransport, rentalVehicles: s.surveyorRentalVehicles, rentalVehicleDays: s.surveyorRentalVehicleDays }} onChange={(next) => patch({ surveyorTravelMode: next.mode ?? s.surveyorTravelMode, surveyorTravelDays: next.travelDays ?? s.surveyorTravelDays, surveyorOneWayKm: next.primaryOneWay ?? s.surveyorOneWayKm, surveyorSecondaryOneWayKm: next.secondaryOneWay ?? s.surveyorSecondaryOneWayKm, surveyorVehicles: next.vehicles ?? s.surveyorVehicles, surveyorReturnFlights: next.returnFlights ?? s.surveyorReturnFlights, surveyorAirportTransport: next.airportTransport ?? s.surveyorAirportTransport, surveyorAirportTransferReturns: next.airportTransferReturns ?? s.surveyorAirportTransferReturns, surveyorAirportParkingDays: next.airportParkingDays ?? s.surveyorAirportParkingDays, surveyorDestinationTransport: next.destinationTransport ?? s.surveyorDestinationTransport, surveyorRentalVehicles: next.rentalVehicles ?? s.surveyorRentalVehicles, surveyorRentalVehicleDays: next.rentalVehicleDays ?? s.surveyorRentalVehicleDays })} />
          </div>
        </div>}
        <ScreedPageTabs screedPage={screedPage} setScreedPage={setScreedPage} placement="bottom" />
      </>}
      {screedPage === "Materials" && <>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Screed Materials</h2><p className="text-sm text-slate-500">Enter the base quantity. Contingency and waste are added visibly before the budget and proposal totals are calculated.</p></div>
          <div className="grid gap-5 p-5">
            <div className="grid gap-3 border-b border-slate-200 pb-5 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Screed Base Bags" value={s.screedMaterialBags} onChange={(v) => patch({ screedMaterialBags: v })} />
              <NumberInput label="Contingency %" value={(s.screedMaterialContingency ?? 0) * 100} onChange={(v) => patch({ screedMaterialContingency: v / 100 })} />
              <NumberInput label="Waste %" value={(s.screedMaterialWaste ?? 0) * 100} onChange={(v) => patch({ screedMaterialWaste: v / 100 })} />
              <Mini label="Total Screed Bags" value={`${screedUnits}`} />
              <NumberInput label="Screed Budget / Bag" value={s.screedMaterialRate} onChange={(v) => patch({ screedMaterialRate: v })} />
              <NumberInput label="Screed Markup %" value={s.screedMaterialMargin * 100} onChange={(v) => patch({ screedMaterialMargin: v / 100 })} />
              <Mini label="Screed Proposal Cost" value={money(screedUnits * s.screedMaterialRate * (1 + s.screedMaterialMargin))} />
            </div>
            <div className="grid gap-3 border-b border-slate-200 pb-5 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Primer Base Units" value={s.primerUnits} onChange={(v) => patch({ primerUnits: v })} />
              <NumberInput label="Contingency %" value={(s.primerContingency ?? 0) * 100} onChange={(v) => patch({ primerContingency: v / 100 })} />
              <NumberInput label="Waste %" value={(s.primerWaste ?? 0) * 100} onChange={(v) => patch({ primerWaste: v / 100 })} />
              <Mini label="Total Primer Units" value={`${primerTotalUnits}`} />
              <NumberInput label="Primer Budget / Unit" value={s.primerRate} onChange={(v) => patch({ primerRate: v })} />
              <NumberInput label="Primer Markup %" value={s.primerMargin * 100} onChange={(v) => patch({ primerMargin: v / 100 })} />
              <Mini label="Primer Proposal Cost" value={money(primerTotalUnits * s.primerRate * (1 + s.primerMargin))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Sand Base Bags" value={s.sandBags} onChange={(v) => patch({ sandBags: v })} />
              <NumberInput label="Contingency %" value={(s.sandContingency ?? 0) * 100} onChange={(v) => patch({ sandContingency: v / 100 })} />
              <NumberInput label="Waste %" value={(s.sandWaste ?? 0) * 100} onChange={(v) => patch({ sandWaste: v / 100 })} />
              <Mini label="Total Sand Bags" value={`${sandTotalBags}`} />
              <NumberInput label="Sand Budget / Bag" value={s.sandRate} onChange={(v) => patch({ sandRate: v })} />
              <NumberInput label="Sand Markup %" value={s.sandMargin * 100} onChange={(v) => patch({ sandMargin: v / 100 })} />
              <Mini label="Sand Proposal Cost" value={money(sandTotalBags * s.sandRate * (1 + s.sandMargin))} />
            </div>
            <div className="grid gap-3 border-t border-slate-200 pt-5 sm:grid-cols-2 xl:grid-cols-4">
            <NumberInput label="Material Shipping" value={s.materialShipping} onChange={(v) => patch({ materialShipping: v })} />
            <NumberInput label="Shipping Markup %" value={s.materialShippingMargin * 100} onChange={(v) => patch({ materialShippingMargin: v / 100 })} />
            <Mini label="Shipping Proposal Cost" value={money(s.materialShipping * (1 + s.materialShippingMargin))} />
            <Mini label="Total Material Sell" value={money(materialSell)} />
            </div>
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
              {s.largeGeneratorRequired && <NumberInput label="Large Generator Rate" value={s.largeGeneratorRate} onChange={(v) => patch({ largeGeneratorRate: v })} />}
              {s.largeGeneratorRequired && <NumberInput label="Delivery" value={s.largeGeneratorDelivery} onChange={(v) => patch({ largeGeneratorDelivery: v })} />}
              {s.largeGeneratorRequired && <NumberInput label="Collection" value={s.largeGeneratorCollection} onChange={(v) => patch({ largeGeneratorCollection: v })} />}
              <NumberInput label="Grinders" value={grinderCount} onChange={(v) => patch({ propaneGrinders: v })} />
              <NumberInput label="Planers" value={s.gasPlaners} onChange={(v) => patch({ gasPlaners: v })} />
              <NumberInput label="Vacuums" value={s.dustVacuums} onChange={(v) => patch({ dustVacuums: v })} />
              <NumberInput label="Extension Cord Sets" value={s.extensionCordSets} onChange={(v) => patch({ extensionCordSets: v })} />
              <Toggle label="Grinding Segments" checked={s.grindingSegmentsRequired} onChange={(v) => patch({ grindingSegmentsRequired: v })} />
              <Toggle label="Consumables" checked={s.consumablesRequired} onChange={(v) => patch({ consumablesRequired: v })} />
              <NumberInput label="Equipment Shipping" value={s.equipmentShipping} onChange={(v) => patch({ equipmentShipping: v })} />
              <NumberInput label="Shipping Markup %" value={s.equipmentShippingMargin * 100} onChange={(v) => patch({ equipmentShippingMargin: v / 100 })} />
            </div>
          </div>}
        </div>
        <div className="app-card-strong">
          <div className="panel-heading"><h2 className="text-xl font-semibold">Screeding Review</h2><p className="text-sm text-slate-500">Quick check before moving to the next costing section.</p></div>
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
  const [advancedLines, setAdvancedLines] = useState<Record<string, boolean>>({});
  const [repairPage, setRepairPageState] = useState<RepairPage>(input.uiProgress?.repairPage ?? "Details");
  const [pendingOptional, setPendingOptional] = useState<Record<string, string>>({});
  const patch = (next: Partial<typeof r>) => setInput({ ...input, repairs: { ...r, ...next } });
  const setRepairPage = (page: RepairPage) => {
    setRepairPageState(page);
    setInput({ ...input, uiProgress: { ...input.uiProgress, repairPage: page } });
    scrollToCostingSection();
  };
  const updateRepairLine = (index: number, next: Partial<RepairLineItem>) => patch({ repairLines: r.repairLines.map((item, i) => i === index ? { ...item, ...next } : item) });
  const materialCost = (repairLine: RepairLineItem) => calculateRepairLineMaterials(repairLine, repairCatalog).reduce((sum, calc) => sum + calc.cost, 0);
  const selectedMaterialIds = (repairLine: RepairLineItem) => {
    const type = repairTypeByCode(repairLine.repairTypeCode, repairCatalog);
    const selected = new Set(repairLine.materialSelections.filter((selection) => selection.selected).map((selection) => selection.materialId));
    return type.materialRules.filter((rule) => rule.role === "required" || selected.has(rule.materialId)).map((rule) => rule.materialId);
  };
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
  const mobilisationKm = r.travelMode === "Drive" ? chargeableJourneyDistance(input.officeCount, r.mobilisationOneWayKm, r.mobilisationSecondaryOneWayKm, r.mobilisationVehicles) : 0;
  const calculatedRepairHotelNights = calculatedHotelNights(effectiveRepairDays, r.weekendRequired ? r.weekendDays : 0, r.travelMode === "None" ? 0 : r.travelDays);
  const effectiveRepairHotelNights = r.hotelNights || calculatedRepairHotelNights;
  const hotelRoomNights = r.hotelRequired ? effectiveRepairHotelNights * Math.max(0, r.labourMen) : 0;
  const inHouseMen = Math.max(0, r.labourMen);
  const repairTravelSell = r.travelMode === "None" ? 0 : (inHouseMen * r.travelDays * rates.productionLabourTravelDayRate * (1 + adminRateMargin(rates, "productionLabourTravelDayRate", rates.travelMargin)))
    + (r.travelMode === "Drive" ? mobilisationKm * rates.repairFuelPerKm * (1 + adminRateMargin(rates, "repairFuelPerKm", rates.travelMargin)) : 0)
    + (r.travelMode === "Fly" ? effectiveReturnFlights(r.returnFlights, inHouseMen) * rates.returnFlight * (1 + adminRateMargin(rates, "returnFlight", rates.flightMargin))
      + (r.airportTransport === "Uber" ? (r.airportTransferReturns || 1) * rates.airportUberReturn * (1 + adminRateMargin(rates, "airportUberReturn", rates.travelMargin)) : 0)
      + (r.airportTransport === "Drive" ? r.airportParkingDays * Math.max(1, r.mobilisationVehicles) * rates.airportParkingPerDay * (1 + adminRateMargin(rates, "airportParkingPerDay", rates.travelMargin)) : 0)
      + (r.destinationTransport === "Rental Car" ? Math.max(1, r.rentalVehicles) * r.rentalVehicleDays * rates.rentalCar * (1 + adminRateMargin(rates, "rentalCar", rates.travelMargin)) : 0)
      + (r.destinationTransport === "Rental Van" ? Math.max(1, r.rentalVehicles) * r.rentalVehicleDays * rates.rentalVan * (1 + adminRateMargin(rates, "rentalVan", rates.travelMargin)) : 0) : 0);
  const inHouseSellTotal = usesInHouse ? ((inHouseMen * effectiveRepairDays * rates.productionLabourDayRate * (1 + adminRateMargin(rates, "productionLabourDayRate", rates.defaultMargin))) + (r.weekendRequired ? inHouseMen * weekendDaysForProgramme(effectiveRepairDays, 5, r.weekendDays) * rates.productionWeekendDayRate * (1 + adminRateMargin(rates, "productionWeekendDayRate", rates.defaultMargin)) : 0) + (r.nightShiftRequired ? inHouseMen * r.nightShiftHours * rates.productionNightShiftAllowance * (1 + adminRateMargin(rates, "productionNightShiftAllowance", rates.defaultMargin)) : 0) + repairTravelSell + (hotelRoomNights * rates.hotel * (1 + adminRateMargin(rates, "hotel", rates.hotelMargin))) + (hotelRoomNights * rates.subsistence * (1 + adminRateMargin(rates, "subsistence", rates.subsistenceMargin)))) : 0;
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
    if (current.repairTypeCode === code) return;
    const populated = Boolean(current.lengthM || current.areaM2 || current.eachQty || current.manualMaterialQty || current.holeDiameterMm || current.holeDepthMm);
    if (populated && !confirm("Changing the repair type resets its quantity, dimensions and material selections to the new company defaults. Continue?")) return;
    const next = createRepairLine(code, repairCatalog);
    patch({ repairLines: r.repairLines.map((item, i) => i === index ? { ...next, id: current.id } : item) });
  };
  const toggleMaterial = (lineIndex: number, materialId: string, selected: boolean) => {
    const line = r.repairLines[lineIndex];
    const rule = repairTypeByCode(line.repairTypeCode, repairCatalog).materialRules.find((item) => item.materialId === materialId);
    const widthMm = rule?.usesOwnDimensions ? rule.defaultWidthMm : line.widthMm;
    const depthMm = rule?.usesOwnDimensions ? rule.defaultDepthMm : line.depthMm;
    const existing = line.materialSelections.some((item) => item.materialId === materialId);
    const materialSelections = existing
      ? line.materialSelections.map((item) => item.materialId === materialId ? { ...item, selected, widthMm: item.widthMm ?? widthMm, depthMm: item.depthMm ?? depthMm } : item)
      : [...line.materialSelections, { materialId, selected, widthMm, depthMm }];
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
          <Mini label="Sense Checks" value={readiness.blockers.length + readiness.warnings.length ? `${readiness.blockers.length + readiness.warnings.length} flagged` : "Clear"} />
        </div>
      </div>
      {readiness.blockers.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="mb-2 font-bold uppercase">Repair sense checks</div>
          <div className="grid gap-1">{readiness.blockers.slice(0, 8).map((warning) => <div key={warning}>{warning}</div>)}</div>
        </div>
      )}
      {!readiness.blockers.length && readiness.warnings.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
          <div className="mb-2 font-bold uppercase">Repair review notes</div>
          <div className="grid gap-1">{readiness.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div>
        </div>
      )}
      <RepairPageTabs repairPage={repairPage} setRepairPage={setRepairPage} />
      {repairPage === "Details" && <>
      <div className="app-card-strong">
        <div className="panel-heading flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-semibold">Repair Type Schedule</h2><p className="text-sm text-slate-500">Add one row per repair type. Materials are suggested from the repair database using the company-standard booklet codes.</p></div>
          <div className="text-xs font-semibold text-slate-500">Open Advanced on only the repair rows that need extra detail.</div>
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
            const advanced = Boolean(advancedLines[repairLine.id]);
            const ownDimensionRules = type.materialRules.filter((rule) => rule.usesOwnDimensions && selectedMaterialIds(repairLine).includes(rule.materialId));
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
                    <button className={advanced ? "primary-button" : "secondary-button"} onClick={() => setAdvancedLines({ ...advancedLines, [repairLine.id]: !advanced })}>{advanced ? "Simple" : "Advanced"}</button>
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
                  <label className="block"><span className="field-label">Repair Type</span><select value={repairLine.repairTypeCode} onChange={(event) => changeRepairType(index, event.target.value)}>{repairCatalog.types.filter((item) => item.active).map((item) => <option key={item.code} value={item.code}>{item.code} / {item.name}</option>)}</select></label>
                  <Text label="Repair Name" value={repairLine.description || type.name} onChange={(v) => updateRepairLine(index, { description: v })} />
                  {advanced && <NumberInput label="Output Per Day" value={repairLine.outputPerDay || type.defaultOutputPerDay} onChange={(v) => updateRepairLine(index, { outputPerDay: v })} />}
                  {advanced && <Text label="Measure Basis" value={type.measurementBasis} onChange={() => undefined} />}
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
                {advanced && ownDimensionRules.length > 0 && (
                  <div className="mt-4 rounded-lg border border-sky-100 bg-sky-50 p-3">
                    <div className="mb-2 text-xs font-bold uppercase text-sky-700">Sealant-Specific Dimensions</div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {ownDimensionRules.map((rule) => {
                        const material = repairCatalog.materials.find((item) => item.id === rule.materialId);
                        if (!material) return null;
                        const selection = materialSelection(repairLine, material.id);
                        return (
                          <div className="rounded-lg bg-white p-3 ring-1 ring-sky-100" key={material.id}>
                            <div className="mb-2 truncate text-sm font-bold text-slate-950">{material.name}</div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <NumberInput label="Material Width mm" value={selection?.widthMm && selection.widthMm !== repairLine.widthMm ? selection.widthMm : rule.defaultWidthMm ?? selection?.widthMm ?? repairLine.widthMm} onChange={(v) => patchMaterialSelection(index, repairLine, material.id, { widthMm: v })} />
                              <NumberInput label="Material Depth mm" value={selection?.depthMm && selection.depthMm !== repairLine.depthMm ? selection.depthMm : rule.defaultDepthMm ?? selection?.depthMm ?? repairLine.depthMm} onChange={(v) => patchMaterialSelection(index, repairLine, material.id, { depthMm: v })} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {advanced && <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-bold uppercase text-slate-500">Material Take-Off Preview</div>
                  {materialCalcs.length ? (
                    <div className="table-shell border-0 bg-white">
                      <table>
                        <thead><tr><th>Material</th><th>Calculated Units</th><th>Full Units</th><th>Rate</th><th>Cost</th></tr></thead>
                        <tbody>{materialCalcs.map((calc) => <tr key={`${repairLine.id}-${calc.product}`}><td className="font-semibold">{calc.product.replace(`${repairLine.repairTypeCode} - `, "")}<div className="text-xs font-normal text-slate-500">{calc.formula}</div></td><td>{(calc.unroundedUnits ?? calc.quantity).toFixed(2)}</td><td>{calc.quantity}</td><td>{money(calc.rate)}</td><td className="font-bold">{money(calc.cost)}</td></tr>)}</tbody>
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
        <div className="panel-heading"><h2 className="text-xl font-semibold">Repair Labour Type</h2><p className="text-sm text-slate-500">Choose subcontract, in-house, or both. If both is selected, both sections are added to the costing.</p></div>
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          {(["subcontract", "in_house", "both"] as RepairLabourMode[]).map((mode) => (
            <button key={mode} className={labourMode === mode ? "primary-button" : "secondary-button"} onClick={() => patch({ labourMode: mode })}>{mode === "subcontract" ? "Subcontract" : mode === "in_house" ? "In-house" : "Both"}</button>
          ))}
        </div>
      </div>
      {usesSubcontract && <SubcontractLabourPanel items={r.repairSubcontractors} calculatedDays={effectiveRepairDays} onChange={(items) => patch({ repairSubcontractors: items })} />}
      {usesInHouse && <InHouseLabourPanel input={r} officeCount={input.officeCount} distanceUnit={input.distanceUnit} rates={rates} calculatedDays={repairLineDaysTotal} effectiveDays={effectiveRepairDays} hotelRoomNights={hotelRoomNights} calculatedHotelNights={calculatedRepairHotelNights} effectiveHotelNights={effectiveRepairHotelNights} onChange={patch} />}
      <RepairPageTabs repairPage={repairPage} setRepairPage={setRepairPage} placement="bottom" />
      </>}
      {repairPage === "Review" && <>
      <div className="app-card-strong">
        <div className="panel-heading"><h2 className="text-xl font-semibold">Repair Review</h2><p className="text-sm text-slate-500">Check materials, labour and haulage before saving the costing.</p></div>
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
          <thead><tr><th>Material</th><th>Full Units</th><th>Unit Size</th><th>Cost / Unit</th><th>Material Cost</th><th>Sell With Markup</th></tr></thead>
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
          <div className="grid min-w-0 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_160px_140px_140px_auto]" key={index}>
            <Text label="Name" value={item.name} onChange={(v) => update(index, { name: v })} />
            <NumberInput label="Rate" value={item.rate} onChange={(v) => update(index, { rate: v })} />
            <NumberInput label="Markup %" value={item.margin * 100} onChange={(v) => update(index, { margin: v / 100 })} />
            <Mini label="Sell" value={money(item.rate * (1 + item.margin))} />
            <button className="secondary-button self-end" onClick={() => onChange(currentItems.filter((_, i) => i !== index))} disabled={currentItems.length === 1}>Remove</button>
          </div>
        ))}
        <button className="secondary-button justify-self-start" onClick={() => onChange([...currentItems, { name: "New haulage item", rate: 0, unit: "item", quantity: 1, margin: 0.3 }])}>Add Haulage Item</button>
      </div>
    </div>
  );
}

function InHouseLabourPanel({ input, officeCount, distanceUnit, rates, calculatedDays, effectiveDays, hotelRoomNights, calculatedHotelNights: autoHotelNights, effectiveHotelNights, onChange }: { input: ProjectInput["repairs"]; officeCount: ProjectInput["officeCount"]; distanceUnit: ProjectInput["distanceUnit"]; rates: AdminRates; calculatedDays: number; effectiveDays: number; hotelRoomNights: number; calculatedHotelNights: number; effectiveHotelNights: number; onChange: (next: Partial<ProjectInput["repairs"]>) => void }) {
  const inputtedDays = input.labourDays > 0 ? input.labourDays : calculatedDays;
  const overridden = input.labourDays > 0 && input.labourDays !== calculatedDays;
  return (
    <div className="app-card-strong">
      <div className="panel-heading"><h2 className="text-xl font-semibold">In-House Labour & Mobilisation</h2><p className="text-sm text-slate-500">Use only when FACE is supplying labour. Distance is one-way {distanceUnit}; return distance is calculated.</p></div>
      <div className="grid gap-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Mini label="Calculated Repair Days" value={`${calculatedDays}`} />
          <div className={overridden ? "rounded-lg border border-amber-200 bg-amber-50 p-3" : ""}><NumberInput label="Inputted Repair Days" value={inputtedDays} onChange={(v) => onChange({ labourDays: v })} /></div>
          <NumberInput label="Men Per Team" value={input.labourMen} step={1} onChange={(v) => onChange({ labourMen: v })} />
          <Mini label="Labour Sell" value={money(Math.max(0, input.labourMen) * effectiveDays * rates.productionLabourDayRate * (1 + adminRateMargin(rates, "productionLabourDayRate", rates.defaultMargin)))} />
        </div>
        {overridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Repair days overridden from {calculatedDays} to {effectiveDays}.</div>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Toggle label="Weekend Days" checked={input.weekendRequired} onChange={(v) => onChange({ weekendRequired: v })} />
          {input.weekendRequired && <NumberInput label="Weekend Days Per Week" value={input.weekendDays} max={2} step={1} onChange={(v) => onChange({ weekendDays: v })} />}
          <Toggle label="Night Shifts" checked={input.nightShiftRequired} onChange={(v) => onChange({ nightShiftRequired: v })} />
          {input.nightShiftRequired && <NumberInput label="Number of Night Shifts" value={input.nightShiftHours} onChange={(v) => onChange({ nightShiftHours: v })} />}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Toggle label="Hotel / Subsistence" checked={input.hotelRequired} onChange={(v) => onChange({ hotelRequired: v, subsistenceRequired: v })} />
          {input.hotelRequired && <div className={input.hotelNights > 0 && input.hotelNights !== autoHotelNights ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Hotel Nights Per Team" value={effectiveHotelNights} onChange={(v) => onChange({ hotelNights: v === autoHotelNights ? 0 : v })} />{input.hotelNights > 0 && <button className="mt-2 text-xs font-bold text-sky-700" onClick={() => onChange({ hotelNights: 0 })}>Reset to calculated {autoHotelNights}</button>}</div>}
          {input.hotelRequired && <Mini label="Room Nights" value={`${hotelRoomNights}`} />}
        </div>
        <InternalTravelFields officeCount={officeCount} distanceUnit={distanceUnit} people={input.labourMen} value={{ mode: input.travelMode, travelDays: input.travelDays, primaryOneWay: input.mobilisationOneWayKm, secondaryOneWay: input.mobilisationSecondaryOneWayKm, vehicles: input.mobilisationVehicles, returnFlights: input.returnFlights, airportTransport: input.airportTransport, airportTransferReturns: input.airportTransferReturns, airportParkingDays: input.airportParkingDays, destinationTransport: input.destinationTransport, rentalVehicles: input.rentalVehicles, rentalVehicleDays: input.rentalVehicleDays }} onChange={(next) => onChange({ travelMode: next.mode ?? input.travelMode, travelDays: next.travelDays ?? input.travelDays, mobilisationOneWayKm: next.primaryOneWay ?? input.mobilisationOneWayKm, mobilisationSecondaryOneWayKm: next.secondaryOneWay ?? input.mobilisationSecondaryOneWayKm, mobilisationVehicles: next.vehicles ?? input.mobilisationVehicles, returnFlights: next.returnFlights ?? input.returnFlights, airportTransport: next.airportTransport ?? input.airportTransport, airportTransferReturns: next.airportTransferReturns ?? input.airportTransferReturns, airportParkingDays: next.airportParkingDays ?? input.airportParkingDays, destinationTransport: next.destinationTransport ?? input.destinationTransport, rentalVehicles: next.rentalVehicles ?? input.rentalVehicles, rentalVehicleDays: next.rentalVehicleDays ?? input.rentalVehicleDays })} />
      </div>
    </div>
  );
}

function SubcontractLabourPanel({ items, calculatedDays, onChange, title = "Subcontract Labour", description = "Add each subcontractor separately. Mobilisation stays in subcontract costs, not travel.", addLabel = "Add Additional Subcontractor", defaultName = "Subcontractor", showStandby = false }: { items: RepairSubcontractor[]; calculatedDays: number; onChange: (items: RepairSubcontractor[]) => void; title?: string; description?: string; addLabel?: string; defaultName?: string; showStandby?: boolean }) {
  const currentItems = items.length ? items : [{ name: defaultName, priceType: "lump sum" as PriceType, rate: 0, days: calculatedDays || 0, margin: 0.3, mobilisationCost: 0, mobilisations: 0, mobilisationMargin: 0.3, standbyRate: 0, standbyMargin: 0.3 }];
  const update = (index: number, next: Partial<RepairSubcontractor>) => onChange(currentItems.map((item, i) => i === index ? { ...item, ...next } : item));
  const add = () => onChange([...currentItems, { name: defaultName, priceType: "lump sum", rate: 0, days: calculatedDays || 0, margin: 0.3, mobilisationCost: 0, mobilisations: 0, mobilisationMargin: 0.3, standbyRate: 0, standbyMargin: 0.3 }]);
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
            <div className="grid min-w-0 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4" key={index}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-[220px] flex-1"><Text label="Subcontractor" value={item.name} onChange={(v) => update(index, { name: v })} /></div>
                <button className="secondary-button" onClick={() => onChange(currentItems.filter((_, i) => i !== index))} disabled={currentItems.length === 1}>Remove</button>
              </div>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Select label="Pricing Method" value={method} options={["Lump Sum", "Day Rate"]} onChange={(v) => update(index, { priceType: v === "Day Rate" ? "day" : "lump sum", days: v === "Day Rate" ? item.days || calculatedDays || 0 : item.days })} />
                <NumberInput label={item.priceType === "day" ? "Day Rate Cost" : "Lump Sum Cost"} value={item.rate} onChange={(v) => update(index, { rate: v })} />
                {item.priceType === "day" && <div className={daysOverridden ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Subcontract Days" value={item.days} onChange={(v) => update(index, { days: v })} /></div>}
                <NumberInput label="Markup %" value={item.margin * 100} onChange={(v) => update(index, { margin: v / 100 })} />
                <Mini label="Labour Sell" value={money(labourCost * (1 + item.margin))} />
              </div>
              {daysOverridden && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Subcontract days overridden from calculated {calculatedDays} to {item.days}.</div>}
              <div className="grid min-w-0 gap-4 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-4">
                <NumberInput label="Mobilisation Cost" value={item.mobilisationCost} onChange={(v) => update(index, { mobilisationCost: v, mobilisations: v > 0 && item.mobilisations <= 0 ? 1 : item.mobilisations })} />
                <NumberInput label="No. of Mobilisations" value={item.mobilisations} step={1} onChange={(v) => update(index, { mobilisations: v })} />
                <NumberInput label="Mobilisation Markup %" value={item.mobilisationMargin * 100} onChange={(v) => update(index, { mobilisationMargin: v / 100 })} />
                <Mini label="Total Subcontract Sell" value={money((labourCost * (1 + item.margin)) + (mobilisationCost * (1 + item.mobilisationMargin)))} />
              </div>
              {item.mobilisationCost > 0 && item.mobilisations <= 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Mobilisation cost has been entered but the number of mobilisations is zero.</div>}
              {showStandby && <div className="grid gap-4 rounded-lg border border-sky-200 bg-sky-50 p-3 sm:grid-cols-3"><NumberInput label="Stand-Down Budget / Day" value={item.standbyRate ?? 0} onChange={(standbyRate) => update(index, { standbyRate })} /><NumberInput label="Stand-Down Markup %" value={(item.standbyMargin ?? item.margin) * 100} onChange={(value) => update(index, { standbyMargin: value / 100 })} /><Mini label="Stand-Down Sell / Day" value={money((item.standbyRate ?? 0) * (1 + (item.standbyMargin ?? item.margin)))} /></div>}
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
    ["Materials incl. markup", materialSell],
    ["Subcontract labour/equipment", subcontractSell],
    ["In-house labour/mobilisation", inHouseSell],
    ["Haulage", logisticsSell]
  ] as const;
  return (
    <div className="app-card-strong">
      <div className="panel-heading"><h2 className="text-xl font-semibold">Repair Cost Build-Up</h2><p className="text-sm text-slate-500">A quick check that the costing includes the major cost categories before review.</p></div>
      <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
        {rows.map(([label, value]) => <Mini key={label} label={label} value={money(value)} />)}
      </div>
    </div>
  );
}

function AdditionalItems({ title, items, onChange }: { title: string; items: AdditionalItem[]; onChange: (items: AdditionalItem[]) => void }) {
  const activeItems = items.filter((item) => item.quantity > 0 && item.rate > 0);
  const [expanded, setExpanded] = useState(activeItems.length > 0);
  const update = (index: number, next: Partial<AdditionalItem>) => onChange(items.map((item, i) => i === index ? { ...item, ...next } : item));
  return (
    <details className="app-card p-4" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer list-none">
        <h3 className="font-bold">{title}</h3>
        <div className="mt-1 text-sm text-slate-500">{activeItems.length ? `${activeItems.length} active item${activeItems.length === 1 ? "" : "s"}` : "No active items"} - choose a P&L category for every project-wide extra.</div>
      </summary>
      <div className="grid gap-3">
        {items.map((item, index) => (
          <div className="grid min-w-0 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3" key={index}>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Text label="Name" value={item.name} onChange={(v) => update(index, { name: v })} />
              <Select label="P&L Category" value={item.plCategory ?? "Equipment"} options={plCategories} onChange={(v) => update(index, { plCategory: v as PLCategory })} />
              <NumberInput label="Budget Cost" value={item.rate} onChange={(v) => update(index, { rate: v })} />
              <Text label="Unit" value={item.unit} onChange={(v) => update(index, { unit: v })} />
              <NumberInput label="Quantity" value={item.quantity} onChange={(v) => update(index, { quantity: v })} />
              <NumberInput label="Markup %" value={item.margin * 100} onChange={(v) => update(index, { margin: v / 100 })} />
              <Mini label="Proposal Cost" value={money(item.rate * item.quantity * (1 + item.margin))} />
              <button className="secondary-button self-end" onClick={() => onChange(items.filter((_, i) => i !== index))}>Remove</button>
            </div>
          </div>
        ))}
      </div>
      <button className="secondary-button mt-3" onClick={() => onChange([...items, { name: "New item", rate: 0, unit: "item", quantity: 1, margin: 0.2, plCategory: "Equipment" }])}>Add Item</button>
    </details>
  );
}

function AdditionalTools({ items, onChange }: { items: AdditionalItem[]; onChange: (items: AdditionalItem[]) => void }) {
  const update = (index: number, next: Partial<AdditionalItem>) => onChange(items.map((item, i) => i === index ? { ...item, ...next, unit: "item", quantity: 1, plCategory: "Equipment" } : item));
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-slate-950">Additional Tools</h3><p className="text-sm text-slate-500">Add any one-off tool or equipment costs not covered above.</p></div><button className="secondary-button" onClick={() => onChange([...items, { name: "", rate: 0, unit: "item", quantity: 1, margin: 0.3, plCategory: "Equipment" }])}>Add Tool</button></div>
    <div className="grid gap-3">{items.map((item, index) => <div className="grid min-w-0 gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_150px_130px_150px_auto]" key={index}>
      <Text label="Description" value={item.name} onChange={(name) => update(index, { name })} />
      <NumberInput label="Budget Cost" value={item.rate} onChange={(rate) => update(index, { rate })} />
      <NumberInput label="Markup %" value={item.margin * 100} onChange={(margin) => update(index, { margin: margin / 100 })} />
      <Mini label="Proposal Cost" value={money(item.rate * (1 + item.margin))} />
      <button className="secondary-button self-end" onClick={() => onChange(items.filter((_, i) => i !== index))}>Remove</button>
    </div>)}</div>
    {!items.length && <div className="text-sm text-slate-500">No additional tools added.</div>}
  </div>;
}

function ProjectDetail({ project, tab, setTab, actuals, setActuals, saveActuals, recordHandover: recordHandoverEvent, note, setNote, addNote, savePackageSelection, edit, updateStatus, deleteProjectRecord }: { project: ProjectRecord; tab: DetailTab; setTab: (tab: DetailTab) => void; actuals: ReturnType<typeof defaultActuals>; setActuals: (a: ReturnType<typeof defaultActuals>) => void; saveActuals: (finalise?: boolean) => void; recordHandover: (issued: boolean) => Promise<void>; note: string; setNote: (v: string) => void; addNote: () => void; savePackageSelection: (selectedPackageIds: string[], reason: string) => Promise<void>; edit: () => void; updateStatus: (status: ProjectStatus) => void; deleteProjectRecord: (reason: string) => Promise<void> }) {
  const auth = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletionReason, setDeletionReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const canEdit = hasPermission(auth.role, "projects.update");
  const canDelete = hasPermission(auth.role, "projects.delete");
  const summary = calculatePL(project.calculations, actuals);
  const projectStatus = normaliseProjectStatus(project.status);
  const terminalCosting = ["Lost", "Completed", "Closed"].includes(projectStatus);
  const statusOptions = allowedStatusTransitions(project.status);
  useEffect(() => {
    if (!tabIsAllowed(tab, project.inputs)) setTab("Summary");
  // Project ID and active tab are sufficient; inputs are immutable in this view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, tab]);
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div><h2 className="text-2xl font-bold">{project.inputs.projectReference} - {project.inputs.client}</h2><div className="mt-1 text-sm text-slate-500">{project.inputs.location} / {project.calculations.serviceSummary} / {project.inputs.quoteCurrency}</div></div>
        <div className="flex flex-wrap gap-2"><Select label="Project Status" value={projectStatus} options={statusOptions} disabled={!canEdit || statusOptions.length < 2} onChange={(value) => updateStatus(value as ProjectStatus)} /><button className="secondary-button" onClick={edit} disabled={!canEdit || terminalCosting}>{terminalCosting ? "Costing Closed" : statusIsLocked(project.status) ? "Create Revision" : "Continue Costing"}</button></div>
      </div>
      <DetailTabs tab={tab} setTab={setTab} input={project.inputs} />
      {tab === "Summary" && <SavedProjectSummary project={project} savePackageSelection={savePackageSelection} />}
      {tab === "Costing" && <SavedCosting project={project} />}
      {tab === "Commercial Review" && <SavedCommercialReview project={project} />}
      {tab === "PM Handover" && <ProjectHandover project={project} recordHandover={recordHandoverEvent} />}
      {tab === "Actual P&L" && <PLActualsPanel project={project} actuals={actuals} setActuals={setActuals} summary={summary} saveActuals={saveActuals} />}
      {tab === "Activity" && <ActivityPanel project={project} note={note} setNote={setNote} addNote={addNote} />}
      {canDelete && <div className="flex justify-end border-t border-slate-200 pt-5"><button className="secondary-button border-red-200 text-red-700 hover:bg-red-50" onClick={() => { setDeleteConfirmation(""); setDeletionReason(""); setDeleteOpen(true); }}><Trash2 size={16} />Move to Recycle Bin</button></div>}
      {deleteOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
          <h2 className="text-xl font-bold text-slate-950" id="delete-project-title">Move project to the recycle bin?</h2>
          <p className="mt-2 text-sm text-slate-600">The costing, actuals, notes and history are retained. A company administrator can restore it from Project Search.</p>
          <div className="mt-4"><Text label="Reason" value={deletionReason} onChange={setDeletionReason} /></div>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Type <b>{project.inputs.projectReference || project.id}</b> to confirm.</div>
          <div className="mt-4"><Text label="Project reference" value={deleteConfirmation} onChange={setDeleteConfirmation} /></div>
          <div className="mt-5 flex flex-wrap justify-end gap-2"><button className="secondary-button" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</button><button className="primary-button bg-red-700 hover:bg-red-800" disabled={deleting || !deletionReason.trim() || deleteConfirmation.trim() !== (project.inputs.projectReference || project.id)} onClick={async () => { try { setDeleting(true); await deleteProjectRecord(deletionReason.trim()); setDeleteOpen(false); } catch { /* The workspace error banner explains the failure. */ } finally { setDeleting(false); } }}><Trash2 size={16} />{deleting ? "Moving..." : "Move to Recycle Bin"}</button></div>
        </div>
      </div>}
    </div>
  );
}

function SavedProjectSummary({ project, savePackageSelection }: { project: ProjectRecord; savePackageSelection: (selectedPackageIds: string[], reason: string) => Promise<void> }) {
  const calculations = project.calculations;
  const selectionConfirmed = Boolean(project.packageSelection?.confirmedAt);
  return <div className="grid gap-5">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label={project.inputs.pricingMode === "selectable" ? selectionConfirmed ? "Selected Contract" : "All Options Offered" : "Sell Value"} value={money(calculations.proposalTotal)} /><Metric label={selectionConfirmed ? "Selected Budget" : "Budget"} value={money(calculations.budgetCost)} /><Metric label="Markup" value={percent(calculations.budgetMarkup ?? 0)} /><Metric label="Project Days" value={String(calculations.siteDays)} /></div>
    {project.inputs.costingModule !== "survey" && <RemedialRateSummary calculations={calculations} />}
    {project.inputs.pricingMode === "selectable" && <PackageSelectionPanel project={project} savePackageSelection={savePackageSelection} />}
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="app-card p-5"><h3 className="font-bold text-slate-950">Project</h3><div className="mt-3 grid gap-2 text-sm"><div><b>Reference:</b> {project.inputs.projectReference}</div><div><b>Client:</b> {project.inputs.client}</div><div><b>Location:</b> {project.inputs.location}</div><div><b>Services:</b> {calculations.serviceSummary}</div><div><b>Status:</b> {normaliseProjectStatus(project.status)} / {project.accountsStatus}</div><div><b>Calculation:</b> {project.calculationVersion ?? "Legacy snapshot"}</div></div></div>
      {calculations.phaseRows?.length > 1 && <div className="app-card p-5"><h3 className="font-bold text-slate-950">Phase Programme</h3><div className="mt-3 grid gap-2">{calculations.phaseRows.map((row) => <div key={row.workPackageId ?? row.service} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><b>{row.label ?? row.service}</b><span>Day {row.startDay} to {row.endDay}{row.concurrent ? " / overlaps" : ""}</span></div>)}</div></div>}
    </div>
  </div>;
}

function PackageSelectionPanel({ project, savePackageSelection }: { project: ProjectRecord; savePackageSelection: (selectedPackageIds: string[], reason: string) => Promise<void> }) {
  const auth = useAuth();
  const existing = project.packageSelection;
  const [selectedIds, setSelectedIds] = useState<string[]>(existing?.selectedPackageIds ?? []);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canEdit = hasPermission(auth.role, "projects.update");
  const summaries = project.calculations.packageSummaries ?? [];
  useEffect(() => {
    setSelectedIds(project.packageSelection?.selectedPackageIds ?? []);
    setReason("");
    setError("");
  }, [project.id, project.packageSelection?.confirmedAt, project.packageSelection?.selectedPackageIds]);
  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const save = async () => {
    if (!selectedIds.length) return setError("Select at least one awarded work package.");
    if (existing && !reason.trim()) return setError("Add a reason before changing an existing client selection.");
    const action = existing ? "update the active contract and operational budget" : "confirm these client-selected packages";
    if (!window.confirm(`This will ${action}. The original offered costing remains in the revision history. Continue?`)) return;
    try {
      setBusy(true);
      setError("");
      await savePackageSelection(selectedIds, reason.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The package selection could not be saved.");
    } finally { setBusy(false); }
  };
  return <section className="app-card-strong">
    <div className="panel-heading flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-xl font-semibold">Client Work-Package Selection</h3><p className="text-sm text-slate-500">Record the client&apos;s award after the full costing has been issued. This changes the active contract, budget, materials, P&amp;L and handover without rewriting the original offer.</p></div>
      <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${existing ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{existing ? "Selection confirmed" : "Awaiting client"}</span>
    </div>
    <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
      {summaries.map((item) => {
        const selected = selectedIds.includes(item.id);
        return <button type="button" key={item.id} disabled={!canEdit || busy} onClick={() => toggle(item.id)} className={`min-w-0 rounded-xl border p-4 text-left transition ${selected ? "border-sky-500 bg-sky-50 ring-1 ring-sky-200" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
          <span className="flex items-start justify-between gap-3"><span className="min-w-0"><b className="block break-words text-slate-950">{item.code}. {item.name}</b><span className="mt-1 block text-xs font-semibold uppercase text-slate-500">{item.service} / {item.pricingBasis === "day_rate" ? "Day rate" : "Fixed price"}</span></span><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white"}`}>{selected && <Check size={13} />}</span></span>
          <span className="mt-3 grid grid-cols-2 gap-2"><span className="rounded-lg bg-white/80 p-2"><span className="block text-[11px] font-bold uppercase text-slate-500">Proposal</span><b>{money(item.proposalTotal)}</b></span><span className="rounded-lg bg-white/80 p-2"><span className="block text-[11px] font-bold uppercase text-slate-500">Budget</span><b>{money(item.budgetCost)}</b></span></span>
        </button>;
      })}
    </div>
    <div className="border-t border-slate-200 p-5">
      {existing && <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Last confirmed {formatDateTime(existing.confirmedAt)} by <b>{existing.confirmedBy}</b>{existing.reason ? `: ${existing.reason}` : "."}</div>}
      {existing && <Text label="Reason for changing the client selection" value={reason} onChange={setReason} />}
      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800" role="alert">{error}</div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-semibold text-slate-600">{selectedIds.length} of {summaries.length} package{summaries.length === 1 ? "" : "s"} selected</span><button className="primary-button" disabled={!canEdit || busy || !selectedIds.length || Boolean(existing && !reason.trim())} onClick={save}>{busy ? "Saving selection..." : existing ? "Update Client Selection" : "Confirm Client Selection"}</button></div>
    </div>
  </section>;
}

function downloadProjectCsv(project: ProjectRecord) {
  const blob = new Blob([projectCsv(project)], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${project.inputs.projectReference || "project"}-internal-costing.csv`);
}

function SavedCosting({ project }: { project: ProjectRecord }) {
  const calculations = project.calculations;
  const categoryRows = plCategories.map((category) => ({ category, budget: calculations.budgetLines.filter((line) => linePLCategory(line) === category).reduce((sum, line) => sum + line.total, 0) })).filter((row) => row.budget);
  return <div className="grid gap-5"><div className="app-card-strong"><div className="panel-heading flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Budget Costing</h2><p className="text-sm text-slate-500">Read-only budget snapshot saved with this costing revision.</p></div><button className="secondary-button" onClick={() => downloadProjectCsv(project)}>Export internal CSV</button></div><div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">{categoryRows.map((row) => <Mini key={row.category} label={row.category} value={money(row.budget)} />)}</div></div><LineTable lines={calculations.budgetLines} /></div>;
}

function SavedCommercialReview({ project }: { project: ProjectRecord }) {
  const calculations = project.calculations;
  const selectedPackageIds = new Set(project.packageSelection?.selectedPackageIds ?? []);
  const rows = plCategories.map((category) => {
    const proposal = calculations.proposalLines.filter((line) => linePLCategory(line) === category).reduce((sum, line) => sum + line.total, 0);
    const budget = calculations.budgetLines.filter((line) => linePLCategory(line) === category).reduce((sum, line) => sum + line.total, 0);
    const profit = proposal - budget;
    return { category, proposal, budget, profit, markup: budget ? profit / budget * 100 : 0 };
  }).filter((row) => row.proposal || row.budget);
  return <div className="grid gap-5">
    <RemedialRateSummary calculations={calculations} />
    {project.inputs.pricingMode === "selectable" && <><div className="grid gap-4 sm:grid-cols-3"><Metric label="All Options Offered" value={money(calculations.allOptionsProposalTotal ?? calculations.proposalTotal)} /><Metric label="Project-Wide Costs" value={money(calculations.commonProposalTotal ?? 0)} /><Metric label="Selected Contract" value={project.packageSelection ? money(calculations.proposalTotal) : "Not confirmed"} /></div><div className="table-shell"><table><thead><tr><th>Package</th><th>Service</th><th>Basis</th><th>Status</th><th>Budget</th><th>Proposal</th><th>Markup</th></tr></thead><tbody>{calculations.packageSummaries?.map((item) => <tr key={item.id}><td className="font-bold">{item.code}. {item.name}</td><td>{item.service}</td><td>{item.pricingBasis === "day_rate" ? "Day rate" : "Fixed price"}</td><td>{!project.packageSelection ? "Offered" : selectedPackageIds.has(item.id) ? "Selected" : "Not selected"}</td><td>{money(item.budgetCost)}</td><td>{money(item.proposalTotal)}</td><td className={item.budgetMarkup < 25 ? "font-bold text-amber-700" : "font-bold text-emerald-700"}>{percent(item.budgetMarkup)}</td></tr>)}</tbody></table></div></>}
    <div className={`rounded-xl border p-4 ${calculations.budgetMarkup < 25 ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}><b>{calculations.budgetMarkup < 25 ? `Markup check: ${percent(calculations.budgetMarkup)}, below 25%` : `Commercial check passed: ${percent(calculations.budgetMarkup)} markup`}</b>{calculations.budgetMarkup < 25 && <div className="mt-2 text-sm">This is a warning only and does not block the costing.</div>}</div>
    <div className="table-shell"><table><thead><tr><th>Category</th><th>Budget</th><th>Proposal</th><th>Profit</th><th>Markup</th></tr></thead><tbody>{rows.map((row) => <tr key={row.category}><td className="font-bold">{row.category}</td><td>{money(row.budget)}</td><td>{money(row.proposal)}</td><td>{money(row.profit)}</td><td className={row.markup < 25 ? "font-bold text-red-700" : "font-bold text-emerald-700"}>{percent(row.markup)}</td></tr>)}</tbody></table></div>
  </div>;
}

async function handoverPdf(project: ProjectRecord) {
  const client = createBrowserSupabaseClient();
  const token = client ? (await client.auth.getSession()).data.session?.access_token : "";
  if (!token) throw new Error("Your secure session has expired. Sign in again before generating a handover.");
  const response = await fetch("/api/projects/handover", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ projectId: project.id }) });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(`${payload?.error ?? "The handover PDF could not be generated."} (HTTP ${response.status})`);
  }
  const blob = await response.blob();
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/pdf") || blob.size < 5) {
    throw new Error("The server returned an invalid PDF file. Please try again.");
  }
  return blob;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function ProjectHandover({ project, recordHandover: record }: { project: ProjectRecord; recordHandover: (issued: boolean) => Promise<void> }) {
  const auth = useAuth();
  const [busy, setBusy] = useState<"" | "save" | "send">("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const summary = buildHandoverSummary(project);
  const filename = `${project.inputs.projectReference || "project"}-delivery-summary.pdf`;
  const canManageHandover = hasPermission(auth.role, "projects.update");
  const selectionReady = project.inputs.pricingMode !== "selectable" || Boolean(project.packageSelection?.confirmedAt);
  const canGenerate = canManageHandover && selectionReady && ["Costing Complete", "Won", "Handover Issued"].includes(normaliseProjectStatus(project.status));
  const canIssue = canManageHandover && selectionReady && ["Won", "Handover Issued"].includes(normaliseProjectStatus(project.status));
  const savePdf = async () => {
    try {
      setActionError("");
      setActionMessage("");
      setBusy("save");
      const blob = await handoverPdf(project);
      downloadBlob(blob, filename);
      await record(false);
      setActionMessage(`PDF generated. Check your Downloads folder for ${filename}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The handover PDF could not be saved.");
    } finally { setBusy(""); }
  };
  const sendPdf = async () => {
    try {
      setActionError("");
      setActionMessage("");
      setBusy("send");
      const blob = await handoverPdf(project);
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `${project.inputs.projectReference} Project Cost & Delivery Summary`, text: `Internal project handover for ${project.inputs.client}.`, files: [file] });
        await record(true);
        setActionMessage("The project handover was shared and recorded as issued.");
      } else {
        downloadBlob(blob, filename);
        window.location.href = `mailto:?subject=${encodeURIComponent(`${project.inputs.projectReference} Project Cost & Delivery Summary`)}&body=${encodeURIComponent("The internal project handover PDF has been downloaded and is ready to attach.")}`;
        const sent = confirm("Attach the downloaded PDF and send the email. Select OK only after it has been sent; Cancel keeps the project at its current status.");
        await record(sent);
        setActionMessage(sent ? "The project handover was recorded as issued." : `PDF generated. Check your Downloads folder for ${filename}; the project status was not changed.`);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setActionError(error instanceof Error ? error.message : "The handover could not be shared.");
    } finally { setBusy(""); }
  };
  const rowTable = (title: string, rows: typeof summary.materials) => rows.length ? <div className="app-card p-5"><h3 className="font-bold text-slate-950">{title}</h3><div className="table-shell mt-3 border border-slate-200"><table><thead><tr><th>Description</th><th>Quantity</th><th>Budget</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.description}-${row.unit}`}><td className="font-semibold">{row.description}</td><td>{Number(row.quantity.toFixed(3))} {row.unit}</td><td className="font-bold">{money(row.budget)}</td></tr>)}</tbody></table></div></div> : null;
  return <div className="handover-print grid gap-5">
    <div className="app-card-strong">
      <div className="panel-heading flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-xs font-bold uppercase text-red-700">Internal and confidential</div><h2 className="mt-1 text-xl font-semibold">Project Cost & Delivery Summary</h2><p className="text-sm text-slate-500">Budget-only delivery handover generated from the completed costing revision.</p></div>
        <div className="handover-actions flex flex-wrap gap-2"><button className="secondary-button" onClick={() => window.print()} disabled={!canGenerate}><Printer size={16} />Print</button><button className="secondary-button" onClick={savePdf} disabled={!canGenerate || Boolean(busy)}><Download size={16} />{busy === "save" ? "Generating..." : "Save PDF"}</button><button className="primary-button" onClick={sendPdf} disabled={!canIssue || Boolean(busy)}><Send size={16} />{busy === "send" ? "Preparing..." : "Send to PM"}</button></div>
      </div>
      {!selectionReady && <div className="m-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-950">Confirm the client-selected work packages before generating the operational handover. This does not block completing the commercial costing.</div>}
      {selectionReady && !canGenerate && <div className="m-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-950">Complete the costing before generating this handover.</div>}
      {canGenerate && !canIssue && <div className="mx-5 mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">The PDF can be reviewed and saved now. Mark the project as Won before issuing it to the project manager.</div>}
      {actionError && <div className="mx-5 mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900" role="alert">{actionError}</div>}
      {actionMessage && <div className="mx-5 mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900" role="status">{actionMessage}</div>}
      <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4"><Mini label="Project" value={project.inputs.projectReference} /><Mini label="Services" value={project.calculations.serviceSummary} /><Mini label="Project Days" value={String(project.calculations.siteDays)} /><Mini label="Project Budget" value={money(project.calculations.budgetCost)} /></div>
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="app-card p-5"><h3 className="font-bold text-slate-950">Actions Before Site</h3><div className="mt-3 grid gap-2 text-sm">{summary.actions.map((action) => <div className="rounded-lg bg-slate-50 px-3 py-2" key={action}>{action}</div>)}</div></div>
      {project.calculations.phaseRows.length > 1 && <div className="app-card p-5"><h3 className="font-bold text-slate-950">Phase Programme</h3><div className="mt-3 grid gap-2 text-sm">{project.calculations.phaseRows.map((row) => <div className="flex justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2" key={row.workPackageId ?? row.service}><b>{row.label ?? row.service}</b><span>Day {row.startDay} to {row.endDay}{row.concurrent ? " / overlaps" : ""}</span></div>)}</div></div>}
    </div>
    {rowTable("Materials to Procure", summary.materials)}
    {rowTable("Subcontract Work Packages", summary.subcontractors)}
    {rowTable("Internal Labour", summary.labour)}
    {rowTable("Equipment", summary.equipment)}
    {rowTable("Travel, Accommodation and Haulage", summary.logistics)}
    <div className="app-card p-5"><h3 className="font-bold text-slate-950">Budget Breakdown</h3><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{summary.categories.map((row) => <Mini key={row.category} label={row.category} value={money(row.budget)} />)}</div><div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4 text-lg font-bold"><span>Overall Budget</span><span>{money(project.calculations.budgetCost)}</span></div></div>
  </div>;
}

function ActivityPanel({ project, note, setNote, addNote }: { project: ProjectRecord; note: string; setNote: (value: string) => void; addNote: () => void }) {
  return <div className="grid gap-5 lg:grid-cols-2"><div className="app-card p-5"><h3 className="font-bold">Notes</h3><textarea className="input mt-3 min-h-28 w-full" value={note} onChange={(event) => setNote(event.target.value)} /><button className="primary-button mt-3" onClick={addNote}>Add Note</button>{project.notes?.map((item) => <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm" key={item.id}><b>{item.author}</b><div className="mt-1">{item.text}</div></div>)}</div><div className="grid gap-5"><div className="app-card p-5"><h3 className="font-bold">Costing Revisions</h3>{project.revisions?.map((revision) => <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm" key={revision.id}><b>{revision.label}</b><div>{money(revision.proposalTotal)} sell value / {money(revision.budgetCost)} budget</div></div>)}</div><div className="app-card p-5"><h3 className="font-bold">Change Log</h3>{project.changeLog?.map((entry) => <div className="mt-3 text-sm" key={entry.id}><History size={14} className="mr-2 inline" />{formatDateTime(entry.createdAt)} - <b>{entry.action}</b>: {entry.detail}</div>)}</div></div></div>;
}

function PLActualsPanel({ project, actuals, setActuals, summary, saveActuals }: { project: ProjectRecord; actuals: ReturnType<typeof defaultActuals>; setActuals: (a: ReturnType<typeof defaultActuals>) => void; summary: ReturnType<typeof calculatePL>; saveActuals: (finalise?: boolean) => void }) {
  const auth = useAuth();
  const selectionReady = project.inputs.pricingMode !== "selectable" || Boolean(project.packageSelection?.confirmedAt);
  const canEditActuals = hasPermission(auth.role, "pl.update") && selectionReady;
  const calculatedWorkingDays = calculateWorkingDays(actuals.startDate, actuals.endDate, actuals.saturdayWorked, actuals.sundayWorked);
  const calculatedSiteDays = calculateActualSiteDays(actuals);
  const inputSiteDays = actuals.siteDaysOverridden ? actuals.daysTakenToComplete : calculatedSiteDays;
  const patch = (next: Partial<typeof actuals>) => setActuals({ ...actuals, ...next });
  const setDatePatch = (next: Partial<typeof actuals>) => {
    const merged = { ...actuals, ...next };
    const siteDays = calculateActualSiteDays(merged);
    setActuals({ ...merged, daysTakenToComplete: merged.siteDaysOverridden ? actuals.daysTakenToComplete : siteDays });
  };
  const actualRows: Array<{ key?: keyof typeof actuals; label: string; actual: number; budget: number; variance: number; readonly?: boolean; helper?: string; onChange?: (value: number) => void }> = summary.rows.map((row) => {
    if (row.item === "Survey Days") return { label: row.item, actual: row.actual, budget: row.budget, variance: row.variance, helper: `${actuals.surveyDays} days x ${money(actuals.surveyDayRate)}`, onChange: undefined };
    if (row.item === "Survey Travel Days") return { label: row.item, actual: row.actual, budget: row.budget, variance: row.variance, helper: `${actuals.surveyTravelDays} days x ${money(actuals.surveyTravelRate)}`, onChange: undefined };
    if (row.item === "BDM Bonus") return { label: row.item, actual: row.actual, budget: row.budget, variance: row.variance, readonly: true, helper: project.inputs.bdmBonusRequired ? "Auto-calculated at 1% of actual price because the costing opted in." : "Not selected on this costing." };
    const key = plRowActualKey(row.item);
    return { key, label: row.item, actual: row.actual, budget: row.budget, variance: row.variance, onChange: key ? (value) => patch({ [key]: value } as Partial<typeof actuals>) : undefined };
  });
  const categoryWarnings = plCategories.map((category) => {
    const proposal = project.calculations.proposalLines.filter((line) => linePLCategory(line) === category).reduce((sum, line) => sum + line.total, 0);
    const budget = project.calculations.budgetLines.filter((line) => linePLCategory(line) === category).reduce((sum, line) => sum + line.total, 0);
    const markup = budget ? (proposal - budget) / budget * 100 : 0;
    return { category, proposal, budget, markup };
  }).filter((row) => row.budget > 0 && row.markup < 25);
  const lowActualMarkup = summary.started && summary.actualCost > 0 && summary.actualMarkup < 25;
  return (
    <div className="grid gap-5">
      {!selectionReady && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-950">Confirm the client-selected work packages from the Summary before entering P&amp;L actuals. This prevents accounts from posting actuals against all offered options.</div>}
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
              <div className={actuals.siteDaysOverridden ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : ""}><NumberInput label="Site Days Inputted" value={inputSiteDays} step={1} onChange={(v) => patch({ daysTakenToComplete: v, siteDaysOverridden: v !== calculatedSiteDays })} />{actuals.siteDaysOverridden && <button className="mt-2 text-xs font-bold text-sky-700" onClick={() => patch({ daysTakenToComplete: calculatedSiteDays, siteDaysOverridden: false })}>Reset to calculated {calculatedSiteDays}</button>}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Mini label="Working Days" value={`${calculatedWorkingDays}`} />
              <Mini label="Calculated Site Days" value={`${calculatedSiteDays}`} />
              <Mini label="Budget Site Days" value={`${project.calculations.siteDays}`} />
              <Mini label="Programme Status" value={summary.programmeStatus.replace("PROJECT ", "")} />
            </div>
            {project.inputs.costingModule !== "survey" && <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <NumberInput label="Survey Days" value={actuals.surveyDays} onChange={(v) => patch({ surveyDays: v })} />
              <NumberInput label="Survey Day Rate" value={actuals.surveyDayRate} onChange={(v) => patch({ surveyDayRate: v })} />
              <NumberInput label="Survey Travel Days" value={actuals.surveyTravelDays} onChange={(v) => patch({ surveyTravelDays: v })} />
              <NumberInput label="Survey Travel Rate" value={actuals.surveyTravelRate} onChange={(v) => patch({ surveyTravelRate: v })} />
            </div>}
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
            <div className="flex flex-wrap gap-2"><button className="secondary-button" onClick={() => saveActuals(false)} disabled={!canEditActuals}><Save size={16} />Save Actuals Draft</button><button className="primary-button" onClick={() => saveActuals(true)} disabled={!canEditActuals || !["Completed", "Closed"].includes(normaliseProjectStatus(project.status))}>Finalise Actuals</button></div>
          </div>
        </div>
        <div className="grid content-start gap-4">
          {(lowActualMarkup || categoryWarnings.length > 0) && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="font-bold uppercase">Markup review</div>{lowActualMarkup && <div className="mt-1">Overall actual markup is {percent(summary.actualMarkup)}, below 25%.</div>}{categoryWarnings.map((row) => <div className="mt-1" key={row.category}>{row.category} budget markup is {percent(row.markup)}, below 25%.</div>)}</div>}
          <div className="app-card-strong">
            <div className="panel-heading"><h2 className="text-xl font-semibold">P&L Summary</h2><p className="text-sm text-slate-500">Live from actuals typed on the left.</p></div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <Mini label="P&L Status" value={summary.started ? "In progress" : "Not started"} />
              <Mini label="Actual Cost" value={summary.started ? money(summary.actualCost) : "-"} />
              <Mini label="Actual Profit" value={summary.started ? money(summary.actualProfit) : "-"} />
              <Mini label="Actual Margin" value={summary.started ? percent(summary.actualMargin) : "-"} />
              <Mini label="Actual Markup" value={summary.started ? percent(summary.actualMarkup) : "-"} />
              <Mini label="Budget Cost" value={money(project.calculations.budgetCost)} />
              <Mini label="Original Budget Profit" value={money(summary.originalBudgetProfit)} />
              <Mini label="Original Budget Markup" value={percent(summary.originalBudgetMarkup)} />
              <Mini label="Invoice vs Budget Profit" value={money(summary.budgetProfit)} />
              <Mini label="Invoice vs Budget Markup" value={percent(summary.budgetMarkup)} />
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
            Accounts status: <b className="text-slate-950">{project.accountsStatus}</b>. Draft saves keep the project awaiting accounts. Finalising locks in the completion and marks it as <b>Actuals Saved</b>.
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
    Other: "other",
    Surveyor: "surveyorInternal",
    "Project Manager": "projectManagerInternal",
    Labourer: "labourerInternal",
    Reports: "engineeringReport"
  };
  return map[item];
}

function varianceTone(value: number) {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-red-700";
  return "text-amber-600";
}

function Overview({ calculations, rates }: { calculations: ReturnType<typeof calculateProject>; rates: AdminRates }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Services" value={calculations.serviceSummary} /><Metric label="Original Proposal" value={money(calculations.originalProposalTotal)} /><Metric label="Discount" value={money(calculations.discountAmount)} /><Metric label="Proposal Total" value={money(calculations.proposalTotal)} /><Metric label="Budget Cost" value={money(calculations.budgetCost)} /><Metric label="Budget Markup" value={percent(calculations.budgetMarkup)} /><Metric label="Daily Rate" value={money(calculations.dailyRate)} /><Metric label="Standby Rate" value={money(calculations.standbyRate || rates.hotel + rates.subsistence)} /></div>;
}

function LineTable({ lines }: { lines: Line[] }) {
  return <div className="table-shell"><table><thead><tr><th>Section</th><th>Item</th><th>Rate</th><th>Qty</th><th>Cost</th><th>Markup</th><th>Discount</th><th>Total</th></tr></thead><tbody>{lines.filter((l) => l.quantity || l.total).map((line, index) => {
    const markup = line.cost ? line.margin / line.cost * 100 : 0;
    return <tr key={`${line.item}-${index}`}><td>{line.section}</td><td className="min-w-[220px] font-semibold">{line.item}</td><td>{money(line.rate)} / {line.unit}</td><td>{line.quantity}</td><td>{money(line.cost)}</td><td>{percent(markup)}</td><td>{money(line.discount)}</td><td className="font-bold">{money(line.total)}</td></tr>;
  })}</tbody></table></div>;
}

function SearchView({ projects, deletedProjects, open, edit, restore, purge }: { projects: ProjectRecord[]; deletedProjects: ProjectRecord[]; open: (project: ProjectRecord) => void; edit: (project: ProjectRecord) => void; restore: (project: ProjectRecord) => Promise<void>; purge: (project: ProjectRecord) => Promise<void> }) {
  const auth = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");
  const [service, setService] = useState("All");
  const [module, setModule] = useState("All");
  const [visibleCount, setVisibleCount] = useState(50);
  const [busyProjectId, setBusyProjectId] = useState("");
  const [purgeTarget, setPurgeTarget] = useState<ProjectRecord | null>(null);
  const [purgeConfirmation, setPurgeConfirmation] = useState("");
  const filtered = projects.filter((p) => `${p.inputs.projectReference} ${p.inputs.client} ${p.inputs.location} ${p.calculations.serviceSummary} ${p.inputs.costedBy}`.toLowerCase().includes(q.toLowerCase()))
    .filter((project) => status === "All" || normaliseProjectStatus(project.status) === status)
    .filter((project) => module === "All" || (project.inputs.costingModule ?? "remedial") === module)
    .filter((project) => service === "All" || project.calculations.serviceSummary.includes(service));
  return <div className="grid gap-5"><div className="app-card-strong"><div className="panel-heading"><h2 className="text-xl font-semibold"><Search className="mr-2 inline" />Project Search</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_180px_180px_180px]"><input placeholder="Reference, client, location or estimator" value={q} onChange={(e) => { setQ(e.target.value); setVisibleCount(50); }} /><Select label="Module" value={module} options={["All", "survey", "remedial"]} onChange={(value) => { setModule(value); setVisibleCount(50); }} /><Select label="Status" value={status} options={["All", "Draft", "Costing Complete", "Won", "Lost", "Handover Issued", "Completed", "Closed"]} onChange={(value) => { setStatus(value); setVisibleCount(50); }} /><Select label="Service" value={service} options={["All", "Survey", "Grinding", "Screeding", "Repairs"]} onChange={(value) => { setService(value); setVisibleCount(50); }} /></div><div className="mt-3 text-sm text-slate-500">Showing {Math.min(visibleCount, filtered.length)} of {filtered.length} project{filtered.length === 1 ? "" : "s"}</div></div><ProjectTable projects={filtered.slice(0, visibleCount)} open={open} edit={edit} />{visibleCount < filtered.length && <div className="flex justify-center border-t border-slate-200 p-4"><button className="secondary-button" onClick={() => setVisibleCount((count) => count + 50)}>Load 50 more</button></div>}</div>
    {hasPermission(auth.role, "projects.delete") && <details className="app-card-strong" open={false}><summary className="cursor-pointer list-none px-5 py-4 font-bold text-slate-900"><span className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><Trash2 size={17} />Recycle Bin</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{deletedProjects.length}</span></span></summary><div className="border-t border-slate-200"><p className="px-5 py-3 text-sm text-slate-600">Archived projects are excluded from dashboards and searches but keep their costing, actuals and activity history.</p><div className="table-shell border-0"><table><thead><tr><th>Project</th><th>Module</th><th>Archived</th><th>Reason</th><th>Actions</th></tr></thead><tbody>{deletedProjects.map((project) => <tr key={project.id}><td><b>{project.inputs.projectReference || "Draft"}</b><div className="text-xs text-slate-500">{project.inputs.client} - {project.inputs.location}</div></td><td>{project.inputs.costingModule ?? "remedial"}</td><td>{project.deletedAt ? formatDateTime(project.deletedAt) : "-"}</td><td>{project.deletionReason || "No reason recorded"}</td><td><div className="flex flex-wrap gap-2"><button className="secondary-button" disabled={busyProjectId === project.id} onClick={async () => { try { setBusyProjectId(project.id); await restore(project); } finally { setBusyProjectId(""); } }}>{busyProjectId === project.id ? "Restoring..." : "Restore"}</button>{auth.role === "super_admin" && <button className="secondary-button border-red-200 text-red-700 hover:bg-red-50" disabled={busyProjectId === project.id} onClick={() => { setPurgeTarget(project); setPurgeConfirmation(""); }}>Delete Permanently</button>}</div></td></tr>)}{!deletedProjects.length && <tr><td colSpan={5} className="py-8 text-center text-sm text-slate-500">The recycle bin is empty.</td></tr>}</tbody></table></div></div></details>}
    {purgeTarget && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="purge-project-title"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-bold text-slate-950" id="purge-project-title">Permanently delete archived project?</h2><p className="mt-2 text-sm text-slate-600">This is restricted to super admins and cannot be undone. All saved costing, actuals, notes and history will be removed.</p><div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">Type <b>{purgeTarget.inputs.projectReference || purgeTarget.id}</b> to confirm.</div><div className="mt-4"><Text label="Project reference" value={purgeConfirmation} onChange={setPurgeConfirmation} /></div><div className="mt-5 flex flex-wrap justify-end gap-2"><button className="secondary-button" disabled={busyProjectId === purgeTarget.id} onClick={() => setPurgeTarget(null)}>Cancel</button><button className="primary-button bg-red-700 hover:bg-red-800" disabled={busyProjectId === purgeTarget.id || purgeConfirmation.trim() !== (purgeTarget.inputs.projectReference || purgeTarget.id)} onClick={async () => { try { setBusyProjectId(purgeTarget.id); await purge(purgeTarget); setPurgeTarget(null); } finally { setBusyProjectId(""); } }}><Trash2 size={16} />{busyProjectId === purgeTarget.id ? "Deleting..." : "Delete Permanently"}</button></div></div></div>}
  </div>;
}

function ProjectTable({ projects, open, edit }: { projects: ProjectRecord[]; open: (project: ProjectRecord) => void; edit?: (project: ProjectRecord) => void }) {
  return <div className="table-shell border-0"><table><thead><tr><th>Project</th><th>Module</th><th>Services</th><th>Status</th><th>Sell Value</th><th>Budget</th><th>Markup</th><th>Actions</th></tr></thead><tbody>{projects.map((p) => <tr key={p.id}><td><b>{p.inputs.projectReference || "Draft"}</b><div className="text-xs text-slate-500">{p.inputs.client} - {p.inputs.location}</div></td><td><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black uppercase text-slate-600">{p.inputs.costingModule ?? "remedial"}</span></td><td>{p.calculations.serviceSummary}</td><td>{normaliseProjectStatus(p.status)} / {p.accountsStatus}</td><td>{p.inputs.pricingMode === "selectable" ? <><b className="block">Offered {money(p.calculations.allOptionsProposalTotal ?? p.calculations.proposalTotal, p.inputs.quoteCurrency)}</b><span className="text-xs text-slate-500">Selected {p.packageSelection ? money(p.calculations.proposalTotal, p.inputs.quoteCurrency) : "not confirmed"}</span></> : money(p.calculations.proposalTotal, p.inputs.quoteCurrency)}</td><td>{money(p.calculations.budgetCost, p.inputs.quoteCurrency)}</td><td>{percent(p.calculations.budgetMarkup ?? (p.calculations.budgetCost ? p.calculations.budgetProfit / p.calculations.budgetCost * 100 : 0))}</td><td><button className="secondary-button mr-2" onClick={() => open(p)}>Open</button>{edit && <button className="secondary-button" onClick={() => edit(p)}>{statusIsLocked(p.status) ? "Revise" : "Edit"}</button>}</td></tr>)}{!projects.length && <tr><td colSpan={8} className="py-10 text-center text-sm font-semibold text-slate-500">No projects match the selected filters.</td></tr>}</tbody></table></div>;
}

function numericRateMap(value: unknown, prefix = "", result = new Map<string, number>()) {
  if (!value || typeof value !== "object") return result;
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "number") result.set(path, item);
    else if (item && typeof item === "object") numericRateMap(item, path, result);
  });
  return result;
}

function changedRateCount(current: AdminRates, previous: AdminRates) {
  const left = numericRateMap(current);
  const right = numericRateMap(previous);
  return Array.from(new Set([...left.keys(), ...right.keys()])).filter((key) => left.get(key) !== right.get(key)).length;
}

function changedRateRows(current: AdminRates, previous: AdminRates) {
  const editor = numericRateMap(current);
  const saved = numericRateMap(previous);
  return Array.from(new Set([...editor.keys(), ...saved.keys()]))
    .filter((key) => editor.get(key) !== saved.get(key))
    .sort()
    .map((key) => ({ key, editor: editor.get(key) ?? 0, saved: saved.get(key) ?? 0 }));
}

function rateHistoryValue(key: string, value: number) {
  return /margin/i.test(key) ? `${(value * 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%` : value.toLocaleString("en-GB", { maximumFractionDigits: 4 });
}

function AdminRatesView({ rates, setRates, repairCatalog, setRepairCatalog, adminTab, setAdminTab, rateVersions, restoreRateVersion, save }: { rates: AdminRates; setRates: (rates: AdminRates) => void; repairCatalog: RepairCatalog; setRepairCatalog: (catalog: RepairCatalog) => void; adminTab: AdminTab; setAdminTab: (tab: AdminTab) => void; rateVersions: RateVersionRecord[]; restoreRateVersion: (version: RateVersionRecord) => void; save: () => void }) {
  const auth = useAuth();
  const distanceCopy = distanceUnitCopy(auth.activeCompany.distanceUnit);
  const [pendingRule, setPendingRule] = useState<Record<string, string>>({});
  const [adminSearch, setAdminSearch] = useState("");
  if (adminTab === "Survey Rates") return <SurveyRatesAdmin rates={normaliseSurveyRates(rates.surveyRates)} distanceUnit={auth.activeCompany.distanceUnit} onChange={(surveyRates) => setRates({ ...rates, surveyRates })} onSave={save} />;
  const search = adminSearch.trim().toLowerCase();
  const filteredRepairTypes = repairCatalog.types.filter((type) => `${type.code} ${type.name} ${type.description}`.toLowerCase().includes(search));
  const filteredMaterials = repairCatalog.materials.filter((material) => `${material.name} ${material.category} ${material.unitType} ${material.measuredUnitType} ${material.calcMethod} ${material.notes}`.toLowerCase().includes(search));
  const updateMaterial = (id: string, next: Partial<RepairMaterial>) => setRepairCatalog({ ...repairCatalog, materials: repairCatalog.materials.map((material) => material.id === id ? { ...material, ...next } : material) });
  const updateType = (id: string, next: Partial<RepairType>) => setRepairCatalog({ ...repairCatalog, types: repairCatalog.types.map((type) => type.id === id ? { ...type, ...next } : type) });
  const addMaterial = () => {
    const id = `material-${Date.now()}`;
    setRepairCatalog({ ...repairCatalog, materials: [...repairCatalog.materials, { id, name: "New repair material", category: "Other", unitType: "kg", unitSize: 0, costPerUnit: 0, calcMethod: "volume_lwd", measuredUnitType: "litres", coveragePerUnit: 0, wasteFactor: 1.1, sourceNote: "Admin", active: false, notes: "Fill out in full before activating" }] });
    setAdminTab("Repair Materials");
  };
  const duplicateMaterial = (material: RepairMaterial) => {
    const id = `material-${Date.now()}`;
    setRepairCatalog({ ...repairCatalog, materials: [...repairCatalog.materials, { ...material, id, name: `${material.name} copy`, active: false }] });
  };
  const addRepairType = () => {
    const code = `New Type ${repairCatalog.types.length + 1}`;
    setRepairCatalog({ ...repairCatalog, types: [...repairCatalog.types, { id: `repair-type-${Date.now()}`, code, name: "New repair type", measurementBasis: "linear", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 0, defaultOutputPerDay: 0, description: "", materialRules: [], active: false }] });
    setAdminTab("Repair Types");
  };
  const duplicateRepairType = (type: RepairType) => {
    const code = `${type.code} copy`;
    setRepairCatalog({ ...repairCatalog, types: [...repairCatalog.types, { ...type, id: `repair-type-${Date.now()}`, code, name: `${type.name} copy`, active: false }] });
  };
  const setMaterialRule = (typeId: string, materialId: string, role: "required" | "optional" | "none") => {
    const type = repairCatalog.types.find((item) => item.id === typeId);
    if (!type) return;
    const without = type.materialRules.filter((rule) => rule.materialId !== materialId);
    const materialRules = role === "none" ? without : [...without, { materialId, role, defaultSelected: role === "required" }];
    updateType(typeId, { materialRules });
  };
  const setRuleDefault = (typeId: string, materialId: string, defaultSelected: boolean) => {
    const type = repairCatalog.types.find((item) => item.id === typeId);
    if (!type) return;
    updateType(typeId, { materialRules: type.materialRules.map((rule) => rule.materialId === materialId ? { ...rule, defaultSelected } : rule) });
  };
  const updateMaterialRule = (typeId: string, materialId: string, next: Partial<RepairType["materialRules"][number]>) => {
    const type = repairCatalog.types.find((item) => item.id === typeId);
    if (!type) return;
    updateType(typeId, { materialRules: type.materialRules.map((rule) => rule.materialId === materialId ? { ...rule, ...next } : rule) });
  };
  const addMaterialRule = (type: RepairType, role: "required" | "optional") => {
    const key = `${type.id}-${role}`;
    const selectedId = pendingRule[key] || repairCatalog.materials.find((material) => material.active && !type.materialRules.some((rule) => rule.materialId === material.id))?.id || "";
    if (!selectedId) return;
    setMaterialRule(type.id!, selectedId, role);
    setPendingRule({ ...pendingRule, [key]: "" });
  };
  const formulaHelp = (method: RepairMaterial["calcMethod"]) => method === "volume_lwd" ? "Volume: length x width x depth, add waste, divide by coverage per unit, round up" : method === "area_thickness" ? "Area/thickness: calculate requirement, add waste, divide by coverage per unit, round up" : method === "linear" ? "Linear: length, add waste, divide by coverage per unit, round up" : method === "each" ? "Each: quantity, add waste, divide by coverage per unit, round up" : "Manual: manual requirement, add waste, divide by coverage per unit, round up";
  const repairTypeStatus = (type: RepairType) => {
    if (!type.active) return { label: "Inactive", tone: "bg-slate-200 text-slate-700" };
    if (!type.materialRules.length) return { label: "Needs material", tone: "bg-amber-100 text-amber-900" };
    if (type.materialRules.some((rule) => {
      const material = repairCatalog.materials.find((item) => item.id === rule.materialId);
      return !material?.active || material.costPerUnit <= 0 || material.unitSize <= 0 || material.coveragePerUnit <= 0;
    })) return { label: "Invalid material", tone: "bg-amber-100 text-amber-900" };
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
  const loadUsaWorkbookRates = () => {
    if (window.confirm("Load the verified Grinding Rev.9 and Screed Rev.7 USA rates? Survey Costing rates and all repair data will be preserved. Review the values, then press Validate & Save Admin Data.")) {
      setRates(applyUsaWorkbookRates(rates));
    }
  };
  const saveValidated = () => {
    const { invalidMaterials, invalidTypes, duplicateCodes } = validateRepairCatalog(repairCatalog);
    if (invalidMaterials.length || invalidTypes.length || duplicateCodes.length) {
      alert(`Admin data cannot be saved with incomplete or ambiguous records.\n\n${invalidMaterials.length} material(s) need completing or archiving.\n${invalidTypes.length} active repair type(s) have incomplete or inactive materials.\n${duplicateCodes.length} duplicate repair code(s) must be renamed.`);
      return;
    }
    save();
  };
  return (
    <div className="grid gap-5">
      <div className="app-card-strong">
        <div className="panel-heading flex flex-wrap justify-between gap-3">
          <div><h2 className="text-xl font-semibold"><Settings className="mr-2 inline" />Admin</h2><p className="text-sm text-slate-500">Rates plus the repair type/material database. Markups are entered as percentages.</p></div>
          <button className="primary-button" onClick={saveValidated}>Validate & Save Admin Data</button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-white p-3">
          {(["Rates", "Repair Types", "Repair Materials"] as const).map((tab) => <button type="button" key={tab} className={adminTab === tab ? "primary-button" : "secondary-button"} onClick={() => setAdminTab(tab)}>{tab}</button>)}
        </div>
        {adminTab === "Rates" && (
          <div className="grid gap-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-sky-100 bg-sky-50 p-4">
              <div className="min-w-0">
                <div className="text-sm font-bold text-sky-950">Admin Rate Control</div>
                <p className="mt-1 max-w-3xl text-sm text-sky-900">Update base rates used by new costings. Saved project calculations keep their existing values unless the project is edited and saved again.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {auth.activeCompany.name.trim().toLowerCase() === "cogri usa" && <button className="primary-button" onClick={loadUsaWorkbookRates}>Load Verified USA Workbook Rates</button>}
                <button className="secondary-button" onClick={resetRates}>Reset to Defaults</button>
              </div>
            </div>
            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-900">Rate Version History <span className="ml-2 text-xs font-semibold text-slate-500">{rateVersions.length} saved version{rateVersions.length === 1 ? "" : "s"}</span></summary>
              <div className="border-t border-slate-200 p-4">
                <p className="mb-3 text-sm text-slate-600">Compare previous company rates without affecting saved projects. Loading a version changes the editor only; it must still be validated and saved.</p>
                <div className="grid gap-2">
                  {rateVersions.slice(0, 10).map((version, index) => {
                    const changes = changedRateRows(rates, version.rates);
                    const changed = changedRateCount(rates, version.rates);
                    return <div className="grid gap-2 rounded-lg border border-slate-200 px-3 py-3 md:grid-cols-[minmax(180px,1fr)_minmax(150px,1fr)_120px_auto] md:items-center" key={version.id}>
                      <div><b className="block text-sm">{index === 0 ? "Latest saved version" : `Saved version ${rateVersions.length - index}`}</b><span className="text-xs text-slate-500">{new Date(version.createdAt).toLocaleString("en-GB")}</span></div>
                      <div className="text-sm"><b>{version.createdByLabel}</b><span className="block text-xs text-slate-500">{version.source.replaceAll("_", " ")}</span></div>
                      <div className={`text-sm font-bold ${changed ? "text-amber-700" : "text-emerald-700"}`}>{changed ? `${changed} value${changed === 1 ? "" : "s"} differ` : "Matches editor"}</div>
                      {auth.role === "super_admin" && <button className="secondary-button" disabled={!changed} onClick={() => { if (window.confirm(`Load rates saved on ${new Date(version.createdAt).toLocaleString("en-GB")} into the editor? Current unsaved rate changes will be replaced.`)) { restoreRateVersion(version); alert("Previous rates loaded into the editor. Review them, then use Validate & Save Admin Data to make them current."); } }}>Load Version</button>}
                      {changes.length > 0 && <details className="md:col-span-4 rounded-lg bg-slate-50"><summary className="cursor-pointer px-3 py-2 text-xs font-bold text-slate-700">Compare changed values</summary><div className="grid gap-1 border-t border-slate-200 p-3">{changes.slice(0, 12).map((change) => <div className="grid gap-1 text-xs sm:grid-cols-[minmax(220px,1fr)_140px_140px]" key={change.key}><span className="font-semibold text-slate-700">{change.key.replaceAll(".", " / ")}</span><span>Saved: <b>{rateHistoryValue(change.key, change.saved)}</b></span><span>Editor: <b>{rateHistoryValue(change.key, change.editor)}</b></span></div>)}{changes.length > 12 && <div className="pt-1 text-xs font-semibold text-slate-500">And {changes.length - 12} more changed value{changes.length - 12 === 1 ? "" : "s"}.</div>}</div></details>}
                    </div>;
                  })}
                  {!rateVersions.length && <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No historical rate versions have been recorded yet. The next admin save will create one.</div>}
                </div>
              </div>
            </details>
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
              title="Grinding Surveyor Labour"
              description="Grinding surveyor budget rates and markups. Survey Costing uses its own separate Survey Rates page."
              badges={["Grinding", "Surveyor"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "grindingSurveyorDayRate", label: "Grinding Surveyor Day Rate", suffix: "/ day" },
                { key: "grindingSurveyorTravelDayRate", label: "Grinding Surveyor Travel Day Rate", suffix: "/ day" },
                { key: "grindingSurveyorWeekendDayRate", label: "Grinding Surveyor Weekend Extra", suffix: "/ surveyor day" },
                { key: "grindingHotelNightRate", label: "Grinding Hotel", suffix: "/ person night" },
                { key: "grindingEngineeringReportRate", label: "Grinding Engineering Report", suffix: "/ report" }
              ]}
            />
            <RateSection
              title="Screeding Surveyor Labour"
              description="Screeding surveyor budget rates and markups. These remain separate because the USA workbooks use different budget rates."
              badges={["Screeding", "Surveyor"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "screedSurveyorDayRate", label: "Screeding Surveyor Day Rate", suffix: "/ day" },
                { key: "screedSurveyorTravelDayRate", label: "Screeding Surveyor Travel Day Rate", suffix: "/ day" },
                { key: "screedSurveyorWeekendDayRate", label: "Screeding Surveyor Weekend Extra", suffix: "/ surveyor day" },
                { key: "screedHotelNightRate", label: "Screeding Hotel", suffix: "/ person night" },
                { key: "screedEngineeringReportRate", label: "Screeding Engineering Report", suffix: "/ report" }
              ]}
            />
            <RateSection
              title="Grinding Stand-Down"
              description="Default people and subsistence components for a grinding stand-down day. Hotel and transport use the shared rates below. Equipment is excluded."
              badges={["Grinding", "Day Rate"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "grindingStandbySurveyorDayRate", label: "Stand-Down Surveyor Day", suffix: "/ surveyor day" },
                { key: "grindingStandbyProductionDayRate", label: "Stand-Down Production Labour", suffix: "/ man day" },
                { key: "grindingStandbySubsistenceDayRate", label: "Stand-Down Subsistence", suffix: "/ person day" }
              ]}
            />
            <RateSection
              title="Shared Surveyor Extras"
              description="App-specific extras shared by grinding and screeding where the source workbooks have no separate rate."
              badges={["Grinding", "Screeding"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "surveyorNightShiftAllowance", label: "Surveyor Night Shift Extra", suffix: "/ surveyor night" }
              ]}
            />
            <RateSection
              title="Other Internal Travel"
              description="Travel-day cost for project managers and other internal people who are not production workers or surveyors. Subcontractors are excluded."
              badges={["Shared", "Travel"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "otherInternalTravelDayRate", label: "Other Internal Travel Day Rate", suffix: "/ person day" }
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
              <p className="mt-2 text-sm text-slate-500">Applied to budget cost only when the costing explicitly selects the BDM bonus option.</p>
            </div>
            <RateSection
              title="Travel, Hotel & Subsistence"
              description={`Shared movement, accommodation and daily allowance rates for workers and surveyors. Distance rates are per ${distanceCopy.singular}.`}
              badges={["Shared", "Travel"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "mileagePerKm", label: `Mileage / ${distanceCopy.singular}`, suffix: `/ ${distanceCopy.singular}` },
                { key: "returnFlight", label: "Return Flight", suffix: "/ flight" },
                { key: "hotel", label: "Hotel", suffix: "/ night" },
                { key: "subsistence", label: "Subsistence", suffix: "/ day" },
                { key: "travelMargin", label: "Travel Default Markup", margin: true, helper: "Used for project-entered travel costs that do not have their own rate row." },
                { key: "flightMargin", label: "Flight Default Markup", margin: true, helper: "Used for project-entered flight costs that do not have their own rate row." },
                { key: "hotelMargin", label: "Hotel Default Markup", margin: true, helper: "Fallback only. The hotel row above has its own item markup." },
                { key: "subsistenceMargin", label: "Subsistence Default Markup", margin: true, helper: "Fallback only. The subsistence row above has its own item markup." }
              ]}
            />
            <RateSection
              title="Subcontract, Materials & Equipment"
              description="Default markups for project-entered costs plus general report/equipment rates."
              badges={["All", "Markup"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "subcontractMargin", label: "Subcontract Default Markup", margin: true, helper: "Used when subcontract costs are entered inside a costing." },
                { key: "materialMargin", label: "Material Default Markup", margin: true, helper: "Used for repair materials and project-entered materials." },
                { key: "equipmentMargin", label: "Equipment Default Markup", margin: true, helper: "Used when equipment costs are entered inside a costing." },
                { key: "materialShippingMargin", label: "Material Shipping Default Markup", margin: true, helper: "Initial markup for new screeding material shipping inputs. It remains overridable per costing." },
                { key: "equipmentShippingMargin", label: "Equipment Shipping Default Markup", margin: true, helper: "Initial markup for new grinding and screeding equipment shipping inputs. It remains overridable per costing." },
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
              title="Screeding Materials"
              description="Default budget rates, markups and quantity uplifts used when a new screeding costing is started. New material quantities still begin at zero."
              badges={["Screeding", "Materials"]}
              rates={rates}
              onRateChange={updateRate}
              onMarginChange={updateMarginRate}
              onItemMarginChange={updateItemMargin}
              fields={[
                { key: "screedMaterialBagRate", label: "Screed Material", suffix: "/ bag" },
                { key: "screedPrimerUnitRate", label: "Primer", suffix: "/ unit" },
                { key: "screedSandBagRate", label: "Sand", suffix: "/ bag" },
                { key: "screedMaterialContingency", label: "Screed Contingency", percentage: true, helper: "Added to the base screed bag quantity." },
                { key: "screedMaterialWaste", label: "Screed Waste", percentage: true, helper: "Added to the base screed bag quantity." },
                { key: "screedPrimerContingency", label: "Primer Contingency", percentage: true, helper: "Added to the base primer quantity." },
                { key: "screedPrimerWaste", label: "Primer Waste", percentage: true, helper: "Added to the base primer quantity." },
                { key: "screedSandContingency", label: "Sand Contingency", percentage: true, helper: "Added to the base sand quantity." },
                { key: "screedSandWaste", label: "Sand Waste", percentage: true, helper: "Added to the base sand quantity." }
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
                { key: "repairFuelPerKm", label: `Repair Fuel / ${distanceCopy.singular}`, suffix: `/ ${distanceCopy.singular}` }
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
              <details className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={type.id}>
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
                {!type.materialRules.length && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">Add at least one required or optional material before using this repair type in a costing.</div>}
                <div className="grid gap-4 lg:grid-cols-4">
                  <Text label="Code" value={type.code} onChange={(v) => updateType(type.id!, { code: v })} />
                  <Text label="Repair Name" value={type.name} onChange={(v) => updateType(type.id!, { name: v })} />
                  <Select label="Measurement Basis" value={type.measurementBasis} options={["linear", "area", "each", "manual"]} onChange={(v) => updateType(type.id!, { measurementBasis: v as RepairType["measurementBasis"] })} />
                  <NumberInput label="Output Per Day" value={type.defaultOutputPerDay} onChange={(v) => updateType(type.id!, { defaultOutputPerDay: v })} />
                  <NumberInput label="Default Width mm" value={type.defaultWidthMm} onChange={(v) => updateType(type.id!, { defaultWidthMm: v })} />
                  <NumberInput label="Default Depth mm" value={type.defaultDepthMm} onChange={(v) => updateType(type.id!, { defaultDepthMm: v })} />
                  <NumberInput label="Default Thickness mm" value={type.defaultThicknessMm} onChange={(v) => updateType(type.id!, { defaultThicknessMm: v })} />
                  <Toggle label="Active" checked={type.active} onChange={(v) => updateType(type.id!, { active: v })} />
                </div>
                <div className="mt-4">
                  <Text label="Description" value={type.description} onChange={(v) => updateType(type.id!, { description: v })} />
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
                      const selectKey = `${type.id}-${role}`;
                      const selectValue = pendingRule[selectKey] || availableMaterials[0]?.id || "";
                      return (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" key={`${type.id}-${role}`}>
                          <div className="mb-2 text-xs font-bold uppercase text-slate-500">{role === "required" ? "Required materials" : "Optional materials"}</div>
                          <div className="flex flex-wrap gap-2">
                            {assignedRules.length ? assignedRules.map((rule) => {
                              const material = repairCatalog.materials.find((item) => item.id === rule.materialId);
                              return material ? (
                                <span className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${role === "required" ? "bg-sky-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`} key={`${type.id}-${role}-${rule.materialId}`}>
                                  <span className="truncate">{material.name}</span>
                                  {rule.role === "optional" && <button className="rounded-full bg-black/10 px-1.5 py-0.5" onClick={() => setRuleDefault(type.id!, rule.materialId, !rule.defaultSelected)}>{rule.defaultSelected ? "Default" : "Set default"}</button>}
                                  <button className="rounded-full bg-black/10 px-1.5 py-0.5" onClick={() => setMaterialRule(type.id!, rule.materialId, "none")}>Remove</button>
                                </span>
                              ) : null;
                            }) : <span className="text-sm text-slate-500">No {role} materials assigned.</span>}
                          </div>
                          {assignedRules.map((rule) => {
                            const material = repairCatalog.materials.find((item) => item.id === rule.materialId);
                            if (!material || material.calcMethod !== "volume_lwd") return null;
                            return <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-3" key={`${type.id}-${rule.materialId}-dimensions`}>
                              <Toggle label={`${material.name}: own dimensions`} checked={Boolean(rule.usesOwnDimensions)} onChange={(usesOwnDimensions) => updateMaterialRule(type.id!, rule.materialId, { usesOwnDimensions, defaultWidthMm: usesOwnDimensions ? rule.defaultWidthMm || type.defaultWidthMm : undefined, defaultDepthMm: usesOwnDimensions ? rule.defaultDepthMm || type.defaultDepthMm : undefined })} />
                              {rule.usesOwnDimensions && <NumberInput label="Default Width mm" value={rule.defaultWidthMm ?? type.defaultWidthMm} onChange={(defaultWidthMm) => updateMaterialRule(type.id!, rule.materialId, { defaultWidthMm })} />}
                              {rule.usesOwnDimensions && <NumberInput label="Default Depth mm" value={rule.defaultDepthMm ?? type.defaultDepthMm} onChange={(defaultDepthMm) => updateMaterialRule(type.id!, rule.materialId, { defaultDepthMm })} />}
                            </div>;
                          })}
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
                <p className="text-sm text-slate-600">Edit purchase unit size, cost per unit, coverage and waste. New repair costings use the latest costs; saved project calculations stay unchanged.</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold uppercase">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{repairCatalog.materials.length} materials</span>
                  <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-900">{repairCatalog.materials.filter((material) => material.active).length} active</span>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">{missingMaterialSetup.length} need setup</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{unusedMaterials.length} unused</span>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">{percent(rates.materialMargin * 100)} material markup</span>
                </div>
              </div>
              <button className="secondary-button" onClick={addMaterial}>Add Material</button>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
                <div>
                  <div className="text-sm font-bold text-emerald-950">Repair material markup</div>
                  <p className="mt-1 text-sm text-emerald-900">Materials below are entered as cost per unit. New project repair costing sells them at cost plus this markup.</p>
                </div>
                <NumberInput label="Material Markup %" value={rates.materialMargin * 100} onChange={(v) => setRates({ ...rates, materialMargin: v / 100 })} />
              </div>
            </div>
            <input placeholder="Search material, method or notes" value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} />
            {filteredMaterials.map((material) => (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={material.id}>
                {(material.costPerUnit <= 0 || material.unitSize <= 0 || material.coveragePerUnit <= 0) && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">Needs setup. Add unit size, cost per unit and coverage before relying on it in a costing.</div>}
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
                    <Text label="Notes" value={material.notes} onChange={(v) => updateMaterial(material.id, { notes: v })} />
                  </div>
                </details>
                <div className="mt-3 flex flex-wrap gap-2">
                  <div className="rounded-lg bg-white px-3 py-2 text-xs font-bold uppercase text-slate-500 ring-1 ring-slate-200">{formulaHelp(material.calcMethod)}</div>
                  <div className="rounded-lg bg-white px-3 py-2 text-xs font-bold uppercase text-slate-600 ring-1 ring-slate-200">One unit: {material.unitSize} {material.unitType}, covers {material.coveragePerUnit} {material.measuredUnitType}</div>
                  <div className="rounded-lg bg-white px-3 py-2 text-xs font-bold uppercase text-emerald-700 ring-1 ring-emerald-200">Sell/unit at {percent(rates.materialMargin * 100)} markup: {money(material.costPerUnit * (1 + rates.materialMargin))}</div>
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
  percentage?: boolean;
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
              {field.margin || field.percentage ? (
                <>
                  <NumberInput label={field.label} value={rawValue * 100} onChange={(value) => onMarginChange(field.key, value)} />
                  <div className="flex min-h-5 flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-emerald-700">{rawValue * 100}% {field.margin ? "default markup" : "default uplift"}</span>
                    {field.helper && <span>{field.helper}</span>}
                  </div>
                </>
              ) : (
                <>
                  <NumberInput label={`${field.label} - Budget Cost`} value={rawValue} onChange={(value) => onRateChange(field.key, value)} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <NumberInput label="Markup %" value={itemMargin * 100} onChange={(value) => onItemMarginChange(field.key, value)} />
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
  return <div className="app-card-strong"><div className="panel-heading"><h2 className="text-xl font-semibold"><FileSpreadsheet className="mr-2 inline" />Calculation Audit</h2><p className="text-sm text-slate-500">Independent calculation checks and project material take-off used by this costing.</p></div><div className="grid gap-4 p-5 md:grid-cols-3"><Metric label="Grinding Days" value={String(calculations.grindingDays)} /><Metric label="Screed Days" value={String(calculations.screedDays)} /><Metric label="Repair Days" value={String(calculations.repairDays)} /></div><LineTable lines={calculations.repairMaterialCalcs.map((m) => ({ section: "Materials", item: m.product, rate: m.rate, unit: m.unit, quantity: m.quantity, cost: m.cost, margin: 0, total: m.cost, discount: 0, originalTotal: m.cost, source: "Calculation audit", plCategory: "Materials" })) as Line[]} /></div>;
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return <div className="grid min-w-0 gap-1"><label htmlFor={id}>{label}</label><input id={id} value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}

function Choice({ active, title, detail, onClick }: { active: boolean; title: string; detail: string; onClick: () => void }) {
  return <button type="button" className={`min-h-[86px] rounded-xl border p-4 text-left ${active ? "border-sky-600 bg-sky-50 ring-1 ring-sky-200" : "border-slate-200 bg-white hover:bg-slate-50"}`} onClick={onClick}><b className="block text-sm text-slate-950">{title}</b><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{detail}</span></button>;
}

function NumberInput({ label, value, onChange, min = 0, max, step = "any" }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number | "any" }) {
  return <NumericField label={label} value={value} onChange={onChange} min={min} max={max} step={step} />;
}

function Select({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  return <div className="grid min-w-0 gap-1"><label htmlFor={id}>{label}</label><select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o}>{o}</option>)}</select></div>;
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return <div className="grid min-w-0 gap-1"><label htmlFor={id}>{label}</label><input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} /></div>;
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
