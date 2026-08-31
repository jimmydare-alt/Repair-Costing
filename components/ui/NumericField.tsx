"use client";

import { useEffect, useId, useRef, useState } from "react";

type NumericFieldProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number | "any";
  suffix?: string;
};

function boundedValue(value: number, min: number, max: number | undefined, step: number | "any") {
  const lowerBounded = Math.max(min, Number.isFinite(value) ? value : min);
  const bounded = max === undefined ? lowerBounded : Math.min(max, lowerBounded);
  return step === 1 ? Math.round(bounded) : bounded;
}

export function NumericField({ label, value, onChange, min = 0, max, step = "any", suffix }: NumericFieldProps) {
  const id = useId();
  const focused = useRef(false);
  const safeValue = Number.isFinite(value) ? value : min;
  const [draft, setDraft] = useState(String(safeValue));

  useEffect(() => {
    if (!focused.current) setDraft(String(Number.isFinite(value) ? value : min));
  }, [min, value]);

  const commit = (raw: string) => {
    const parsed = raw.trim() === "" ? min : Number(raw);
    const next = boundedValue(parsed, min, max, step);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  return <div className="grid min-w-0 gap-1">
    {label && <label htmlFor={id}>{label}</label>}
    <div className="relative min-w-0">
      <input
        id={id}
        aria-label={label || "Value"}
        className={suffix ? "pr-12" : ""}
        inputMode="decimal"
        value={draft}
        onFocus={(event) => {
          focused.current = true;
          event.currentTarget.select();
        }}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          if (raw.trim() === "") return;
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) onChange(boundedValue(parsed, min, max, step));
        }}
        onBlur={(event) => {
          focused.current = false;
          commit(event.currentTarget.value);
        }}
        onWheel={(event) => event.currentTarget.blur()}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400">{suffix}</span>}
    </div>
  </div>;
}
