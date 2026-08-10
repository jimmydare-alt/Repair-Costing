import type { RepairCatalog, RepairLineItem, RepairMaterial, RepairType } from "./types";

export const repairMaterials: RepairMaterial[] = [
  { id: "rapid-mender", name: "CoGri Rapid Mender", category: "Mortar", unitType: "kg", unitSize: 16, costPerUnit: 90.25, calcMethod: "volume_lwd", measuredUnitType: "litres", coveragePerUnit: 9, wasteFactor: 1.1, sourceNote: "Standard material catalogue", active: true, notes: "16kg kit covers 9 litres of repair volume" },
  { id: "rapid-mender-xt-23", name: "CoGri Rapid Mender XT Pro 23kg", category: "Mortar", unitType: "kg", unitSize: 23, costPerUnit: 80, calcMethod: "volume_lwd", measuredUnitType: "litres", coveragePerUnit: 12, wasteFactor: 1.1, sourceNote: "Standard material catalogue", active: true, notes: "23kg kit covers 12 litres of repair volume" },
  { id: "rapid-mender-xt-46", name: "CoGri Rapid Mender XT Pro 46kg", category: "Mortar", unitType: "kg", unitSize: 46, costPerUnit: 160, calcMethod: "volume_lwd", measuredUnitType: "litres", coveragePerUnit: 24, wasteFactor: 1.1, sourceNote: "Standard material catalogue", active: true, notes: "46kg kit covers 24 litres of repair volume" },
  { id: "arris-mortar-rbp", name: "CoGri Arris Repair Mortar (RBP)", category: "Mortar", unitType: "kg", unitSize: 15, costPerUnit: 36, calcMethod: "volume_lwd", measuredUnitType: "litres", coveragePerUnit: 7, wasteFactor: 1.1, sourceNote: "Standard material catalogue", active: true, notes: "15kg unit covers 7 litres of repair volume" },
  { id: "bondcoat-rbp", name: "CoGri Bondcoat (RBP)", category: "Primer", unitType: "kg", unitSize: 2, costPerUnit: 27, calcMethod: "area_thickness", measuredUnitType: "m2", coveragePerUnit: 5, wasteFactor: 1.1, sourceNote: "Standard material catalogue", active: true, notes: "Coverage based on length x width/depth as an area allowance" },
  { id: "rapid-seal-600", name: "CoGri Rapid Seal 60/75 (600ml)", category: "Sealant", unitType: "litres", unitSize: 0.6, costPerUnit: 18, calcMethod: "volume_lwd", measuredUnitType: "litres", coveragePerUnit: 0.6, wasteFactor: 1.2, sourceNote: "Standard material catalogue", active: true, notes: "600ml cartridge" },
  { id: "rapid-seal-37", name: "CoGri Rapid Seal 60/75 (37.8ltr)", category: "Sealant", unitType: "litres", unitSize: 37.8, costPerUnit: 640, calcMethod: "volume_lwd", measuredUnitType: "litres", coveragePerUnit: 37.8, wasteFactor: 1.2, sourceNote: "Standard material catalogue", active: true, notes: "Bulk joint sealant" },
  { id: "lv-rapid-600", name: "CoGri LV Rapid (600ml)", category: "Resin", unitType: "litres", unitSize: 0.6, costPerUnit: 21, calcMethod: "volume_lwd", measuredUnitType: "litres", coveragePerUnit: 0.6, wasteFactor: 1.1, sourceNote: "Standard material catalogue", active: true, notes: "600ml crack resin cartridge" },
  { id: "arbo-mp20", name: "Arbo MP20 (380ml)", category: "Sealant", unitType: "litres", unitSize: 0.38, costPerUnit: 5.5, calcMethod: "volume_lwd", measuredUnitType: "litres", coveragePerUnit: 0.38, wasteFactor: 1.1, sourceNote: "Standard material catalogue", active: true, notes: "380ml flexible sealant cartridge" },
  { id: "backing-cord", name: "Backing Cord", category: "Backing", unitType: "m", unitSize: 1, costPerUnit: 0.15, calcMethod: "linear", measuredUnitType: "m", coveragePerUnit: 1, wasteFactor: 1.05, sourceNote: "Standard material catalogue", active: true, notes: "Linear joint backing cord allowance" },
  { id: "fastprime-5", name: "CoGri FastPrime (5ltr)", category: "Primer", unitType: "litres", unitSize: 5, costPerUnit: 55, calcMethod: "area_thickness", measuredUnitType: "litres", coveragePerUnit: 5, wasteFactor: 1.155, sourceNote: "Standard material catalogue", active: true, notes: "Primer litres = ((0.14 x area) / 2) x waste" },
  { id: "ffit-topping", name: "CoGri FfIT Topping", category: "Screed", unitType: "kg", unitSize: 25, costPerUnit: 18, calcMethod: "area_thickness", measuredUnitType: "kg", coveragePerUnit: 25, wasteFactor: 1.155, densityKgPerL: 1.74, sourceNote: "Standard material catalogue", active: true, notes: "25kg bag, density 1.74" },
  { id: "ffit-base", name: "CoGri FfIT Base", category: "Screed", unitType: "kg", unitSize: 25, costPerUnit: 18, calcMethod: "area_thickness", measuredUnitType: "kg", coveragePerUnit: 25, wasteFactor: 1.155, densityKgPerL: 1.814, sourceNote: "Standard material catalogue", active: true, notes: "25kg bag, density 1.814" },
  { id: "joint-stabiliser", name: "Joint stabiliser", category: "Tooling", unitType: "each", unitSize: 1, costPerUnit: 0, calcMethod: "each", measuredUnitType: "each", coveragePerUnit: 1, wasteFactor: 1, sourceNote: "Admin placeholder", active: false, notes: "Fill out in full before activating" },
  { id: "concrete-mix", name: "Suitable concrete mix", category: "Concrete", unitType: "m3", unitSize: 1, costPerUnit: 0, calcMethod: "area_thickness", measuredUnitType: "m3", coveragePerUnit: 1, wasteFactor: 1, sourceNote: "Admin placeholder", active: false, notes: "Fill out cost before activating. Area x thickness is converted to cubic metres." },
  { id: "densifier", name: "CoGri Densifier / CoGri Denpro", category: "Other", unitType: "litres", unitSize: 1, costPerUnit: 0, calcMethod: "manual", measuredUnitType: "litres", coveragePerUnit: 1, wasteFactor: 1.1, sourceNote: "Admin setup required", active: false, notes: "Fill out in full before activating" }
];

const rule = (materialId: string, role: "required" | "optional", defaultSelected = role === "required", dimensions?: { widthMm: number; depthMm: number }) => ({
  materialId,
  role,
  defaultSelected,
  usesOwnDimensions: Boolean(dimensions),
  defaultWidthMm: dimensions?.widthMm,
  defaultDepthMm: dimensions?.depthMm
});

const type3Sealant = (materialId: string, role: "required" | "optional") => rule(materialId, role, role === "required", { widthMm: 3, depthMm: 30 });

export const repairTypes: RepairType[] = [
  { code: "Type 1", name: "Crack Repair", measurementBasis: "linear", defaultWidthMm: 8, defaultDepthMm: 30, defaultThicknessMm: 0, defaultOutputPerDay: 60, description: "Saw cut crack repair filled with LV Rapid resin.", materialRules: [rule("lv-rapid-600", "required"), rule("rapid-seal-600", "optional")], active: true },
  { code: "Type 2", name: "Joint Reseal", measurementBasis: "linear", defaultWidthMm: 8, defaultDepthMm: 30, defaultThicknessMm: 0, defaultOutputPerDay: 120, description: "3-10mm joint reseal.", materialRules: [rule("rapid-seal-600", "required"), rule("rapid-seal-37", "optional"), rule("arbo-mp20", "optional"), rule("backing-cord", "optional")], active: true },
  { code: "Type 2a", name: "Wide Joint Reseal", measurementBasis: "linear", defaultWidthMm: 15, defaultDepthMm: 30, defaultThicknessMm: 0, defaultOutputPerDay: 90, description: "10-20mm wider joint reseal.", materialRules: [rule("rapid-seal-37", "required"), rule("rapid-seal-600", "optional"), rule("arbo-mp20", "optional"), rule("backing-cord", "optional")], active: true },
  { code: "Type 2b", name: "Armour Joint Reseal", measurementBasis: "linear", defaultWidthMm: 15, defaultDepthMm: 30, defaultThicknessMm: 0, defaultOutputPerDay: 75, description: "Armoured joint reseal between steel arris plates.", materialRules: [rule("arbo-mp20", "required"), rule("rapid-seal-600", "optional"), rule("backing-cord", "optional")], active: true },
  { code: "Type 3", name: "Joint Arris Repair", measurementBasis: "linear", defaultWidthMm: 50, defaultDepthMm: 50, defaultThicknessMm: 0, defaultOutputPerDay: 25, description: "Joint arris breakout and Rapid Mender repair with reseal.", materialRules: [rule("rapid-mender", "required"), type3Sealant("rapid-seal-600", "required"), rule("bondcoat-rbp", "optional"), rule("backing-cord", "optional")], active: true },
  { code: "Type 3 Special", name: "Armoured Joint Arris Repair", measurementBasis: "linear", defaultWidthMm: 50, defaultDepthMm: 50, defaultThicknessMm: 0, defaultOutputPerDay: 18, description: "Armoured joint arris repair.", materialRules: [rule("rapid-mender", "required"), type3Sealant("rapid-seal-600", "required"), rule("bondcoat-rbp", "optional"), rule("backing-cord", "optional")], active: true },
  { code: "Type 3n", name: "Joint Spall Nosing Repair", measurementBasis: "linear", defaultWidthMm: 50, defaultDepthMm: 50, defaultThicknessMm: 0, defaultOutputPerDay: 22, description: "Joint spall/nosing repair.", materialRules: [rule("rapid-mender", "required"), type3Sealant("rapid-seal-600", "required"), rule("backing-cord", "optional")], active: true },
  { code: "Type 3PT", name: "PT Joint Repair", measurementBasis: "linear", defaultWidthMm: 100, defaultDepthMm: 50, defaultThicknessMm: 0, defaultOutputPerDay: 14, description: "Post-tensioned joint repair with steel joint removed locally.", materialRules: [rule("rapid-mender", "required"), type3Sealant("rapid-seal-600", "required"), rule("concrete-mix", "optional")], active: true },
  { code: "Type 4a", name: "Surface Repair", measurementBasis: "area", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 15, defaultOutputPerDay: 25, description: "Surface repair patch.", materialRules: [rule("arris-mortar-rbp", "required"), rule("bondcoat-rbp", "optional"), rule("rapid-mender", "optional")], active: true },
  { code: "Type 4b", name: "Surface Repair", measurementBasis: "area", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 25, defaultOutputPerDay: 18, description: "Deeper surface repair / repair mortar patch.", materialRules: [rule("rapid-mender", "required"), rule("arris-mortar-rbp", "optional"), rule("bondcoat-rbp", "optional")], active: true },
  { code: "Type 5a", name: "Floor Bolt Cut and Fill", measurementBasis: "each", defaultWidthMm: 30, defaultDepthMm: 30, defaultThicknessMm: 0, defaultOutputPerDay: 60, description: "Floor bolt cut and resin fill.", materialRules: [rule("lv-rapid-600", "required"), rule("rapid-mender", "optional")], active: true },
  { code: "Type 5b", name: "Floor Bolt Core and Fill", measurementBasis: "each", defaultWidthMm: 50, defaultDepthMm: 50, defaultThicknessMm: 0, defaultOutputPerDay: 35, description: "Floor bolt core and fill.", materialRules: [rule("ffit-topping", "required"), rule("ffit-base", "optional"), rule("fastprime-5", "optional")], active: true },
  { code: "Type 6a", name: "Corner Slab Repair", measurementBasis: "area", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 150, defaultOutputPerDay: 8, description: "Corner slab breakout and replacement.", materialRules: [rule("concrete-mix", "required"), rule("rapid-seal-600", "required")], active: false },
  { code: "Type 6b", name: "Typical Dowelled Slab Repair", measurementBasis: "area", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 150, defaultOutputPerDay: 6, description: "Dowelled slab repair.", materialRules: [rule("concrete-mix", "required"), rule("rapid-seal-600", "required")], active: false },
  { code: "Type 6c", name: "Typical Dowelled Slab Repair", measurementBasis: "area", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 150, defaultOutputPerDay: 6, description: "Dowelled slab repair variation.", materialRules: [rule("concrete-mix", "required"), rule("rapid-seal-600", "required")], active: false },
  { code: "Type 7a", name: "Joint Stabiliser", measurementBasis: "each", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 0, defaultOutputPerDay: 25, description: "Mechanical joint stabilisers.", materialRules: [rule("joint-stabiliser", "required")], active: false },
  { code: "Type 7b", name: "Resin Injection - Joint", measurementBasis: "linear", defaultWidthMm: 10, defaultDepthMm: 30, defaultThicknessMm: 0, defaultOutputPerDay: 40, description: "Joint lifting/stabilisation by resin injection.", materialRules: [rule("rapid-seal-600", "required"), rule("rapid-mender", "optional")], active: true },
  { code: "Type 8", name: "Slab Replacement", measurementBasis: "area", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 150, defaultOutputPerDay: 5, description: "Full slab replacement.", materialRules: [rule("concrete-mix", "required"), rule("rapid-seal-600", "required")], active: false },
  { code: "Type 9", name: "Guide Wire Installation", measurementBasis: "linear", defaultWidthMm: 10, defaultDepthMm: 30, defaultThicknessMm: 0, defaultOutputPerDay: 60, description: "Guide wire installation / rigid epoxy fill.", materialRules: [rule("rapid-mender", "required"), rule("rapid-seal-600", "optional")], active: true },
  { code: "Lip Grind", name: "Lip Grind", measurementBasis: "linear", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 0, defaultOutputPerDay: 150, description: "Joint lip grinding and reseal.", materialRules: [rule("rapid-seal-600", "required"), rule("densifier", "optional")], active: true },
  { code: "Pump Screed", name: "Pump Screed Requirements", measurementBasis: "area", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 10, defaultOutputPerDay: 100, description: "Pump screed repair preparation and material requirements.", materialRules: [rule("fastprime-5", "required"), rule("ffit-base", "required"), rule("ffit-topping", "required"), rule("rapid-seal-600", "optional")], active: true },
  { code: "Floor Marking Removal", name: "Floor Marking Removal", measurementBasis: "area", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 0, defaultOutputPerDay: 200, description: "Floor marking removal and groove fill if required.", materialRules: [rule("rapid-mender", "optional"), rule("densifier", "optional")], active: true },
  { code: "Glue/Paint/Tyre Mark Removal", name: "Glue, Paint & Tyre Mark Removal", measurementBasis: "area", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 0, defaultOutputPerDay: 200, description: "Glue, paint and tyre mark removal with densifier option.", materialRules: [rule("densifier", "optional")], active: false }
];

export const defaultRepairCatalog: RepairCatalog = {
  materials: repairMaterials,
  types: repairTypes
};

export function repairTypeByCode(code: string, catalog: RepairCatalog = defaultRepairCatalog) {
  return catalog.types.find((type) => type.code === code) ?? {
    code: code || "Missing repair type",
    name: "Missing repair type",
    measurementBasis: "manual" as const,
    defaultWidthMm: 0,
    defaultDepthMm: 0,
    defaultThicknessMm: 0,
    defaultOutputPerDay: 0,
    description: "This repair type no longer exists in the active catalogue.",
    materialRules: [],
    active: false
  };
}

export function materialById(id: string, catalog: RepairCatalog = defaultRepairCatalog) {
  return catalog.materials.find((material) => material.id === id);
}

export function materialByName(name: string, catalog: RepairCatalog = defaultRepairCatalog) {
  return catalog.materials.find((material) => material.name === name);
}

export function createRepairLine(repairTypeCode = "", catalog: RepairCatalog = defaultRepairCatalog): RepairLineItem {
  const selectedCode = repairTypeCode || catalog.types.find((type) => type.active)?.code || "Missing repair type";
  const type = repairTypeByCode(selectedCode, catalog);
  return {
    id: `${type.code}-${Math.random().toString(36).slice(2, 9)}`,
    repairTypeCode: type.code,
    description: type.name,
    lengthM: 0,
    widthMm: type.defaultWidthMm,
    depthMm: type.defaultDepthMm,
    areaM2: 0,
    thicknessMm: type.defaultThicknessMm,
    eachQty: 0,
    holeDiameterMm: type.measurementBasis === "each" ? type.defaultWidthMm : 0,
    holeDepthMm: type.measurementBasis === "each" ? type.defaultDepthMm : 0,
    manualMaterialQty: 0,
    outputPerDay: type.defaultOutputPerDay,
    materialSelections: type.materialRules.map((rule) => ({
      materialId: rule.materialId,
      selected: rule.defaultSelected,
      widthMm: rule.usesOwnDimensions ? rule.defaultWidthMm : undefined,
      depthMm: rule.usesOwnDimensions ? rule.defaultDepthMm : undefined
    }))
  };
}
