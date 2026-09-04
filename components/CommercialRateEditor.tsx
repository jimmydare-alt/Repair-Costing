"use client";

import type { CommercialRateSchedule, RemedialWorkPackage } from "@/lib/types";
import { money } from "@/lib/format";
import { NumericField } from "./ui/NumericField";
import { LegacyStandDownNotice } from "./LegacyStandDownNotice";

type Values = Pick<RemedialWorkPackage, "productiveRateOverride" | "standbyRateOverride" | "rateOverrideReason" | "expectedStandDownDays">;
export function CommercialRateEditor({ schedule, values, onChange }: { schedule?: CommercialRateSchedule; values: Values; onChange: (next: Partial<Values>) => void }) {
  return <section className="app-card-strong"><div className="panel-heading"><h3 className="text-xl font-semibold">Commercial Rate Schedule</h3><p className="text-sm text-slate-500">Stand-down is an available daily charge, not assumed downtime in the project total.</p></div><div className="p-5">
    <div className="grid gap-3 sm:grid-cols-3">{[["Productive / day", schedule?.productiveProposalRate], ["Mobilisation", schedule?.mobilisationProposal], ["Stand-down / day", schedule?.standbyProposalRate]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">{label}</div><b className="block mt-1">{money(Number(value) || 0)}</b></div>)}</div>
    <details className="my-4"><summary className="cursor-pointer text-sm font-semibold">Adjust selling rates{values.productiveRateOverride !== null || values.standbyRateOverride !== null ? " (adjusted)" : ""}</summary><div className="mt-3 grid gap-4 sm:grid-cols-2"><NumericField label="Productive selling rate / day" value={values.productiveRateOverride ?? schedule?.productiveProposalRate ?? 0} min={0} onChange={(value) => onChange({ productiveRateOverride: value })} /><NumericField label="Stand-down selling rate / day" value={values.standbyRateOverride ?? schedule?.standbyProposalRate ?? 0} min={0} onChange={(value) => onChange({ standbyRateOverride: value })} /><label className="grid gap-2 text-xs font-semibold sm:col-span-2">Reason for adjustment<input value={values.rateOverrideReason} onChange={(event) => onChange({ rateOverrideReason: event.target.value })} /></label><button className="secondary-button justify-self-start" onClick={() => onChange({ productiveRateOverride: null, standbyRateOverride: null, rateOverrideReason: "" })}>Use calculated rates</button></div></details>
    <LegacyStandDownNotice days={values.expectedStandDownDays} onRemove={() => onChange({ expectedStandDownDays: 0 })} />
  </div></section>;
}
