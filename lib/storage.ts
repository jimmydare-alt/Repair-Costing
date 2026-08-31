"use client";

import { calculateActualSiteDays, calculateProject, normaliseStoredCalculations } from "./calculations";
import { defaultRates, emptyInput } from "./rates";
import { createRepairLine, defaultRepairCatalog } from "./repairCatalog";
import { allowedStatusTransitions, normaliseProjectStatus } from "./workflow";
import { createBrowserSupabaseClient, isSupabaseConfigured } from "./supabaseClient";
import type { AdminRates, ChangeLogEntry, PackageSelection, PLActuals, ProjectInput, ProjectNote, ProjectRecord, ProjectStatus, ProjectTimeEntry, QuoteRevision, RateVersionRecord, RepairCatalog } from "./types";
import { calculateSurveyProject } from "./costing/survey/calculations";
import { normaliseSurveyInput, normaliseSurveyRates } from "./costing/survey/defaults";
import { normaliseWorkPackages } from "./workPackages";

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
  throw new Error(`${operation} could not start because your secure company session is not ready. Sign out, sign in again and retry. Nothing was saved locally.`);
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
  const surveyorWeekendDayRate = Number(saved.surveyorWeekendDayRate ?? saved.surveyorDayRate ?? defaultRates.surveyorWeekendDayRate);
  const surveyorNightShiftAllowance = Number(saved.surveyorNightShiftAllowance ?? saved.productionNightShiftAllowance ?? defaultRates.surveyorNightShiftAllowance);
  const grindingSurveyorDayRate = Number(saved.grindingSurveyorDayRate ?? saved.surveyorDayRate ?? defaultRates.grindingSurveyorDayRate);
  const grindingSurveyorTravelDayRate = Number(saved.grindingSurveyorTravelDayRate ?? saved.surveyorTravelDayRate ?? saved.travelDayRate ?? defaultRates.grindingSurveyorTravelDayRate);
  const grindingSurveyorWeekendDayRate = Number(saved.grindingSurveyorWeekendDayRate ?? saved.surveyorWeekendDayRate ?? saved.weekendDayRate ?? defaultRates.grindingSurveyorWeekendDayRate);
  const grindingHotelNightRate = Number(saved.grindingHotelNightRate ?? saved.hotel ?? defaultRates.grindingHotelNightRate);
  const grindingEngineeringReportRate = Number(saved.grindingEngineeringReportRate ?? saved.engineeringReport ?? defaultRates.grindingEngineeringReportRate);
  const screedSurveyorDayRate = Number(saved.screedSurveyorDayRate ?? saved.surveyorDayRate ?? defaultRates.screedSurveyorDayRate);
  const screedSurveyorTravelDayRate = Number(saved.screedSurveyorTravelDayRate ?? saved.surveyorTravelDayRate ?? saved.travelDayRate ?? defaultRates.screedSurveyorTravelDayRate);
  const screedSurveyorWeekendDayRate = Number(saved.screedSurveyorWeekendDayRate ?? saved.surveyorWeekendDayRate ?? saved.weekendDayRate ?? defaultRates.screedSurveyorWeekendDayRate);
  const screedHotelNightRate = Number(saved.screedHotelNightRate ?? saved.hotel ?? defaultRates.screedHotelNightRate);
  const screedEngineeringReportRate = Number(saved.screedEngineeringReportRate ?? saved.engineeringReport ?? defaultRates.screedEngineeringReportRate);
  const materialShippingMargin = Number(saved.materialShippingMargin ?? saved.shippingMargin ?? defaultRates.materialShippingMargin);
  const equipmentShippingMargin = Number(saved.equipmentShippingMargin ?? saved.shippingMargin ?? defaultRates.equipmentShippingMargin);
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
    surveyorWeekendDayRate: savedMargins.surveyorWeekendDayRate ?? savedMargins.surveyorDayRate ?? defaultRates.rateMargins?.surveyorWeekendDayRate,
    surveyorNightShiftAllowance: savedMargins.surveyorNightShiftAllowance ?? savedMargins.productionNightShiftAllowance ?? defaultRates.rateMargins?.surveyorNightShiftAllowance,
    grindingSurveyorDayRate: savedMargins.grindingSurveyorDayRate ?? savedMargins.surveyorDayRate ?? defaultRates.rateMargins?.grindingSurveyorDayRate,
    grindingSurveyorTravelDayRate: savedMargins.grindingSurveyorTravelDayRate ?? savedMargins.surveyorTravelDayRate ?? savedMargins.travelDayRate ?? defaultRates.rateMargins?.grindingSurveyorTravelDayRate,
    grindingSurveyorWeekendDayRate: savedMargins.grindingSurveyorWeekendDayRate ?? savedMargins.surveyorWeekendDayRate ?? savedMargins.weekendDayRate ?? defaultRates.rateMargins?.grindingSurveyorWeekendDayRate,
    grindingHotelNightRate: savedMargins.grindingHotelNightRate ?? savedMargins.hotel ?? defaultRates.rateMargins?.grindingHotelNightRate,
    grindingEngineeringReportRate: savedMargins.grindingEngineeringReportRate ?? savedMargins.engineeringReport ?? defaultRates.rateMargins?.grindingEngineeringReportRate,
    screedSurveyorDayRate: savedMargins.screedSurveyorDayRate ?? savedMargins.surveyorDayRate ?? defaultRates.rateMargins?.screedSurveyorDayRate,
    screedSurveyorTravelDayRate: savedMargins.screedSurveyorTravelDayRate ?? savedMargins.surveyorTravelDayRate ?? savedMargins.travelDayRate ?? defaultRates.rateMargins?.screedSurveyorTravelDayRate,
    screedSurveyorWeekendDayRate: savedMargins.screedSurveyorWeekendDayRate ?? savedMargins.surveyorWeekendDayRate ?? savedMargins.weekendDayRate ?? defaultRates.rateMargins?.screedSurveyorWeekendDayRate,
    screedHotelNightRate: savedMargins.screedHotelNightRate ?? savedMargins.hotel ?? defaultRates.rateMargins?.screedHotelNightRate,
    screedEngineeringReportRate: savedMargins.screedEngineeringReportRate ?? savedMargins.engineeringReport ?? defaultRates.rateMargins?.screedEngineeringReportRate,
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
    surveyorWeekendDayRate,
    surveyorNightShiftAllowance,
    grindingSurveyorDayRate,
    grindingSurveyorTravelDayRate,
    grindingSurveyorWeekendDayRate,
    grindingHotelNightRate,
    grindingEngineeringReportRate,
    screedSurveyorDayRate,
    screedSurveyorTravelDayRate,
    screedSurveyorWeekendDayRate,
    screedHotelNightRate,
    screedEngineeringReportRate,
    materialShippingMargin,
    equipmentShippingMargin,
    grindingGrinderDayRate,
    grindingPlanerDayRate,
    materialMargin: saved.materialMargin === undefined || saved.materialMargin === 0.2 ? defaultRates.materialMargin : saved.materialMargin,
    rateMargins,
    surveyRates: normaliseSurveyRates(saved.surveyRates)
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
  const materials = savedMaterials.length ? savedMaterials.map((material) => ({ ...material, active: material.active && material.costPerUnit > 0 && material.unitSize > 0 && material.coveragePerUnit > 0 })) : defaultRepairCatalog.materials;
  const materialMap = new Map(materials.map((material) => [material.id, material]));
  const types = (savedTypes.length ? savedTypes : defaultRepairCatalog.types).map((type, index) => {
    const defaultType = defaultRepairCatalog.types.find((item) => item.code === type.code);
    const materialRules = (type.materialRules ?? []).map((rule) => ({
      ...defaultType?.materialRules.find((item) => item.materialId === rule.materialId),
      ...rule
    }));
    const usableRules = materialRules.filter((rule) => materialMap.get(rule.materialId)?.active);
    return { ...type, id: type.id ?? `repair-type-${index + 1}`, materialRules, active: type.active && type.defaultOutputPerDay > 0 && usableRules.length > 0 };
  });
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
    return mergeCatalog(defaultRepairCatalog);
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

export async function loadRateVersions(): Promise<RateVersionRecord[]> {
  const supabase = await supabaseContext();
  if (!supabase) return [];
  const { data, error } = await supabase.client.from("rate_versions").select("*").eq("company_id", supabase.companyId).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(`Could not load rate versions: ${error.message}`);
  const creatorIds = Array.from(new Set((data ?? []).map((row) => row.created_by).filter(Boolean)));
  const creatorLabels = new Map<string, string>();
  if (creatorIds.length) {
    const { data: profiles } = await supabase.client.from("profiles").select("id,full_name,email").in("id", creatorIds);
    (profiles ?? []).forEach((profile) => creatorLabels.set(String(profile.id), String(profile.full_name || profile.email || String(profile.id).slice(0, 8))));
  }
  return (data ?? []).map((row) => ({
    id: String(row.id), companyId: String(row.company_id), source: String(row.source ?? "admin_rates"),
    rates: normaliseRates(row.rates as Partial<AdminRates>), createdBy: row.created_by ? String(row.created_by) : undefined,
    createdByLabel: row.created_by ? creatorLabels.get(String(row.created_by)) ?? `User ${String(row.created_by).slice(0, 8)}` : "System",
    createdAt: String(row.created_at ?? now())
  }));
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

export async function saveAdminData(rates: AdminRates, catalog: RepairCatalog) {
  const supabase = await supabaseContext();
  if (supabase) {
    const { error } = await supabase.client.rpc("save_admin_bundle", {
      target_company_id: supabase.companyId,
      rates_value: rates,
      repair_types_value: catalog.types,
      repair_materials_value: catalog.materials
    });
    if (error) throw new Error(`Could not save admin data: ${error.message}`);
    return;
  }
  if (isSupabaseConfigured()) requireCloudContext("Saving admin data");
  await saveRatesWithVersion(rates);
  await saveRepairCatalog(catalog);
}

function log(existing: ChangeLogEntry[] | undefined, actor: string, action: string, detail: string): ChangeLogEntry[] {
  return [{ id: uid(), createdAt: now(), actor, action, detail }, ...(existing ?? [])].slice(0, 200);
}

function makeRevision(input: ProjectInput, calculations: ProjectRecord["calculations"], rates: AdminRates, repairCatalog: RepairCatalog): QuoteRevision {
  return { id: uid(), label: input.revision || "Revision", createdAt: now(), proposalTotal: calculations.proposalTotal, budgetCost: calculations.budgetCost, budgetMargin: calculations.budgetMargin, discountPercentage: input.costingModule === "survey" ? input.survey?.discountPercentage ?? 0 : input.discountPercentage, inputs: input, calculations, rates, repairCatalog, calculationVersion: input.costingModule === "survey" ? "survey-1.1" : "remedial-6.0" };
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
    daysTakenToComplete: 0,
    siteDaysOverridden: false,
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
    surveyorInternal: 0,
    projectManagerInternal: 0,
    labourerInternal: 0,
    completedAt: undefined
  };
  const normalisedDays = asNumber(actuals.daysTakenToComplete, 0);
  const calculatedDays = calculateActualSiteDays({ ...defaults, ...actuals, daysTakenToComplete: normalisedDays } as PLActuals);
  const siteDaysOverridden = actuals.siteDaysOverridden ?? Boolean(actuals.startDate && actuals.endDate && normalisedDays !== calculatedDays);
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
    daysTakenToComplete: siteDaysOverridden ? normalisedDays : calculatedDays,
    siteDaysOverridden,
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
    other: asNumber(actuals.other, 0),
    surveyorInternal: asNumber(actuals.surveyorInternal, 0),
    projectManagerInternal: asNumber(actuals.projectManagerInternal, 0),
    labourerInternal: asNumber(actuals.labourerInternal, 0)
  };
}

export function normaliseInput(input?: Partial<ProjectInput>): ProjectInput {
  const savedGrinding = (input?.grinding ?? {}) as Partial<ProjectInput["grinding"]>;
  const savedScreeding = (input?.screeding ?? {}) as Partial<ProjectInput["screeding"]>;
  const hasLegacyGrindingProgramme = savedGrinding.estimatedDays == null && savedGrinding.weeks != null && savedGrinding.daysPerWeek != null;
  const legacyGrindingDays = hasLegacyGrindingProgramme ? Number(savedGrinding.weeks) * Number(savedGrinding.daysPerWeek) : 0;
  const estimatedGrindingDays = Number(savedGrinding.estimatedDays ?? legacyGrindingDays);
  const productionMen = Number(savedGrinding.productionMen ?? (savedGrinding.labourerRequired ? 1 : 0));
  const surveyorCount = Number(savedGrinding.surveyorCount ?? savedGrinding.surveyorsOnSite ?? emptyInput.grinding.surveyorCount);
  const preparationDays = Number(savedScreeding.preparationDays ?? savedScreeding.pourDays ?? 0);
  const screedingDays = Number(savedScreeding.screedingDays ?? savedScreeding.screwDays ?? 0);
  const grindingDays = Number(savedScreeding.grindingDays ?? savedScreeding.primerDays ?? 0);
  const activityDays = preparationDays + screedingDays + grindingDays;
  const screedDays = Number(savedScreeding.totalDaysOnSite ?? 0) || activityDays;
  const officeCount: ProjectInput["officeCount"] = input?.officeCount === 2 || Number(input?.survey?.secondaryOfficeDistanceOneWay) > 0 ? 2 : 1;
  const legacyMode = (mode: ProjectInput["projectManagement"]["travelMode"] | undefined, ...values: unknown[]) => mode ?? (values.some((value) => Number(value) > 0) ? "Drive" : "None");
  const normalisedTeams = (savedScreeding.teams ?? []).filter((team) => team.enabled !== false || Boolean(team.contractorName || team.rate || team.mobilisation || team.prep || team.screed || team.grind)).map((team) => ({
    ...team,
    enabled: true,
    scabble: false,
    preparationDays: Number(team.preparationDays ?? (team.prep ? preparationDays : 0)),
    screedingDays: Number(team.screedingDays ?? (team.screed ? screedingDays : 0)),
    grindingDays: Number(team.grindingDays ?? (team.grind ? grindingDays : 0)),
    margin: asNumber(team.margin, 0.3),
    mobilisationMargin: asNumber(team.mobilisationMargin, 0.3)
  }));
  return {
    ...emptyInput,
    ...(input ?? {}),
    costingModule: input?.costingModule === "survey" ? "survey" : "remedial",
    distanceUnit: input?.distanceUnit === "miles" ? "miles" : "km",
    officeCount,
    quoteCurrency: input?.quoteCurrency ?? emptyInput.quoteCurrency,
    exchangeRateToCompanyCurrency: asNumber(input?.exchangeRateToCompanyCurrency, 1) > 0 ? asNumber(input?.exchangeRateToCompanyCurrency, 1) : 1,
    exchangeRateToGroupCurrency: asNumber(input?.exchangeRateToGroupCurrency, 1) > 0 ? asNumber(input?.exchangeRateToGroupCurrency, 1) : 1,
    projectTravelPeople: asNumber(input?.projectTravelPeople, emptyInput.projectTravelPeople),
    projectTravelProductionPeople: asNumber(input?.projectTravelProductionPeople, input?.projectTravelPeople ?? emptyInput.projectTravelProductionPeople),
    projectTravelSurveyorPeople: asNumber(input?.projectTravelSurveyorPeople, emptyInput.projectTravelSurveyorPeople),
    projectTravelOtherPeople: asNumber(input?.projectTravelOtherPeople, emptyInput.projectTravelOtherPeople),
    pricingMode: input?.pricingMode === "selectable" ? "selectable" : "combined",
    selectionConfirmed: Boolean(input?.selectionConfirmed),
    sharedCosts: normaliseAdditionalItems(input?.sharedCosts),
    workPackages: normaliseWorkPackages(input?.workPackages, { ...emptyInput, ...(input ?? {}) } as ProjectInput),
    activeWorkPackageId: input?.activeWorkPackageId ?? "",
    phaseSchedule: {
      ...emptyInput.phaseSchedule,
      ...(input?.phaseSchedule ?? {}),
      order: input?.phaseSchedule?.order?.length ? input.phaseSchedule.order : emptyInput.phaseSchedule.order,
      startDays: input?.phaseSchedule?.startDays ?? {},
      dayOverrides: input?.phaseSchedule?.dayOverrides ?? {},
      startsWithPrevious: input?.phaseSchedule?.startsWithPrevious ?? {}
    },
    projectManagement: {
      ...emptyInput.projectManagement,
      ...(input?.projectManagement ?? {}),
      travelMode: legacyMode(input?.projectManagement?.travelMode, input?.projectManagement?.travelDays, input?.projectManagement?.oneWayKm)
    },
    bdmBonusRequired: Boolean(input?.bdmBonusRequired),
    markupOverrideReason: input?.markupOverrideReason ?? "",
    uiProgress: { ...emptyInput.uiProgress, ...(input?.uiProgress ?? {}) },
    grinding: {
      ...emptyInput.grinding,
      ...savedGrinding,
      estimatedDays: estimatedGrindingDays,
      equipmentShippingMargin: asNumber(savedGrinding.equipmentShippingMargin, emptyInput.grinding.equipmentShippingMargin),
      generatorCount: Number(savedGrinding.generatorCount ?? (savedGrinding.generatorRequired ? 1 : 0)),
      additionalTools: Array.isArray(savedGrinding.additionalTools) ? savedGrinding.additionalTools.map((item) => ({ ...item, unit: "item", quantity: 1, plCategory: "Equipment" as const })) : [],
      productionMen,
      productionTravelMode: legacyMode(savedGrinding.productionTravelMode, savedGrinding.productionTravelDays, savedGrinding.productionOneWayKm),
      productionNightShifts: Number(savedGrinding.productionNightShifts ?? savedGrinding.nightShifts ?? 0),
      surveyorCount,
      surveyorTravelMode: legacyMode(savedGrinding.surveyorTravelMode, savedGrinding.surveyorTravelDays, savedGrinding.surveyorOneWayKm),
      surveyorNightShifts: Number(savedGrinding.surveyorNightShifts ?? savedGrinding.nightShifts ?? 0),
      productionLabourMode: savedGrinding.productionLabourMode ?? (savedGrinding.subcontractRate || savedGrinding.subcontractMobilisation ? "subcontract" : emptyInput.grinding.productionLabourMode),
      productionSubcontractors: normaliseSubcontractors(savedGrinding.productionSubcontractors, "Grinding subcontractor"),
      surveyorLabourMode: savedGrinding.surveyorLabourMode ?? emptyInput.grinding.surveyorLabourMode,
      surveyorSubcontractors: normaliseSubcontractors(savedGrinding.surveyorSubcontractors, "Grinding surveyor subcontractor")
    },
    screeding: {
      ...emptyInput.screeding,
      ...savedScreeding,
      preparationDays,
      screedingDays,
      grindingDays,
      totalDaysOnSite: screedDays,
      materialShippingMargin: asNumber(savedScreeding.materialShippingMargin, emptyInput.screeding.materialShippingMargin),
      equipmentShippingMargin: asNumber(savedScreeding.equipmentShippingMargin, emptyInput.screeding.equipmentShippingMargin),
      productionLabourMode: savedScreeding.productionLabourMode ?? "subcontract",
      productionLabourDays: Number(savedScreeding.productionLabourDays ?? 0),
      productionTravelMode: legacyMode(savedScreeding.productionTravelMode, savedScreeding.productionTravelDays, savedScreeding.productionOneWayKm),
      productionNightShifts: Number(savedScreeding.productionNightShifts ?? savedScreeding.nightShifts ?? 0),
      productionVehicles: Number(savedScreeding.productionVehicles ?? emptyInput.screeding.productionVehicles),
      surveyorLabourMode: savedScreeding.surveyorLabourMode ?? "in_house",
      surveyorDays: Number(savedScreeding.surveyorDays ?? screedDays),
      surveyorTravelMode: legacyMode(savedScreeding.surveyorTravelMode, savedScreeding.surveyorTravelDays, savedScreeding.surveyorOneWayKm),
      surveyorNightShifts: Number(savedScreeding.surveyorNightShifts ?? savedScreeding.nightShifts ?? 0),
      surveyorVehicles: Number(savedScreeding.surveyorVehicles ?? emptyInput.screeding.surveyorVehicles),
      surveyorSubcontractors: normaliseSubcontractors(savedScreeding.surveyorSubcontractors, "Screed surveyor subcontractor"),
      teams: normalisedTeams
    },
    repairs: {
      ...emptyInput.repairs,
      ...(input?.repairs ?? {}),
      daysPerWeek: asNumber(input?.repairs?.daysPerWeek, emptyInput.repairs.daysPerWeek),
      travelMode: legacyMode(input?.repairs?.travelMode, input?.repairs?.travelDays, input?.repairs?.mobilisationOneWayKm),
      repairSubcontractors: normaliseRepairSubcontractors(input),
      materialInputs: input?.repairs?.materialInputs?.length ? input.repairs.materialInputs : emptyInput.repairs.materialInputs,
      repairLines: Array.isArray(input?.repairs?.repairLines) ? input.repairs.repairLines : []
    },
    additionalItems: normaliseAdditionalItems(input?.additionalItems),
    survey: input?.costingModule === "survey" ? normaliseSurveyInput(input.survey, input.quoteCurrency ?? "EUR", input.distanceUnit === "miles" ? "miles" : "km", officeCount) : input?.survey
  };
}

export async function loadProjects(): Promise<ProjectRecord[]> {
  const supabase = await supabaseContext();
  if (supabase) {
    const { data, error } = await supabase.client.from("projects").select("*").eq("company_id", supabase.companyId).is("deleted_at", null).order("updated_at", { ascending: false });
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
  return readJson<ProjectRecord[]>(PROJECTS_KEY, []).filter((project) => !project.deletedAt).map((project) => ({ ...project, companyId: project.companyId ?? "local-face-gmbh", inputs: normaliseInput(project.inputs), actuals: normaliseActuals(project.actuals, project.calculations), rateSnapshot: project.rateSnapshot ? normaliseRates(project.rateSnapshot) : undefined }));
}

export async function loadDeletedProjects(): Promise<ProjectRecord[]> {
  const supabase = await supabaseContext();
  if (supabase) {
    const { data, error } = await supabase.client.from("projects").select("*").eq("company_id", supabase.companyId).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(100);
    if (error) throw new Error(`Could not load the recycle bin: ${error.message}`);
    return (data ?? []).map((row) => rowToProject(row as Record<string, unknown>));
  }
  if (isSupabaseConfigured()) requireCloudContext("Loading the recycle bin");
  return readJson<ProjectRecord[]>(PROJECTS_KEY, []).filter((project) => Boolean(project.deletedAt)).map((project) => ({ ...project, inputs: normaliseInput(project.inputs), rateSnapshot: project.rateSnapshot ? normaliseRates(project.rateSnapshot) : undefined }));
}

type SaveProjectOptions = { autosave?: boolean };

export async function saveProject(input: ProjectInput, rates: AdminRates, existingId?: string, actor = "System", repairCatalog: RepairCatalog = defaultRepairCatalog, status: ProjectStatus = "Draft", options: SaveProjectOptions = {}): Promise<ProjectRecord> {
  const projects = await loadProjects();
  const existing = existingId ? projects.find((project) => project.id === existingId) : undefined;
  if (existing && ["Lost", "Completed", "Closed"].includes(normaliseProjectStatus(existing.status))) throw new Error(`${normaliseProjectStatus(existing.status)} projects are locked and cannot be revised.`);
  const inputs = normaliseInput(input);
  const calculations = inputs.costingModule === "survey" && inputs.survey
    ? calculateSurveyProject(inputs.survey, rates.surveyRates)
    : calculateProject(inputs, rates, repairCatalog);
  const savedActor = actorName(actor);
  const companyId = activeCompanyId();
  const record: ProjectRecord = {
    id: existing?.id ?? uid(),
    companyId: existing?.companyId ?? companyId,
    createdAt: existing?.createdAt ?? now(),
    createdBy: existing?.createdBy ?? savedActor,
    updatedBy: savedActor,
    status: normaliseProjectStatus(status),
    accountsStatus: existing?.accountsStatus ?? "Not Required",
    inputs,
    calculations,
    actuals: existing?.actuals,
    rateSnapshot: rates,
    repairCatalogSnapshot: repairCatalog,
    calculationVersion: inputs.costingModule === "survey" ? "survey-1.1" : "remedial-6.1",
    revisions: normaliseProjectStatus(status) === "Costing Complete"
      ? [...(existing?.revisions ?? []), makeRevision(inputs, calculations, rates, repairCatalog)]
      : existing?.revisions ?? [],
    notes: existing?.notes ?? [],
    changeLog: options.autosave && existing
      ? existing.changeLog ?? []
      : log(existing?.changeLog, savedActor, options.autosave ? "Draft autosaved" : existing ? `${status} edited` : `${status} created`, `${inputs.projectReference || "Draft"} ${calculations.serviceSummary} ${calculations.proposalTotal}`),
    timeEntries: existing?.timeEntries ?? []
  };
  const supabase = await supabaseContext();
  if (supabase) {
    const { error } = await supabase.client.from("projects").upsert(projectToRow(record, supabase.session.user.id), { onConflict: "id" });
    if (error) throw new Error(`Could not save project: ${error.message}`);
    return record;
  }
  if (isSupabaseConfigured()) requireCloudContext("Saving a project");
  const allProjects = readJson<ProjectRecord[]>(PROJECTS_KEY, []);
  writeJson(PROJECTS_KEY, existing ? allProjects.map((project) => project.id === record.id ? record : project) : [record, ...allProjects]);
  return record;
}

export async function deleteProject(projectId: string, reason = "Moved to recycle bin") {
  const projects = await loadProjects();
  const current = projects.find((project) => project.id === projectId);
  if (!current) throw new Error("The selected project no longer exists.");
  const supabase = await supabaseContext();
  if (supabase) {
    const { error } = await supabase.client.rpc("archive_project_transaction", { target_project_id: projectId, reason_value: reason });
    if (error) throw new Error(`Could not move project to the recycle bin: ${error.message}`);
    return;
  }
  if (isSupabaseConfigured()) requireCloudContext("Archiving a project");
  const all = readJson<ProjectRecord[]>(PROJECTS_KEY, []);
  writeJson(PROJECTS_KEY, all.map((project) => project.id === projectId ? { ...project, deletedAt: now(), deletedBy: actorName(), deletionReason: reason } : project));
}

export async function restoreProject(projectId: string) {
  const supabase = await supabaseContext();
  if (supabase) {
    const { error } = await supabase.client.rpc("restore_project_transaction", { target_project_id: projectId });
    if (error) throw new Error(`Could not restore project: ${error.message}`);
    return;
  }
  if (isSupabaseConfigured()) requireCloudContext("Restoring a project");
  const all = readJson<ProjectRecord[]>(PROJECTS_KEY, []);
  writeJson(PROJECTS_KEY, all.map((project) => project.id === projectId ? { ...project, deletedAt: undefined, deletedBy: undefined, deletionReason: undefined } : project));
}

export async function purgeProject(projectId: string) {
  const supabase = await supabaseContext();
  if (supabase) {
    const { error } = await supabase.client.rpc("purge_project_transaction", { target_project_id: projectId });
    if (error) throw new Error(`Could not permanently delete project: ${error.message}`);
    return;
  }
  if (isSupabaseConfigured()) requireCloudContext("Permanently deleting a project");
  writeJson(PROJECTS_KEY, readJson<ProjectRecord[]>(PROJECTS_KEY, []).filter((project) => project.id !== projectId));
}

export async function updateProjectWorkflow(projectId: string, status: ProjectStatus, accountsStatus?: ProjectRecord["accountsStatus"], actor = "System") {
  const projects = await loadProjects();
  const current = projects.find((project) => project.id === projectId);
  if (!current) throw new Error("The selected project no longer exists.");
  const nextStatus = normaliseProjectStatus(status);
  if (!allowedStatusTransitions(current.status).includes(nextStatus)) throw new Error(`A project cannot move directly from ${normaliseProjectStatus(current.status)} to ${nextStatus}.`);
  const nextAccountsStatus = accountsStatus ?? (nextStatus === "Completed" ? "Awaiting Accounts" : current.accountsStatus);
  const updated = projects.map((project) => project.id === projectId ? { ...project, status: nextStatus, accountsStatus: nextAccountsStatus, changeLog: log(project.changeLog, actorName(actor), "Workflow changed", `${normaliseProjectStatus(project.status)} to ${nextStatus}`) } : project);
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

export async function saveActuals(projectId: string, actuals: PLActuals, actor = "System", finalise = false) {
  const projects = await loadProjects();
  const saved = { ...actuals, completedAt: finalise ? now() : actuals.completedAt };
  const updated = projects.map((project) => project.id === projectId ? { ...project, actuals: saved, accountsStatus: finalise ? "Actuals Saved" as const : project.accountsStatus, changeLog: log(project.changeLog, actorName(actor), finalise ? "P&L actuals finalised" : "P&L draft saved", `${saved.actualPrice}`) } : project);
  const target = updated.find((project) => project.id === projectId);
  const supabase = await supabaseContext();
  if (supabase && target) {
    const programme = {
        startDate: saved.startDate,
        endDate: saved.endDate,
        saturdayWorked: saved.saturdayWorked,
        sundayWorked: saved.sundayWorked,
        travelDays: saved.travelDays,
        daysTakenToComplete: saved.daysTakenToComplete
    };
    const { error: actualError } = await supabase.client.rpc("save_pl_actuals_transaction", {
      target_project_id: projectId,
      actual_price_value: saved.actualPrice,
      actuals_value: saved,
      programme_value: programme,
      change_log_value: target.changeLog ?? [],
      finalise_value: finalise
    });
    if (actualError) throw new Error(`Could not save P&L actuals: ${actualError.message}`);
    return saved;
  }
  if (isSupabaseConfigured()) requireCloudContext("Saving P&L actuals");
  writeJson(PROJECTS_KEY, updated);
  return saved;
}

export async function recordProjectHandover(projectId: string, actor = "System", issued = false) {
  const projects = await loadProjects();
  const current = projects.find((project) => project.id === projectId);
  if (!current) throw new Error("The selected project no longer exists.");
  const currentStatus = normaliseProjectStatus(current.status);
  if (issued && !["Won", "Handover Issued"].includes(currentStatus)) throw new Error("Mark the project as Won before issuing the project manager handover.");
  if (!issued && !["Costing Complete", "Won", "Handover Issued"].includes(currentStatus)) throw new Error("Complete the costing before saving a project manager handover.");
  const issuedAt = now();
  const action = issued ? "PM handover issued" : "PM handover generated";
  const nextStatus = issued ? "Handover Issued" : currentStatus;
  const changeLog = log(current.changeLog, actorName(actor), action, `${current.inputs.projectReference} revision ${current.inputs.revision || current.revisions?.length || 1}`);
  const supabase = await supabaseContext();
  if (supabase) {
    const { error } = await supabase.client.from("projects").update({ status: nextStatus, change_log: changeLog, updated_by: supabase.session.user.id, updated_at: issuedAt }).eq("id", projectId).eq("company_id", supabase.companyId);
    if (error) throw new Error(`Could not record the handover: ${error.message}`);
    return issuedAt;
  }
  if (isSupabaseConfigured()) requireCloudContext("Recording a project handover");
  writeJson(PROJECTS_KEY, projects.map((project) => project.id === projectId ? { ...project, status: nextStatus, changeLog } : project));
  return issuedAt;
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

type StoredProjectInput = Partial<ProjectInput> & {
  __costingSnapshot?: {
    rates?: AdminRates;
    repairCatalog?: RepairCatalog;
    calculationVersion?: string;
    timeEntries?: ProjectTimeEntry[];
    packageSelection?: PackageSelection;
  };
};

export function rowToProject(row: Record<string, unknown>, actuals?: PLActuals): ProjectRecord {
  const storedInputs = (row.inputs ?? {}) as StoredProjectInput;
  const { __costingSnapshot, ...inputValues } = storedInputs;
  const inputs = normaliseInput(inputValues);
  const storedCalculations = row.calculations as ProjectRecord["calculations"];
  const calculations = inputs.costingModule === "survey" ? storedCalculations : normaliseStoredCalculations(storedCalculations);
  const revisions = Array.isArray(row.revisions) ? row.revisions as QuoteRevision[] : [];
  const latestRevision = revisions[revisions.length - 1];
  const storedRateSnapshot = __costingSnapshot?.rates ?? latestRevision?.rates;
  const legacySelection = inputs.pricingMode === "selectable" && inputs.selectionConfirmed
    ? { selectedPackageIds: inputs.workPackages.filter((item) => item.selected).map((item) => item.id), confirmedAt: String(row.updated_at ?? row.created_at ?? now()), confirmedBy: "Legacy selection", reason: "Migrated from costing selection" }
    : undefined;
  return {
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : undefined,
    createdAt: String(row.created_at ?? now()),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    updatedBy: row.updated_by ? String(row.updated_by) : undefined,
    deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
    deletedBy: row.deleted_by ? String(row.deleted_by) : undefined,
    deletionReason: row.deletion_reason ? String(row.deletion_reason) : undefined,
    status: normaliseProjectStatus(row.status),
    accountsStatus: (row.accounts_status as ProjectRecord["accountsStatus"]) ?? "Not Required",
    inputs,
    calculations,
    actuals: normaliseActuals(actuals ?? row.actuals as PLActuals | undefined, calculations),
    rateSnapshot: storedRateSnapshot ? normaliseRates(storedRateSnapshot) : undefined,
    repairCatalogSnapshot: __costingSnapshot?.repairCatalog ?? latestRevision?.repairCatalog,
    calculationVersion: __costingSnapshot?.calculationVersion ?? latestRevision?.calculationVersion,
    markupApprovedBy: latestRevision?.markupApprovedBy,
    markupApprovedAt: latestRevision?.markupApprovedAt,
    revisions,
    notes: Array.isArray(row.notes) ? row.notes as ProjectNote[] : [],
    changeLog: Array.isArray(row.change_log) ? row.change_log as ChangeLogEntry[] : [],
    timeEntries: Array.isArray(__costingSnapshot?.timeEntries) ? __costingSnapshot.timeEntries : [],
    packageSelection: __costingSnapshot?.packageSelection ?? legacySelection
  };
}

export function projectToRow(project: ProjectRecord, userId: string) {
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
    inputs: {
      ...project.inputs,
      __costingSnapshot: {
        rates: project.rateSnapshot,
        repairCatalog: project.repairCatalogSnapshot,
        calculationVersion: project.calculationVersion,
        timeEntries: project.timeEntries ?? [],
        packageSelection: project.packageSelection
      }
    },
    calculations: project.calculations,
    actuals: project.actuals ?? {},
    notes: project.notes ?? [],
    revisions: project.revisions ?? [],
    change_log: project.changeLog ?? [],
    updated_at: now()
  };
}

export async function saveProjectPackageSelection(projectId: string, selectedPackageIds: string[], actor = "System", reason = "") {
  const projects = await loadProjects();
  const current = projects.find((project) => project.id === projectId);
  if (!current) throw new Error("The selected project no longer exists.");
  if (current.inputs.pricingMode !== "selectable") throw new Error("This project does not use selectable work packages.");
  const validIds = new Set(current.inputs.workPackages.map((item) => item.id));
  const selectedIds = Array.from(new Set(selectedPackageIds.filter((id) => validIds.has(id))));
  if (!selectedIds.length) throw new Error("Select at least one work package before confirming the client award.");
  if (current.packageSelection && !reason.trim()) throw new Error("Add a reason before changing a confirmed client selection.");

  const confirmedAt = now();
  const confirmedBy = actorName(actor);
  const packageSelection: PackageSelection = { selectedPackageIds: selectedIds, confirmedAt, confirmedBy, reason: reason.trim() };
  const calculationInput: ProjectInput = {
    ...current.inputs,
    selectionConfirmed: true,
    workPackages: current.inputs.workPackages.map((item) => ({ ...item, selected: selectedIds.includes(item.id) }))
  };
  const calculations = calculateProject(calculationInput, current.rateSnapshot ?? defaultRates, current.repairCatalogSnapshot ?? defaultRepairCatalog);
  const selectedLabels = current.inputs.workPackages.filter((item) => selectedIds.includes(item.id)).map((item) => `${item.code}. ${item.name}`).join(", ");
  const updated: ProjectRecord = {
    ...current,
    calculations,
    packageSelection,
    updatedBy: confirmedBy,
    changeLog: log(current.changeLog, confirmedBy, current.packageSelection ? "Client package selection changed" : "Client package selection confirmed", `${selectedLabels}${reason.trim() ? ` / ${reason.trim()}` : ""}`)
  };

  const supabase = await supabaseContext();
  if (supabase) {
    const row = projectToRow(updated, supabase.session.user.id);
    const { error } = await supabase.client.from("projects").update({
      proposal_price: row.proposal_price,
      budget_cost: row.budget_cost,
      inputs: row.inputs,
      calculations: row.calculations,
      change_log: row.change_log,
      updated_by: supabase.session.user.id,
      updated_at: confirmedAt
    }).eq("id", projectId).eq("company_id", supabase.companyId);
    if (error) throw new Error(`Could not save the client package selection: ${error.message}`);
    return updated;
  }
  if (isSupabaseConfigured()) requireCloudContext("Saving a client package selection");
  writeJson(PROJECTS_KEY, projects.map((project) => project.id === projectId ? updated : project));
  return updated;
}

export async function addProjectTimeEntry(projectId: string, entry: Omit<ProjectTimeEntry, "id" | "projectId" | "createdAt">) {
  const projects = await loadProjects();
  const current = projects.find((project) => project.id === projectId);
  if (!current) throw new Error("The selected project no longer exists.");
  const saved: ProjectTimeEntry = { ...entry, id: uid(), projectId, createdAt: now() };
  const updated: ProjectRecord = { ...current, timeEntries: [saved, ...(current.timeEntries ?? [])], changeLog: log(current.changeLog, actorName(entry.person), "Time entry added", `${entry.workType}: ${entry.hours} hours`) };
  const supabase = await supabaseContext();
  if (supabase) {
    const row = projectToRow(updated, supabase.session.user.id);
    const { error } = await supabase.client.from("projects").update({ inputs: row.inputs, change_log: updated.changeLog, updated_by: supabase.session.user.id, updated_at: now() }).eq("id", projectId).eq("company_id", supabase.companyId);
    if (error) throw new Error(`Could not save the time entry: ${error.message}`);
    return saved;
  }
  if (isSupabaseConfigured()) requireCloudContext("Saving a time entry");
  writeJson(PROJECTS_KEY, projects.map((project) => project.id === projectId ? updated : project));
  return saved;
}
