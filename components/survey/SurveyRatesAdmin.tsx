"use client";

import { distanceRateUnit, type DistanceUnit } from "@/lib/company";
import type { SurveyAdminRates } from "@/lib/costing/survey/types";
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
    { label: "Equipment Rental", budget: "equipmentRentalBudgetDayRate", markup: "equipmentRentalMarkup", unit: "/ prof day" },
    { label: "Engineering Report", budget: "engineeringReportBudgetRate", markup: "engineeringReportMarkup", unit: "/ item" },
    { label: "Error Plan", budget: "errorPlanBudgetRate", markup: "errorPlanMarkup", unit: "/ item" }
  ] }
];

export function SurveyRatesAdmin({ rates, distanceUnit, onChange, onSave }: { rates: SurveyAdminRates; distanceUnit: DistanceUnit; onChange: (rates: SurveyAdminRates) => void; onSave: () => void }) {
  const patch = (key: RateKey, value: number) => onChange({ ...rates, [key]: value });
  return <div className="grid gap-5">
    <section className="app-card-strong"><div className="panel-heading flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black uppercase text-[var(--brand-primary)]">Survey Module</div><h2 className="mt-1 text-2xl font-semibold">Survey Rates</h2><p className="mt-1 text-sm text-slate-500">Budget cost and markup are editable. Proposal cost is calculated. Rates are snapshotted when a project is saved.</p></div><button className="primary-button" onClick={onSave}>Save Survey Rates</button></div></section>
    {sections.map((section) => <section className="app-card-strong" key={section.title}><div className="panel-heading"><h3 className="text-xl font-semibold">{section.title}</h3><p className="text-sm text-slate-500">{section.description}</p></div><div className="grid gap-3 p-5 xl:grid-cols-2">{section.rows.map((row, index) => {
      const budget = Number(rates[row.budget]);
      const markup = Number(rates[row.markup]);
      return <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(110px,.7fr)_minmax(100px,.55fr)_minmax(120px,.7fr)]" key={`${row.label}-${index}`}><div><div className="text-sm font-bold text-slate-950">{row.label}</div><div className="mt-1 text-xs text-slate-500">{row.label === "Distance" ? `/ ${distanceRateUnit(distanceUnit)}` : row.unit}</div></div><RateInput label="Budget Cost" value={budget} onChange={(value) => patch(row.budget, value)} /><RateInput label="Markup %" value={Math.round(markup * 10000) / 100} onChange={(value) => patch(row.markup, value / 100)} /><div><div className="text-[11px] font-black uppercase text-slate-400">Proposal Cost</div><div className="mt-2 text-base font-bold text-slate-950">{money(budget * (1 + markup))}</div></div></div>;
    })}</div></section>)}
    <section className="app-card-strong"><div className="panel-heading"><h3 className="text-xl font-semibold">Daily Output Rates</h3><p className="text-sm text-slate-500">These convert scope quantities into calculated survey site days.</p></div><div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4"><RateInput label="AutoStore Area / Day" value={rates.dailyOutputAutoStoreArea} onChange={(value) => patch("dailyOutputAutoStoreArea", value)} /><RateInput label="Fmin Runs / Day" value={rates.dailyOutputFminRuns} onChange={(value) => patch("dailyOutputFminRuns", value)} /><RateInput label="Exotec Runs / Day" value={rates.dailyOutputExotecRuns} onChange={(value) => patch("dailyOutputExotecRuns", value)} /><RateInput label="Exotec Area / Day" value={rates.dailyOutputExotecArea} onChange={(value) => patch("dailyOutputExotecArea", value)} /><RateInput label="Robotics Area / Day" value={rates.dailyOutputRoboticsArea} onChange={(value) => patch("dailyOutputRoboticsArea", value)} /><RateInput label="Level Survey Area / Day" value={rates.dailyOutputLevelSurveyArea} onChange={(value) => patch("dailyOutputLevelSurveyArea", value)} /><RateInput label="Prof Runs / Day" value={rates.dailyOutputProfRunsOnly} onChange={(value) => patch("dailyOutputProfRunsOnly", value)} /><RateInput label="Default Subcontract Markup %" value={rates.defaultSubcontractMarkup * 100} onChange={(value) => patch("defaultSubcontractMarkup", value / 100)} /></div></section>
  </div>;
}

function RateInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="grid gap-1.5 text-[11px] font-black uppercase text-slate-400"><span>{label}</span><input type="number" min="0" step="any" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
