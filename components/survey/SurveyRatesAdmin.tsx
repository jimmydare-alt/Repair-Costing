"use client";

import { distanceRateUnit, type DistanceUnit } from "@/lib/company";
import { NumericField } from "@/components/ui/NumericField";
import { Plus } from "lucide-react";
import type { SurveyAdminRates, SurveyEquipmentCatalogItem, SurveyTestCatalogItem } from "@/lib/costing/survey/types";
import type { PLCategory } from "@/lib/types";
import { money } from "@/lib/format";

type RateKey = keyof SurveyAdminRates;
type RateRow = { label: string; budget: RateKey; markup: RateKey; unit: string };

const sections: Array<{ title: string; description: string; rows: RateRow[] }> = [
  { title: "Survey Labour", description: "Surveyor, labourer and Project Manager labour used by Survey costings only.", rows: [
    { label: "Surveyor Day", budget: "surveyorBudgetDayRate", markup: "surveyorMarkup", unit: "/ day" },
    { label: "Surveyor Day With Potential Remedials", budget: "surveyorBudgetDayRate", markup: "surveyorRemedialsMarkup", unit: "/ day" },
    { label: "Surveyor Travel Day", budget: "surveyorTravelBudgetDayRate", markup: "surveyorTravelMarkup", unit: "/ day" },
    { label: "Labourer Day", budget: "labourerBudgetDayRate", markup: "labourerMarkup", unit: "/ day" },
    { label: "Labourer Travel Day", budget: "labourerTravelBudgetDayRate", markup: "labourerTravelMarkup", unit: "/ day" },
    { label: "Project Manager Day", budget: "projectManagerBudgetDayRate", markup: "projectManagerMarkup", unit: "/ day" },
    { label: "Project Manager Travel Day", budget: "projectManagerTravelBudgetDayRate", markup: "projectManagerTravelMarkup", unit: "/ day" },
    { label: "Weekend Surveyor Day", budget: "weekendBudgetDayRate", markup: "weekendMarkup", unit: "/ day" }
  ] },
  { title: "Survey Stand-Down", description: "Default people and subsistence components used to calculate a survey stand-down day. Hotel and vehicle components use the shared travel rates below; equipment is excluded.", rows: [
    { label: "Stand-Down Surveyor Day", budget: "standbySurveyorBudgetDayRate", markup: "standbySurveyorMarkup", unit: "/ surveyor day" },
    { label: "Stand-Down Labourer Day", budget: "standbyLabourerBudgetDayRate", markup: "standbyLabourerMarkup", unit: "/ labourer day" },
    { label: "Stand-Down Subsistence", budget: "standbySubsistenceBudgetDayRate", markup: "standbySubsistenceMarkup", unit: "/ person day" }
  ] },
  { title: "Travel, Hotel & Subsistence", description: "The distance rate follows the active company's unit; saved projects retain the unit and rate snapshot.", rows: [
    { label: "Distance", budget: "distanceBudgetRate", markup: "distanceMarkup", unit: "/ distance unit" },
    { label: "Return Flight", budget: "returnFlightBudgetRate", markup: "returnFlightMarkup", unit: "/ flight" },
    { label: "Return Airport Transfer", budget: "airportUberBudgetRate", markup: "airportTransportMarkup", unit: "/ return" },
    { label: "Airport Parking", budget: "airportParkingBudgetDayRate", markup: "airportTransportMarkup", unit: "/ day" },
    { label: "Hotel", budget: "hotelBudgetNightRate", markup: "hotelMarkup", unit: "/ night" },
    { label: "Subsistence", budget: "subsistenceBudgetDayRate", markup: "subsistenceMarkup", unit: "/ person day" },
    { label: "Company Car", budget: "companyCarBudgetDayRate", markup: "companyCarMarkup", unit: "/ day" },
    { label: "Rental Car", budget: "carRentalBudgetDayRate", markup: "carRentalMarkup", unit: "/ day" }
  ] },
  { title: "Equipment & Deliverables", description: "Equipment, shipping and report costs for the Survey module.", rows: [
    { label: "Equipment Shipping", budget: "equipmentShippingBudgetRate", markup: "equipmentShippingMarkup", unit: "/ one way" },
    { label: "Engineering Report", budget: "engineeringReportBudgetRate", markup: "engineeringReportMarkup", unit: "/ item" },
    { label: "QA-Assisted Survey Analysis & Report", budget: "qaAssistedAnalysisReportBudgetRate", markup: "qaAssistedAnalysisReportMarkup", unit: "/ package" },
    { label: "Error Plan", budget: "errorPlanBudgetRate", markup: "errorPlanMarkup", unit: "/ item" }
  ] }
];

export function SurveyRatesAdmin({ rates, distanceUnit, onChange, onSave }: { rates: SurveyAdminRates; distanceUnit: DistanceUnit; onChange: (rates: SurveyAdminRates) => void; onSave: () => void }) {
  const patch = (key: RateKey, value: number) => onChange({ ...rates, [key]: value });
  const updateEquipment = (id: string, next: Partial<SurveyEquipmentCatalogItem>) => onChange({ ...rates, equipmentCatalog: rates.equipmentCatalog.map((item) => item.id === id ? { ...item, ...next } : item) });
  const updateRecoveryInputs = (item: SurveyEquipmentCatalogItem, next: Partial<Pick<SurveyEquipmentCatalogItem, "purchaseCost" | "recoveryUnits">>) => {
    const purchaseCost = next.purchaseCost ?? item.purchaseCost;
    const recoveryUnits = next.recoveryUnits ?? item.recoveryUnits;
    updateEquipment(item.id, { ...next, budgetRate: recoveryUnits > 0 ? Math.round(purchaseCost / recoveryUnits * 100) / 100 : 0 });
  };
  const addEquipment = () => onChange({
    ...rates,
    equipmentCatalog: [...rates.equipmentCatalog, {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `survey-equipment-${Date.now()}`,
      name: "New survey equipment",
      purchaseCost: 0,
      recoveryUnits: 0,
      budgetRate: 0,
      markup: 0.2,
      chargingBasis: "site_day",
      active: false,
      checklistNotes: ""
    }]
  });
  const updateTest = (id: string, next: Partial<SurveyTestCatalogItem>) => onChange({ ...rates, testCatalog: rates.testCatalog.map((item) => item.id === id ? { ...item, ...next } : item) });
  const addTest = () => onChange({ ...rates, testCatalog: [...rates.testCatalog, { id: crypto.randomUUID(), name: "New test", description: "", budgetRate: 0, markup: 0.2, chargingBasis: "each", delivery: "internal", plCategory: "Labour", active: false, checklistNotes: "" }] });
  return <div className="grid gap-5">
    <section className="app-card-strong"><div className="panel-heading flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black uppercase text-[var(--brand-primary)]">Survey Module</div><h2 className="mt-1 text-2xl font-semibold">Survey Rates</h2><p className="mt-1 text-sm text-slate-500">Budget cost and markup are editable. Proposal cost is calculated. Rates are snapshotted when a project is saved.</p></div><button className="primary-button" onClick={onSave}>Save Survey Rates</button></div></section>
    {sections.map((section) => <section className="app-card-strong" key={section.title}><div className="panel-heading"><h3 className="text-xl font-semibold">{section.title}</h3><p className="text-sm text-slate-500">{section.description}</p></div><div className="grid gap-3 p-5 xl:grid-cols-2">{section.rows.map((row, index) => {
      const budget = Number(rates[row.budget]);
      const markup = Number(rates[row.markup]);
      return <div className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(110px,.7fr)_minmax(100px,.55fr)_minmax(120px,.7fr)]" key={`${row.label}-${index}`}><div><div className="text-sm font-bold text-slate-950">{row.label}</div><div className="mt-1 text-xs text-slate-500">{row.label === "Distance" ? `/ ${distanceRateUnit(distanceUnit)}` : row.unit}</div></div><RateInput label="Budget Cost" value={budget} onChange={(value) => patch(row.budget, value)} /><RateInput label="Markup %" value={Math.round(markup * 10000) / 100} onChange={(value) => patch(row.markup, value / 100)} /><div><div className="text-[11px] font-black uppercase text-slate-400">Proposal Cost</div><div className="mt-2 text-base font-bold text-slate-950">{money(budget * (1 + markup))}</div></div></div>;
    })}</div></section>)}
    <section className="app-card-strong">
      <div className="panel-heading flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-semibold">CoGri Equipment Catalogue</h3><p className="text-sm text-slate-500">Calculate an amortisation cost from purchase price and expected recoverable uses, then choose whether the equipment is charged per site day or per deployment.</p></div><button className="secondary-button" onClick={addEquipment}><Plus size={16} />Add Equipment</button></div>
      <div className="grid gap-4 p-5">{rates.equipmentCatalog.map((item) => {
        const calculated = item.recoveryUnits > 0 ? item.purchaseCost / item.recoveryUnits : 0;
        return <div className="rounded-xl border border-slate-200 bg-white p-4" key={item.id}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><label className="grid min-w-[240px] flex-1 gap-1"><span>Equipment Name</span><input value={item.name} onChange={(event) => updateEquipment(item.id, { name: event.target.value })} /></label><label className="flex min-h-[44px] items-center gap-3 rounded-lg border border-slate-200 px-4 text-sm font-bold"><input className="h-5 w-5 accent-[var(--brand-primary)]" type="checkbox" checked={item.active} onChange={(event) => updateEquipment(item.id, { active: event.target.checked })} />Available for costing</label></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><RateInput label="Purchase Cost" value={item.purchaseCost} onChange={(purchaseCost) => updateRecoveryInputs(item, { purchaseCost })} /><RateInput label="Recovery Units" value={item.recoveryUnits} onChange={(recoveryUnits) => updateRecoveryInputs(item, { recoveryUnits })} /><RateInput label="Amortisation Cost" value={item.budgetRate} onChange={(budgetRate) => updateEquipment(item.id, { budgetRate })} /><RateInput label="Markup %" value={item.markup * 100} onChange={(value) => updateEquipment(item.id, { markup: value / 100 })} /><label className="grid min-w-0 gap-1"><span>Charging Basis</span><select value={item.chargingBasis} onChange={(event) => updateEquipment(item.id, { chargingBasis: event.target.value === "deployment" ? "deployment" : "site_day" })}><option value="site_day">Per site day</option><option value="deployment">Per deployment</option></select></label><div><div className="text-[11px] font-black uppercase text-slate-400">Proposal Cost</div><div className="mt-3 text-base font-bold text-slate-950">{money(item.budgetRate * (1 + item.markup))}</div><div className="mt-1 text-xs text-slate-500">per {item.chargingBasis === "site_day" ? "equipment day" : "deployment"}</div></div></div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,.55fr)]"><label className="grid gap-1"><span>PM Checklist Notes</span><input value={item.checklistNotes} placeholder="Accessories, calibration or dispatch checks" onChange={(event) => updateEquipment(item.id, { checklistNotes: event.target.value })} /></label><div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600"><b className="text-slate-900">Calculator:</b> {money(item.purchaseCost)} / {item.recoveryUnits || 0} = <b>{money(calculated)}</b>. Editing purchase cost or recovery units updates the amortisation cost; it can still be overridden.</div></div>
        </div>;
      })}{!rates.equipmentCatalog.length && <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm font-semibold text-slate-500">No survey equipment has been configured.</div>}</div>
    </section>
    <section className="app-card-strong">
      <div className="panel-heading flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-semibold">Survey & Testing Catalogue</h3><p className="text-sm text-slate-500">Shared tests are available in both standalone Survey and integrated QA costings. Each test keeps its own internal cost, markup, client price and P&amp;L category.</p></div><button className="secondary-button" onClick={addTest}><Plus size={16} />Add Test</button></div>
      <div className="grid gap-4 p-5">{rates.testCatalog.map((item) => <div className="rounded-xl border border-slate-200 bg-white p-4" key={item.id}>
        <div className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_minmax(260px,1.5fr)_auto]"><label className="grid gap-1"><span>Test Name</span><input value={item.name} onChange={(event) => updateTest(item.id, { name: event.target.value })} /></label><label className="grid gap-1"><span>Description</span><input value={item.description} onChange={(event) => updateTest(item.id, { description: event.target.value })} /></label><label className="flex min-h-[44px] items-center gap-3 rounded-lg border border-slate-200 px-4 text-sm font-bold"><input className="h-5 w-5 accent-[var(--brand-primary)]" type="checkbox" checked={item.active} onChange={(event) => updateTest(item.id, { active: event.target.checked })} />Available</label></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><RateInput label="Internal Cost" value={item.budgetRate} onChange={(budgetRate) => updateTest(item.id, { budgetRate })} /><RateInput label="Markup %" value={item.markup * 100} onChange={(value) => updateTest(item.id, { markup: value / 100 })} /><label className="grid gap-1"><span>Charging Basis</span><select value={item.chargingBasis} onChange={(event) => updateTest(item.id, { chargingBasis: event.target.value as SurveyTestCatalogItem["chargingBasis"] })}><option value="each">Each test</option><option value="hour">Per hour</option><option value="day">Per day</option><option value="m2">Per m2</option><option value="fixed">Fixed package</option></select></label><label className="grid gap-1"><span>Delivery</span><select value={item.delivery} onChange={(event) => updateTest(item.id, { delivery: event.target.value === "subcontract" ? "subcontract" : "internal", plCategory: event.target.value === "subcontract" ? "Subcontract" : item.plCategory === "Subcontract" ? "Labour" : item.plCategory })}><option value="internal">Internal</option><option value="subcontract">Subcontract</option></select></label><label className="grid gap-1"><span>P&amp;L Category</span><select value={item.plCategory} onChange={(event) => updateTest(item.id, { plCategory: event.target.value as PLCategory })}>{["Labour", "Subcontract", "Materials", "Equipment", "Travel", "Hotel/Subsistence", "Haulage"].map((value) => <option key={value}>{value}</option>)}</select></label><div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-[11px] font-black uppercase text-slate-400">Client Price</div><div className="mt-2 font-bold text-slate-950">{money(item.budgetRate * (1 + item.markup))}</div></div></div>
        <label className="mt-4 grid gap-1"><span>PM Checklist Notes</span><input value={item.checklistNotes} placeholder="Equipment, samples or site checks" onChange={(event) => updateTest(item.id, { checklistNotes: event.target.value })} /></label>
      </div>)}{!rates.testCatalog.length && <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm font-semibold text-slate-500">No tests configured.</div>}</div>
    </section>
    <section className="app-card-strong"><div className="panel-heading"><h3 className="text-xl font-semibold">Daily Output Rates</h3><p className="text-sm text-slate-500">These convert scope quantities into calculated survey site days.</p></div><div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4"><RateInput label="AutoStore Area / Day" value={rates.dailyOutputAutoStoreArea} onChange={(value) => patch("dailyOutputAutoStoreArea", value)} /><RateInput label="Fmin Runs / Day" value={rates.dailyOutputFminRuns} onChange={(value) => patch("dailyOutputFminRuns", value)} /><RateInput label="Exotec Runs / Day" value={rates.dailyOutputExotecRuns} onChange={(value) => patch("dailyOutputExotecRuns", value)} /><RateInput label="Exotec Area / Day" value={rates.dailyOutputExotecArea} onChange={(value) => patch("dailyOutputExotecArea", value)} /><RateInput label="Robotics Area / Day" value={rates.dailyOutputRoboticsArea} onChange={(value) => patch("dailyOutputRoboticsArea", value)} /><RateInput label="Level Survey Area / Day" value={rates.dailyOutputLevelSurveyArea} onChange={(value) => patch("dailyOutputLevelSurveyArea", value)} /><RateInput label="Prof Runs / Day" value={rates.dailyOutputProfRunsOnly} onChange={(value) => patch("dailyOutputProfRunsOnly", value)} /><RateInput label="Default Subcontract Markup %" value={rates.defaultSubcontractMarkup * 100} onChange={(value) => patch("defaultSubcontractMarkup", value / 100)} /></div></section>
  </div>;
}

function RateInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <NumericField label={label} value={value} onChange={onChange} min={0} />; }
