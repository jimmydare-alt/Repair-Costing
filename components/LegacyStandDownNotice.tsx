"use client";

export function LegacyStandDownNotice({ days, onRemove }: { days: number; onRemove: () => void }) {
  if (!days) return null;
  return <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p>This older costing includes {days} forecast stand-down day{days === 1 ? "" : "s"}. Its budget and selling total are unchanged.</p><button className="secondary-button mt-2" onClick={() => { if (window.confirm("Remove the previously forecast stand-down charges from this draft? The stand-down rate remains available and saved revisions are retained.")) onRemove(); }}>Remove forecast stand-down charges</button></div>;
}
