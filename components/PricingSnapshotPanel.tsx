"use client";

import { useRef } from "react";
import { money } from "@/lib/format";
import type { ProjectCalculations } from "@/lib/types";
import { relevantPricingSignature } from "@/lib/pricingComparison";

export function PricingSnapshotPanel({ saved, current, reprice }: { saved: ProjectCalculations; current: ProjectCalculations; reprice: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const changed = relevantPricingSignature(saved) !== relevantPricingSignature(current);
  return <div className="pricing-snapshot-status">
    <span>Using this project&apos;s saved rates.</span>
    {changed && <><span className="font-semibold">New admin rates available</span><button className="secondary-button" onClick={() => dialog.current?.showModal()}>Review rate changes</button></>}
    <dialog ref={dialog} className="pricing-dialog" aria-labelledby="reprice-title"><h2 id="reprice-title" className="text-xl font-bold">Review Repricing</h2><p className="my-3 text-sm text-slate-600">Apply current admin rates to this draft only. Project quantities stay unchanged; automatic durations and material quantities may change if admin outputs or material coverage changed. Earlier saved revisions are retained.</p>
      <div className="table-shell"><table><thead><tr><th>Value</th><th>Saved Rates</th><th>Current Admin Rates</th></tr></thead><tbody><tr><th>Budget</th><td>{money(saved.budgetCost)}</td><td>{money(current.budgetCost)}</td></tr><tr><th>Sell</th><td>{money(saved.proposalTotal)}</td><td>{money(current.proposalTotal)}</td></tr><tr><th>Site days</th><td>{saved.siteDays}</td><td>{current.siteDays}</td></tr></tbody></table></div>
      <details className="my-4"><summary className="cursor-pointer text-sm font-semibold">Current admin cost breakdown</summary><div className="table-shell mt-2"><table><thead><tr><th>Item</th><th>Budget</th><th>Sell</th></tr></thead><tbody>{current.proposalLines.filter((row) => row.quantity !== 0 || row.total !== 0).map((row, index) => <tr key={index}><td>{row.item}</td><td>{money(row.cost)}</td><td>{money(row.total)}</td></tr>)}</tbody></table></div></details>
      <div className="flex flex-wrap justify-end gap-3"><button className="secondary-button" onClick={() => dialog.current?.close()}>Keep saved rates</button><button className="primary-button" onClick={() => { reprice(); dialog.current?.close(); }}>Apply current admin rates</button></div>
    </dialog>
  </div>;
}
