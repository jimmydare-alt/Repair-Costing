"use client";

import { calculateProject } from "./calculations";
import { defaultRates, emptyInput } from "./rates";
import { createRepairLine, defaultRepairCatalog } from "./repairCatalog";
import { createBrowserSupabaseClient, isSupabaseConfigured } from "./supabaseClient";
import type { AdminRates, ChangeLogEntry, PLActuals, ProjectInput, ProjectNote, ProjectRecord, ProjectStatus, QuoteRevision, RepairCatalog } from "./types";

const PROJECTS_KEY = "face-gmbh-contracting-projects-v2";
const RATES_KEY = "face-gmbh-contracting-rates-v2";
const REPAIR_CATALOG_KEY = "face-gmbh-repair-catalog-v1";

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const LOCAL_FACE_COMPANY_ID = "local-face-gmbh";

type StorageContext = {
  companyId?: string;
  actorName?: string;
  userId?: string;
};

let storageContext: StorageContext = {};

export function setStorageContext(context: StorageContext) {
  storageContext = context;
}

function activeCompanyId() {
  if (storageContext.companyId) return storageContext.companyId;
  if (typeof document !== "undefined") {
    const match = document.cookie.match(/(?:^|;\s*)active_company_id=([^;]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return LOCAL_FACE_COMPANY_ID;
}

function actorName(fallback = "System") {
  return storageContext.actorName || fallback;
}

async function supabaseSession() {
  const client = createBrowserSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  if (!data.session) return null;
  return { client, session: data.session };
}

async function supabaseContext() {
  const companyId = activeCompanyId();
  if (!companyId || companyId.startsWith("local-")) return null;
  const session = await supabaseSession();
  if (!session) return null;
  return { ...session, companyId };
}

function requireCloudContext(operation: string): never {
  throw new Error(`${operation} requires an authenticated company cloud session. No browser fallback was used.`);
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(value));
}

export async function loadRates(): Promise<AdminRates> {
  const supabase = await supabaseContext();
  if (supabase) {
    const { data, error } = await supabase.client.from("admin_rates").select("rates").eq("company_id", supabase.companyId).maybeSingle();
    if (error) throw new Error(`Could not load admin rates: ${error.message}`);
    if (data?.rates) return normaliseRates(data.rates as Partial<AdminRates>);
    return normaliseRates({});
  }
  if (isSupabaseConfigured()) requireCloudContext("Loading admin rates");
  const saved = readJson<Partial<AdminRates>>(RATES_KEY, {});
  return normaliseRates(saved);
}

function normaliseRates(saved: Partial<AdminRates>): AdminRates {
  const productionLabourDayRate = Number(saved.productionLabourDayRate ?? saved.repairInHouseLabourDayRate ?? saved.labourerDayRate ?? defaultRates.productionLabourDayRate);
  const productionLabourTravelDayRate = Number(saved.productionLabourTravelDayRate ?? saved.repairTravelDayRate ?? saved.labourerTravelDayRate ?? defaultRates.productionLabourTravelDayRate);
  const productionWeekendDayRate = Number(saved.productionWeekendDayRate ?? saved.repairWeekendDayRate ?? saved.weekendDayRate ?? defaultRates.productionWeekendDayRate);
  const productionNightShiftAllowance = Number(saved.productionNightShiftAllowance ?? saved.repairNightShiftAllowance ?? defaultRates.productionNightShiftAllowance);
  const surveyorTravelDayRate = Number(saved.surveyorTravelDayRate ?? saved.travelDayRate ?? defaultRates.surveyorTravelDayRate);
  const grindingGrinderDayRate = Number(saved.grindingGrinderDayRate ?? saved.grindingPropaneGrinderDayRate ?? saved.grindingElectricGrinderDayRate ?? defaultRates.grindingGrinderDayRate);
  const grindingPlanerDayRate = Number(saved.grindingPlanerDayRate ?? saved.grindingConcretePlanerGasDayRate ?? defaultRates.grindingPlanerDayRate);
  const savedMargins = saved.rateMargins ?? {};
  const rateMargins = {
    ...(defaultRates.rateMargins ?? {}),
    ...savedMargins,
    productionLabourDayRate: savedMargins.productionLabourDayRate ?? savedMargins.repairInHouseLabourDayRate ?? savedMargins.labourerDayRate ?? defaultRates.rateMargins?.productionLabourDayRate,
    productionLabourTravelDayRate: savedMargins.productionLabourTravelDayRate ?? savedMargins.repairTravelDayRate ?? savedMargins.labourerTravelDayRate ?? defaultRates.rateMargins?.productionLabourTravelDayRate,
    productionWeekendDayRate: savedMargins.productionWeekendDayRate ?? savedMargins.repairWeekendDayRate ?? savedMargins.weekendDayRate ?? defaultRates.rateMargins?.productionWeekendDayRate,
    productionNightShiftAllowance: savedMargins.productionNightShiftAllowance ?? savedMargins.repairNightShiftAllowance ?? defaultRates.rateMargins?.productionNightShiftAllowance,
    surveyorTravelDayRate: savedMargins.surveyorTravelDayRate ?? savedMargins.travelDayRate ?? defaultRates.rateMargins?.surveyorTravelDayRate,
    grindingGrinderDayRate: savedMargins.grindingGrinderDayRate ?? savedMargins.grindingPropaneGrinderDayRate ?? savedMargins.grindingElectricGrinderDayRate ?? defaultRates.rateMargins?.grindingGrinderDayRate,
    grindingPlanerDayRate: savedMargins.grindingPlanerDayRate ?? savedMargins.grindingConcretePlanerGasDayRate ?? defaultRates.rateMargins?.grindingPlanerDayRate
  };
  return {
    ...defaultRates,
    ...saved,
    productionLabourDayRate,
    productionLabourTravelDayRate,
    productionWeekendDayRate,
    productionNightShiftAllowance,
    surveyorTravelDayRate,
    grindingGrinderDayRate,
    grindingPlanerDayRate,
    materialMargin: saved.materialMargin === undefined || saved.materialMargin === 0.2 ? defaultRates.materialMargin : saved.materialMargin,
    rateMargins
  };
}

export async function saveRates(rates: AdminRates) {
  const saved = { ...defaultRates, ...rates, rateMargins: { ...(defaultRates.rateMargins ?? {}), ...(rates.rateMargins ?? {}) } };
  const supabase = await supabaseContext();
  if (supabase) {
    const { error } = await supabase.client.from("admin_rates").upsert({
      company_id: supabase.companyId,
      rates: saved,
      updated_by: supabase.session.user.id,
      updated_at: now()
    }, { onConflict: "company_id" });
    if (error) throw new Error(`Could not save admin rates: ${error.message}`);
    return;
  }
  if (isSupabaseConfigured()) requireCloudContext("Saving admin rates");
  writeJson(RATES_KEY, saved);
}

function mergeCatalog(saved: Partial<RepairCatalog>): RepairCatalog {
  const normaliseMaterial = (material: Partial<RepairCatalog["materials"][number]> & Record<string, unknown>) => {
    const fallback = defaultRepairCatalog.materials.find((item) => item.id === material.id);
    return {
      ...fallback,
      ...material,
      category: material.category ?? fallback?.category ?? "Other",
      unitType: material.unitType ?? fallback?.unitType ?? (material.unit === "m" ? "m" : "each"),
      unitSize: Number(material.unitSize ?? fallback?.unitSize ?? 1),
      costPerUnit: Number(material.costPerUnit ?? material.rate ?? fallback?.costPerUnit ?? 0),
      measuredUnitType: material.measuredUnitType ?? fallback?.measuredUnitType ?? (material.unit === "m" ? "m" : "litres"),
      coveragePerUnit: Number(material.coveragePerUnit ?? material.yieldDivisor ?? fallback?.coveragePerUnit ?? material.unitSize ?? 1),
      wasteFactor: Number(material.wasteFactor ?? fallback?.wasteFactor ?? 1),
      sourceNote: String(material.sourceNote ?? fallback?.sourceNote ?? "Admin"),
      active: material.active ?? fallback?.active ?? true,
      notes: String(material.notes ?? fallback?.notes ?? "")
    } as RepairCatalog["materials"][number];
  };
  const savedMaterials = (saved.materials ?? []).map((material) => normaliseMaterial(material as Partial<RepairCatalog["materials"][number]> & Record<string, unknown>));
  const savedTypes = saved.types ?? [];
  const materials = [
    ...savedMaterials,
    ...defaultRepairCatalog.materials.filter((material) => !savedMaterials.some((savedMaterial) => savedMaterial.id === material.id))
  ];
  const mergedSavedTypes = savedTypes.map((savedType) => {
    const defaultType = defaultRepairCatalog.types.find((type) => type.code === savedType.code);
    if (!defaultType) return savedType;
    return {
      ...savedType,
      materialRules: [
        ...savedType.materialRules,
        ...defaultType.materialRules.filter((rule) => !savedType.materialRules.some((savedRule) => savedRule.materialId === rule.materialId))
      ]
    };
  });
  const types = [
    ...mergedSavedTypes,
    ...defaultRepairCatalog.types.filter((type) => !savedTypes.some((savedType) => savedType.code === type.code))
  ];
  return {
    materials: materials.length ? materials : defaultRepairCatalog.materials,
    types: types.length ? types : defaultRepairCatalog.types
  };
}

export async function loadRepairCatalog(): Promise<RepairCatalog> {
  const supabase = await supabaseContext();
  if (supabase) {
    const { data, error } = await supabase.client.from("repair_catalogs").select("repair_types,repair_materials").eq("company_id", supabase.companyId).maybeSingle();
    if (error) throw new Error(`Could not load repair catalogue: ${error.message}`);
    if (data) return mergeCatalog({ types: data.repair_types as RepairCatalog["types"], materials: data.repair_materials as RepairCatalog["materials"] });
    return defaultRepairCatalog;
  }
  if (isSupabaseConfigured()) requireCloudContext("Loading repair catalogue");
  return mergeCatalog(readJson<Partial<RepairCatalog>>(REPAIR_CATALOG_KEY, {}));
}

export async function saveRepairCatalog(catalog: RepairCatalog) {
  const supabase = await supabaseContext();
  if (supabase) {
    const { error } = await supabase.client.from("repair_catalogs").upsert({
      company_id: supabase.companyId,
      repair_types: catalog.types,
      repair_materials: catalog.materials,
      updated_by: supabase.session.user.id,
      updated_at: now()
    }, { onConflict: "company_id" });
    if (error) throw new Error(`Could not save repair catalogue: ${error.message}`);
    return;
  }
  if (isSupabaseConfigured()) requireCloudContext("Saving repair catalogue");
  writeJson(REPAIR_CATALOG_KEY, catalog);
}

export async function loadRateVersions() {
  const supabase = await supabaseContext();
  if (!supabase) return [];
  const { data, error } = await supabase.client.from("rate_versions").select("*").eq("company_id", supabase.companyId).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(`Could not load rate versions: ${error.message}`);
  return data ?? [];
}

export async function saveRatesWithVersion(rates: AdminRates) {
  await saveRates(rates);
  const supabase = await supabaseContext();
  if (supabase) {
    const { error } = await supabase.client.from("rate_versions").insert({
      company_id: supabase.companyId,
      source: "admin_rates",
      rates,
      created_by: supabase.session.user.id
    });
    if (error) throw new Error(`Rates saved, but the rate version could not be recorded: ${error.message}`);
  }
}

function log(existing: ChangeLogEntry[] | undefined, actor: string, action: string, detail: string): ChangeLogEntry[] {
  return [{ id: uid(), createdAt: now(), actor, action, detail }, ...(existing ?? [])].slice(0, 200);
}

function makeRevision(input: ProjectInput, calculations: ProjectRecord["calculations"], rates: AdminRates, repairCatalog: RepairCatalog, actor: string): QuoteRevision {
  const approved = calculations.budgetCost > 0 && calculations.budgetProfit / calculations.budgetCost < 0.25 && Boolean(input.markupOverrideReason.trim());
  return { id: uid(), label: input.revision || "Revision", createdAt: now(), proposalTotal: calculations.proposalTotal, budgetCost: calculations.budgetCost, budgetMargin: calculations.budgetMargin, discountPercentage: input.discountPercentage, inputs: input, calculations, rates, repairCatalog, calculationVersion: "3.0", markupApprovedBy: approved ? actor : undefined, markupApprovedAt: approved ? now() : undefined };
}

function normaliseRepairSubcontractors(input?: Partial<ProjectInput>) {
  if (input?.repairs?.repairSubcontractors?.length) return input.repairs.repairSubcontractors;
  if (input?.repairs?.subcontractors?.length) {
    return input.repairs.subcontractors.map((item) => ({
      name: item.name,
      priceType: item.unit === "day" ? "day" as const : "lump sum" as const,
      rate: item.rate,
      days: item.unit === "day" ? item.quantity : 1,
      margin: item.margin,
      mobilisationCost: 0,
      mobilisations: 0,
      mobilisationMargin: 0.3
    }));
  }
  return emptyInput.repairs.repairSubcontractors;
}

function normaliseSubcontractors(items: unknown, fallbackName: string) {
  if (Array.isArray(items) && items.length) return items as ProjectInput["repairs"]["repairSubcontractors"];
  return [{ name: fallbackName, priceType: "lump sum" as const, rate: 0, days: 0, margin: 0.3, mobilisationCost: 0, mobilisations: 0, mobilisationMargin: 0.3 }];
}

function normaliseAdditionalItems(items: unknown): ProjectInput["additionalItems"] {
  const source = Array.isArray(items) && items.length ? items as ProjectInput["additionalItems"] : emptyInput.additionalItems;
  return source.map((item) => ({ ...item, plCategory: item.plCategory ?? "Equipment" }));
}

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normaliseActuals(actuals: PLActuals | undefined, calculations: ProjectRecord["calculations"]): PLActuals | undefined {
  if (!actuals) return undefined;
  const defaults = {
    actualPrice: calculations.proposalTotal,
    datesRequired: "",
    startDate: "",
    endDate: "",
    saturdayWorked: false,
    sundayWorked: false,
    travelDays: 0,
    daysTakenToComplete: calculations.siteDays,
    labourInternalDays: 0,
    labourInternalRate: 0,
    surveyDays: 0,
    surveyDayRate: 0,
    surveyTravelDays: 0,
    surveyTravelRate: 0,
    bonus: 0,
    labourInternal: 0,
    labourSubcontract: 0,
    repairs: 0,
    equipmentRental: 0,
    haulage: 0,
    materials: 0,
    engineeringReport: 0,
    travel: 0,
    hotel: 0,
    subsistence: 0,
    other: 0,
    completedAt: undefined
  };
  return {
    ...defaults,
    ...actuals,
    actualPrice: asNumber(actuals.actualPrice, calculations.proposalTotal),
    datesRequired: actuals.datesRequired ?? "",
    startDate: actuals.startDate ?? "",
    endDate: actuals.endDate ?? "",
    saturdayWorked: Boolean(actuals.saturdayWorked),
    sundayWorked: Boolean(actuals.sundayWorked),
    travelDays: asNumber(actuals.travelDays, 0),
    daysTakenToComplete: asNumber(actuals.daysTakenToComplete, calculations.siteDays),
    labourInternalDays: asNumber(actuals.labourInternalDays, 0),
    labourInternalRate: asNumber(actuals.labourInternalRate, 0),
    surveyDays: asNumber(actuals.surveyDays ?? actuals.labourInternalDays, 0),
    surveyDayRate: asNumber(actuals.surveyDayRate ?? actuals.labourInternalRate, 0),
    surveyTravelDays: asNumber(actuals.surveyTravelDays, 0),
    surveyTravelRate: asNumber(actuals.surveyTravelRate, 0),
    bonus: asNumber(actuals.bonus, 0),
    labourInternal: asNumber(actuals.labourInternal, 0) + asNumber(actuals.repairs, 0),
    labourSubcontract: asNumber(actuals.labourSubcontract, 0),
    repairs: 0,
    equipmentRental: asNumber(actuals.equipmentRental, 0),
    haulage: asNumber(actuals.haulage, 0),
    materials: asNumber(actuals.materials, 0),
    engineeringReport: asNumber(actuals.engineeringReport, 0),
    travel: asNumber(actuals.travel, 0),
    hotel: asNumber(actuals.hotel, 0),
    subsistence: asNumber(actuals.subsistence, 0),
    other: asNumber(actuals.other, 0)
  };
}

export function normaliseInput(input?: Partial<ProjectInput>): ProjectInput {
  const savedGrinding = (input?.grinding ?? {}) as Partial<ProjectInput["grinding"]>;
  const savedScreeding = (input?.screeding ?? {}) as Partial<ProjectInput["screeding"]>;
  const legacyGrindingDays = Number(savedGrinding.weeks ?? emptyInput.grinding.weeks) * Number(savedGrinding.daysPerWeek ?? emptyInput.grinding.daysPerWeek);
  const estimatedGrindingDays = Number(savedGrinding.estimatedDays ?? legacyGrindingDays ?? emptyInput.grinding.estimatedDays);
  const productionMen = Number(savedGrinding.productionMen ?? (savedGrinding.labourerRequired ? 1 : 0));
  const surveyorCount = Number(savedGrinding.surveyorCount ?? savedGrinding.surveyorsOnSite ?? emptyInput.grinding.surveyorCount);
  const screedDays = Number(savedScreeding.totalDaysOnSite ?? 0) || (Array.isArray(savedScreeding.teams) ? savedScreeding.teams.reduce((sum, team) => sum + (team.enabled ? Number(team.daysProgrammed ?? 0) : 0), 0) : 0);
  return {
    ...emptyInput,
    ...(input ?? {}),
    quoteCurrency: input?.quoteCurrency ?? emptyInput.quoteCurrency,
    exchangeRateToCompanyCurrency: asNumber(input?.exchangeRateToCompanyCurrency, 1),
    exchangeRateToGroupCurrency: asNumber(input?.exchangeRateToGroupCurrency, 1),
    projectTravelPeople: asNumber(input?.projectTravelPeople, emptyInput.projectTravelPeople),
    phaseSchedule: {
      ...emptyInput.phaseSchedule,
      ...(input?.phaseSchedule ?? {}),
      order: input?.phaseSchedule?.order?.length ? input.phaseSchedule.order : emptyInput.phaseSchedule.order,
      dayOverrides: input?.phaseSchedule?.dayOverrides ?? {},
      startsWithPrevious: input?.phaseSchedule?.startsWithPrevious ?? {}
    },
    projectManagement: { ...emptyInput.projectManagement, ...(input?.projectManagement ?? {}) },
    bdmBonusRequired: Boolean(input?.bdmBonusRequired),
    markupOverrideReason: input?.markupOverrideReason ?? "",
    grinding: {
      ...emptyInput.grinding,
      ...savedGrinding,
      estimatedDays: estimatedGrindingDays,
      productionMen,
      surveyorCount,
      productionLabourMode: savedGrinding.productionLabourMode ?? (savedGrinding.subcontractRate || savedGrinding.subcontractMobilisation ? "subcontract" : emptyInput.grinding.productionLabourMode),
      productionSubcontractors: normaliseSubcontractors(savedGrinding.productionSubcontractors, "Grinding subcontractor"),
      surveyorLabourMode: savedGrinding.surveyorLabourMode ?? emptyInput.grinding.surveyorLabourMode,
      surveyorSubcontractors: normaliseSubcontractors(savedGrinding.surveyorSubcontractors, "Grinding surveyor subcontractor")
    },
    screeding: {
      ...emptyInput.screeding,
      ...savedScreeding,
      totalDaysOnSite: screedDays,
      productionLabourMode: savedScreeding.productionLabourMode ?? "subcontract",
      productionLabourDays: Number(savedScreeding.productionLabourDays ?? 0),
      productionVehicles: Number(savedScreeding.productionVehicles ?? emptyInput.screeding.productionVehicles),
      surveyorLabourMode: savedScreeding.surveyorLabourMode ?? "in_house",
      surveyorDays: Number(savedScreeding.surveyorDays ?? screedDays),
      surveyorVehicles: Number(savedScreeding.surveyorVehicles ?? emptyInput.screeding.surveyorVehicles),
      surveyorSubcontractors: normaliseSubcontractors(savedScreeding.surveyorSubcontractors, "Screed surveyor subcontractor"),
      teams: (savedScreeding.teams?.length ? savedScreeding.teams : emptyInput.screeding.teams).map((team) => ({ ...team, margin: asNumber(team.margin, 0.3), mobilisationMargin: asNumber(team.mobilisationMargin, 0.3) }))
    },
    repairs: {
      ...emptyInput.repairs,
      ...(input?.repairs ?? {}),
      daysPerWeek: asNumber(input?.repairs?.daysPerWeek, emptyInput.repairs.daysPerWeek),
      repairSubcontractors: normaliseRepairSubcontractors(input),
      materialInputs: input?.repairs?.materialInputs?.length ? input.repairs.materialInputs : emptyInput.repairs.materialInputs,
      repairLines: Array.isArray(input?.repairs?.repairLines) ? input.repairs.repairLines : []
    },
    additionalItems: normaliseAdditionalItems(input?.additionalItems)
  };
}

export async function loadProjects(): Promise<ProjectRecord[]> {
  const supabase = await supabaseContext();
  if (supabase) {
    const { data, error } = await supabase.client.from("projects").select("*").eq("company_id", supabase.companyId).order("updated_at", { ascending: false });
    if (error) throw new Error(`Could not load projects: ${error.message}`);
    const ids = (data ?? []).map((row) => String(row.id));
    const actualsByProject = new Map<string, PLActuals>();
    if (ids.length) {
      const { data: actualRows, error: actualError } = await supabase.client.from("pl_actuals").select("project_id,actuals").in("project_id", ids);
      if (actualError) throw new Error(`Could not load P&L actuals: ${actualError.message}`);
      (actualRows ?? []).forEach((row) => actualsByProject.set(String(row.project_id), row.actuals as PLActuals));
    }
    return (data ?? []).map((row) => rowToProject(row as Record<string, unknown>, actualsByProject.get(String(row.id))));
  }
  if (isSupabaseConfigured()) requireCloudContext("Loading projects");
  return readJson<ProjectRecord[]>(PROJECTS_KEY, []).map((project) => ({ ...project, companyId: project.companyId ?? "local-face-gmbh", inputs: normaliseInput(project.inputs), actuals: normaliseActuals(project.actuals, project.calculations) }));
}

export async function saveProject(input: ProjectInput, rates: AdminRates, existingId?: string, actor = "System", repairCatalog: RepairCatalog = defaultRepairCatalog, status: ProjectStatus = "Quoted"): Promise<ProjectRecord> {
  const projects = await loadProjects();
  const existing = existingId ? projects.find((project) => project.id === existingId) : undefined;
  const inputs = normaliseInput(input);
  const calculations = calculateProject(inputs, rates, repairCatalog);
  const savedActor = actorName(actor);
  const companyId = activeCompanyId();
  const record: ProjectRecord = {
    id: existing?.id ?? uid(),
    companyId: existing?.companyId ?? companyId,
    createdAt: existing?.createdAt ?? now(),
    createdBy: existing?.createdBy ?? savedActor,
    updatedBy: savedActor,
    status,
    accountsStatus: existing?.accountsStatus ?? "Not Required",
    inputs,
    calculations,
    actuals: existing?.actuals,
    rateSnapshot: rates,
    repairCatalogSnapshot: repairCatalog,
    calculationVersion: "3.0",
    markupApprovedBy: calculations.budgetCost > 0 && calculations.budgetProfit / calculations.budgetCost < 0.25 && inputs.markupOverrideReason.trim() ? savedActor : undefined,
    markupApprovedAt: calculations.budgetCost > 0 && calculations.budgetProfit / calculations.budgetCost < 0.25 && inputs.markupOverrideReason.trim() ? now() : undefined,
    revisions: [...(existing?.revisions ?? []), makeRevision(inputs, calculations, rates, repairCatalog, savedActor)],
    notes: existing?.notes ?? [],
    changeLog: log(existing?.changeLog, savedActor, existing ? `${status} edited` : `${status} created`, `${inputs.projectReference || "Draft"} ${calculations.serviceSummary} ${calculations.proposalTotal}`)
  };
  const supabase = await supabaseContext();
  if (supabase) {
    const { error } = await supabase.client.from("projects").upsert(projectToRow(record, supabase.session.user.id), { onConflict: "id" });
    if (error) throw new Error(`Could not save project: ${error.message}`);
    return record;
  }
  if (isSupabaseConfigured()) requireCloudContext("Saving a project");
  writeJson(PROJECTS_KEY, existing ? projects.map((project) => project.id === record.id ? record : project) : [record, ...projects]);
  return record;
}

export async function updateProjectWorkflow(projectId: string, status: ProjectStatus, accountsStatus?: ProjectRecord["accountsStatus"], actor = "System") {
  const projects = await loadProjects();
  const updated = projects.map((project) => project.id === projectId ? { ...project, status, accountsStatus: accountsStatus ?? project.accountsStatus, changeLog: log(project.changeLog, actorName(actor), "Workflow changed", `${project.status} to ${status}`) } : project);
  const target = updated.find((project) => project.id === projectId);
  const supabase = await supabaseContext();
  if (supabase && target) {
    const { error } = await supabase.client.from("projects").update({
      status: target.status,
      accounts_status: target.accountsStatus,
      change_log: target.changeLog ?? [],
      updated_by: supabase.session.user.id,
      updated_at: now()
    }).eq("id", projectId).eq("company_id", supabase.companyId);
    if (error) throw new Error(`Could not update project workflow: ${error.message}`);
    return;
  }
  if (isSupabaseConfigured()) requireCloudContext("Updating project workflow");
  writeJson(PROJECTS_KEY, updated);
}

export async function saveActuals(projectId: string, actuals: PLActuals, actor = "System") {
  const projects = await loadProjects();
  const saved = { ...actuals, completedAt: now() };
  const updated = projects.map((project) => project.id === projectId ? { ...project, actuals: saved, accountsStatus: "Actuals Saved" as const, changeLog: log(project.changeLog, actorName(actor), "P&L actuals saved", `${saved.actualPrice}`) } : project);
  const target = updated.find((project) => project.id === projectId);
  const supabase = await supabaseContext();
  if (supabase && target) {
    const { error: actualError } = await supabase.client.from("pl_actuals").upsert({
      project_id: projectId,
      company_id: supabase.companyId,
      actual_price: saved.actualPrice,
      actuals: saved,
      programme: {
        startDate: saved.startDate,
        endDate: saved.endDate,
        saturdayWorked: saved.saturdayWorked,
        sundayWorked: saved.sundayWorked,
        travelDays: saved.travelDays,
        daysTakenToComplete: saved.daysTakenToComplete
      },
      status: "Actuals Saved",
      saved_by: supabase.session.user.id,
      saved_at: now(),
      updated_at: now()
    }, { onConflict: "project_id" });
    if (actualError) throw new Error(`Could not save P&L actuals: ${actualError.message}`);
    const { error: projectError } = await supabase.client.from("projects").update({
      actuals: saved,
      accounts_status: "Actuals Saved",
      change_log: target.changeLog ?? [],
      updated_by: supabase.session.user.id,
      updated_at: now()
    }).eq("id", projectId).eq("company_id", supabase.companyId);
    if (projectError) throw new Error(`Could not update project after P&L save: ${projectError.message}`);
    return saved;
  }
  if (isSupabaseConfigured()) requireCloudContext("Saving P&L actuals");
  writeJson(PROJECTS_KEY, updated);
  return saved;
}

export async function addProjectNote(projectId: string, note: Omit<ProjectNote, "id" | "createdAt">) {
  const projects = await loadProjects();
  const saved: ProjectNote = { ...note, id: uid(), createdAt: now() };
  const updated = projects.map((project) => project.id === projectId ? { ...project, notes: [saved, ...(project.notes ?? [])], changeLog: log(project.changeLog, note.author, "Note added", note.category) } : project);
  const target = updated.find((project) => project.id === projectId);
  const supabase = await supabaseContext();
  if (supabase && target) {
    const { error } = await supabase.client.from("projects").update({
      notes: target.notes ?? [],
      change_log: target.changeLog ?? [],
      updated_by: supabase.session.user.id,
      updated_at: now()
    }).eq("id", projectId).eq("company_id", supabase.companyId);
    if (error) throw new Error(`Could not save note: ${error.message}`);
    return saved;
  }
  if (isSupabaseConfigured()) requireCloudContext("Saving a project note");
  writeJson(PROJECTS_KEY, updated);
  return saved;
}

function rowToProject(row: Record<string, unknown>, actuals?: PLActuals): ProjectRecord {
  const inputs = normaliseInput(row.inputs as Partial<ProjectInput>);
  const calculations = row.calculations as ProjectRecord["calculations"];
  const revisions = Array.isArray(row.revisions) ? row.revisions as QuoteRevision[] : [];
  const latestRevision = revisions[revisions.length - 1];
  return {
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : undefined,
    createdAt: String(row.created_at ?? now()),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    updatedBy: row.updated_by ? String(row.updated_by) : undefined,
    status: (row.status as ProjectStatus) ?? "Draft",
    accountsStatus: (row.accounts_status as ProjectRecord["accountsStatus"]) ?? "Not Required",
    inputs,
    calculations,
    actuals: normaliseActuals(actuals ?? row.actuals as PLActuals | undefined, calculations),
    rateSnapshot: latestRevision?.rates,
    repairCatalogSnapshot: latestRevision?.repairCatalog,
    calculationVersion: latestRevision?.calculationVersion,
    markupApprovedBy: latestRevision?.markupApprovedBy,
    markupApprovedAt: latestRevision?.markupApprovedAt,
    revisions,
    notes: Array.isArray(row.notes) ? row.notes as ProjectNote[] : [],
    changeLog: Array.isArray(row.change_log) ? row.change_log as ChangeLogEntry[] : []
  };
}

function projectToRow(project: ProjectRecord, userId: string) {
  return {
    id: project.id,
    company_id: project.companyId,
    created_by: project.createdBy && project.createdBy.length === 36 ? project.createdBy : userId,
    updated_by: userId,
    name: project.inputs.projectReference || "Untitled Project",
    client: project.inputs.client || null,
    status: project.status,
    accounts_status: project.accountsStatus,
    proposal_price: project.calculations.proposalTotal,
    budget_cost: project.calculations.budgetCost,
    quote_currency: project.inputs.quoteCurrency,
    exchange_rate_to_company_currency: project.inputs.exchangeRateToCompanyCurrency,
    exchange_rate_to_group_currency: project.inputs.exchangeRateToGroupCurrency,
    exchange_rate_locked_at: project.inputs.exchangeRateLockedAt || null,
    inputs: project.inputs,
    calculations: project.calculations,
    actuals: project.actuals ?? {},
    notes: project.notes ?? [],
    revisions: project.revisions ?? [],
    change_log: project.changeLog ?? [],
    updated_at: now()
  };
}
