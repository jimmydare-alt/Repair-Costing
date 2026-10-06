"use client";

import { NumericField } from "@/components/ui/NumericField";
import { money } from "@/lib/format";
import { qaRateUnit } from "@/lib/costing/qa/calculations";
import type { QaAdminRates, QaRateDefinition, QaRateKey } from "@/lib/costing/qa/types";
import type { DistanceUnit } from "@/lib/company";

const groups: Array<{ key: QaRateDefinition["group"]; title: string; description: string }> = [
  { key: "design", title: "Design Review", description: "Senior engineer design review and meeting time, charged by the hour." },
  { key: "supervision", title: "Site Supervision", description: "Supervision, non-supervision and stand-down day rates." },
  { key: "travel", title: "Travel, Stay & Equipment Transport", description: "Travel is kept separate so it can be owned by only one linked costing." }
];

export function QaRatesAdmin({ rates, distanceUnit, onChange, onSave }: { rates: QaAdminRates; distanceUnit: DistanceUnit; onChange: (rates: QaAdminRates) => void; onSave: () => void }) {
  const update = (key: QaRateKey, patch: Partial<QaRateDefinition>) => onChange({ rates: { ...rates.rates, [key]: { ...rates.rates[key], ...patch } } });
  return <div className="grid gap-5">
    <section className="app-card-strong"><div className="panel-heading flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black uppercase text-[var(--brand-primary)]">QA Module</div><h2 className="mt-1 text-2xl font-semibold">QA Rates</h2><p className="mt-1 text-sm text-slate-500">Internal cost and markup are editable; client price is calculated. Saved projects retain their original rate snapshot.</p></div><button className="primary-button" onClick={onSave}>Save QA Rates</button></div></section>
    {groups.map((group) => <section className="app-card-strong" key={group.key}><div className="panel-heading"><h3 className="text-xl font-semibold">{group.title}</h3><p className="text-sm text-slate-500">{group.description}</p></div><div className="grid gap-4 p-5 xl:grid-cols-2">
      {Object.values(rates.rates).filter((rate) => rate.group === group.key && !rate.legacy).map((rate) => <div className="rounded-xl border border-slate-200 bg-white p-4" key={rate.key}>
        <div className="mb-3 flex items-start justify-between gap-3"><div><b className="text-sm text-slate-950">{rate.label}</b><div className="mt-1 text-xs text-slate-500">{rate.delivery === "internal" ? "Internal" : "Subcontract"} / {qaRateUnit(rate, distanceUnit)}</div></div><span className={`rounded-full px-2 py-1 text-[11px] font-black uppercase ${rate.delivery === "internal" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>{rate.delivery}</span></div>
        <div className="grid gap-3 sm:grid-cols-3"><NumericField label="Internal Cost" value={rate.budgetRate} min={0} onChange={(budgetRate) => update(rate.key, { budgetRate })} /><NumericField label="Markup %" value={rate.markup * 100} min={0} onChange={(value) => update(rate.key, { markup: value / 100 })} /><div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-[11px] font-black uppercase text-slate-400">Client Price</div><div className="mt-2 font-bold text-slate-950">{money(rate.budgetRate * (1 + rate.markup))}</div></div></div>
      </div>)}
    </div></section>)}
  </div>;
}
