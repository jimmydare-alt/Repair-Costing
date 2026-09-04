"use client";

import { money, percent } from "@/lib/format";
import type { RepairPriceBreakdown } from "@/lib/repairPricing";
import { NumericField } from "./ui/NumericField";

export function RepairPriceTable({ breakdowns, onAllocation }: { breakdowns: RepairPriceBreakdown[]; onAllocation?: (id: string, weight: number | null) => void }) {
  if (!breakdowns.some((breakdown) => breakdown.rows.length)) return null;
  return <section className="app-card-strong repair-price-breakdown">
    <div className="panel-heading"><h2 className="text-xl font-semibold">Repair Item Prices</h2><p className="text-sm text-slate-500">Materials, repair labour and on-site hotel/subsistence. Mobilisation, haulage and project management are separate.</p></div>
    {breakdowns.map((breakdown, index) => <div className="p-5" key={breakdown.packageId ?? index}>
      {breakdown.packageName && <h3 className="mb-3 font-bold">{breakdown.packageName}</h3>}
      <div className="table-shell"><table><thead><tr><th>Repair</th><th>Quantity</th><th>Unit</th><th>Budget / Unit</th><th>Sell / Unit</th><th>Budget Total</th><th>Sell Total</th></tr></thead><tbody>{breakdown.rows.map((row) => <tr key={row.id}><td className="font-semibold">{row.label}</td><td>{row.quantity}</td><td>{row.unit}</td><td>{row.quantity > 0 ? money(row.budget / row.quantity) : "Enter quantity"}</td><td>{row.quantity > 0 ? money(row.sell / row.quantity) : "Enter quantity"}</td><td>{money(row.budget)}</td><td className="font-bold">{money(row.sell)}</td></tr>)}</tbody><tfoot><tr><th colSpan={5}>Repair items total</th><th>{money(breakdown.rows.reduce((sum, row) => sum + row.budget, 0))}</th><th>{money(breakdown.rows.reduce((sum, row) => sum + row.sell, 0))}</th></tr></tfoot></table></div>
      <p className="mt-2 text-xs text-slate-500">Unit prices are rounded averages. The exact line totals include allocated whole-pack costs and any discount.</p>
      {(breakdown.separateBudget !== 0 || breakdown.separateSell !== 0) && <p className="mt-3 text-sm">Separate repair mobilisation and haulage: <b>{money(breakdown.separateBudget)} budget / {money(breakdown.separateSell)} sell</b>.</p>}
      {(breakdown.unallocatedBudget !== 0 || breakdown.unallocatedSell !== 0) && <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Not allocated: budget {money(breakdown.unallocatedBudget)}, sell {money(breakdown.unallocatedSell)}. Enter repair quantities and a positive labour allocation to complete the breakdown. Project costs are retained.</p>}
      <details className="mt-4 border-t border-slate-200 pt-3"><summary className="cursor-pointer text-sm font-semibold">Cost detail and labour allocation</summary><p className="my-3 text-xs text-slate-600">Labour shares default to calculated working time. Allocation days only distribute the existing cost; they do not change site days or add a charge. Shared material packs are allocated by consumption.</p>
        <div className="grid gap-3">{breakdown.rows.map((row) => <div className="repair-allocation-row" key={row.id}><div><b className="text-sm">{row.label}</b><div className="mt-1 text-xs text-slate-600">Materials {money(row.materialBudget)} budget / {money(row.materialSell)} sell<br />Labour and stay {money(row.labourBudget)} budget / {money(row.labourSell)} sell</div></div><div className="text-sm"><span className="block text-xs text-slate-500">Labour share</span><b>{percent(row.labourShare * 100)}</b></div>{onAllocation ? <div className={row.allocationOverridden ? "rounded-lg bg-amber-50 p-2" : ""}><NumericField label="Allocation days" value={row.allocationWeight} onChange={(value) => onAllocation(row.id, value === row.calculatedDays ? null : value)} min={0} step="any" />{row.allocationOverridden && <button className="secondary-button mt-2" onClick={() => onAllocation(row.id, null)}>Use calculated allocation</button>}</div> : <span className="text-xs text-slate-500">{row.allocationOverridden ? "Adjusted allocation" : "Calculated allocation"}</span>}</div>)}</div>
      </details>
    </div>)}
  </section>;
}
