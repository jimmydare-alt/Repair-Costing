import { emptyInput } from "./rates";
import type { ProjectInput, ProjectServiceKey, RemedialWorkPackage, RepairSubcontractor } from "./types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function packageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `package-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function packageCode(index: number) {
  let value = Math.max(0, Math.floor(index));
  let result = "";
  do {
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return result;
}

function normaliseSubcontractor(item: RepairSubcontractor): RepairSubcontractor {
  return {
    ...item,
    standbyRate: Number(item.standbyRate ?? 0),
    standbyMargin: Number(item.standbyMargin ?? item.margin ?? 0.3)
  };
}

export function createWorkPackage(service: ProjectServiceKey, source: ProjectInput = emptyInput, index = 0): RemedialWorkPackage {
  const workPackage: RemedialWorkPackage = {
    id: packageId(),
    code: packageCode(index),
    name: service === "Repairs" ? "Repair works" : `${service} works`,
    description: "",
    service,
    pricingBasis: "fixed",
    mobilisationMode: "separate",
    selected: true,
    startDay: 0,
    expectedStandDownDays: 0,
    productiveRateOverride: null,
    standbyRateOverride: null,
    rateOverrideReason: "",
    discountPercentage: null,
    additionalItems: []
  };
  if (service === "Grinding") workPackage.grinding = { ...clone(source.grinding), enabled: true };
  if (service === "Screeding") workPackage.screeding = { ...clone(source.screeding), enabled: true };
  if (service === "Repairs") workPackage.repairs = { ...clone(source.repairs), enabled: true };
  return workPackage;
}

export function createSelectablePackages(input: ProjectInput) {
  const services: ProjectServiceKey[] = [
    ...(input.includeGrinding ? ["Grinding" as const] : []),
    ...(input.includeScreeding ? ["Screeding" as const] : []),
    ...(input.includeRepairs ? ["Repairs" as const] : [])
  ];
  return services.map((service, index) => createWorkPackage(service, input, index));
}

export function normaliseWorkPackages(items: unknown, source: ProjectInput = emptyInput): RemedialWorkPackage[] {
  if (!Array.isArray(items)) return [];
  return items.map((saved, index) => {
    const item = saved as Partial<RemedialWorkPackage>;
    const service: ProjectServiceKey = item.service === "Screeding" || item.service === "Repairs" ? item.service : "Grinding";
    const base = createWorkPackage(service, source, index);
    return {
      ...base,
      ...item,
      id: item.id || base.id,
      code: item.code || packageCode(index),
      name: item.name || base.name,
      description: item.description ?? "",
      selected: item.selected !== false,
      startDay: Math.max(0, Number(item.startDay ?? 0)),
      expectedStandDownDays: Math.max(0, Number(item.expectedStandDownDays ?? 0)),
      productiveRateOverride: item.productiveRateOverride == null ? null : Math.max(0, Number(item.productiveRateOverride)),
      standbyRateOverride: item.standbyRateOverride == null ? null : Math.max(0, Number(item.standbyRateOverride)),
      rateOverrideReason: item.rateOverrideReason ?? "",
      discountPercentage: item.discountPercentage == null ? null : Math.min(100, Math.max(0, Number(item.discountPercentage))),
      grinding: item.grinding ? {
        ...clone(source.grinding), ...item.grinding, enabled: true,
        productionSubcontractors: (item.grinding.productionSubcontractors ?? source.grinding.productionSubcontractors).map(normaliseSubcontractor),
        surveyorSubcontractors: (item.grinding.surveyorSubcontractors ?? source.grinding.surveyorSubcontractors).map(normaliseSubcontractor)
      } : undefined,
      screeding: item.screeding ? {
        ...clone(source.screeding), ...item.screeding, enabled: true,
        surveyorSubcontractors: (item.screeding.surveyorSubcontractors ?? source.screeding.surveyorSubcontractors).map(normaliseSubcontractor)
      } : undefined,
      repairs: item.repairs ? {
        ...clone(source.repairs), ...item.repairs, enabled: true,
        repairSubcontractors: (item.repairs.repairSubcontractors ?? source.repairs.repairSubcontractors).map(normaliseSubcontractor)
      } : undefined,
      additionalItems: Array.isArray(item.additionalItems) ? item.additionalItems : []
    };
  });
}

export function packageProjectInput(parent: ProjectInput, workPackage: RemedialWorkPackage): ProjectInput {
  return {
    ...parent,
    pricingMode: "combined",
    selectionConfirmed: false,
    sharedCosts: [],
    workPackages: [],
    activeWorkPackageId: "",
    includeGrinding: workPackage.service === "Grinding",
    includeScreeding: workPackage.service === "Screeding",
    includeRepairs: workPackage.service === "Repairs",
    grinding: workPackage.grinding ? clone(workPackage.grinding) : { ...clone(emptyInput.grinding), enabled: false },
    screeding: workPackage.screeding ? clone(workPackage.screeding) : { ...clone(emptyInput.screeding), enabled: false },
    repairs: workPackage.repairs ? clone(workPackage.repairs) : { ...clone(emptyInput.repairs), enabled: false },
    projectManagement: { ...clone(emptyInput.projectManagement), enabled: false },
    additionalItems: clone(workPackage.additionalItems),
    bdmBonusRequired: false,
    discountPercentage: workPackage.discountPercentage ?? parent.discountPercentage,
    uiProgress: { ...workPackage.uiProgress, builderStep: workPackage.service }
  };
}

export function updatePackageFromProjectInput(workPackage: RemedialWorkPackage, input: ProjectInput): RemedialWorkPackage {
  const updated = { ...workPackage, uiProgress: input.uiProgress, additionalItems: clone(input.additionalItems) };
  if (workPackage.service === "Grinding") return { ...updated, grinding: clone(input.grinding) };
  if (workPackage.service === "Screeding") return { ...updated, screeding: clone(input.screeding) };
  return { ...updated, repairs: clone(input.repairs) };
}
