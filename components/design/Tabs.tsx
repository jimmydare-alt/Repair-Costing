"use client";

export function Tabs<T extends string>({ items, value, onChange }: { items: T[]; value: T; onChange: (value: T) => void }) {
  return <div className="ds-tabs">{items.map((item) => <button key={item} className={item === value ? "active" : ""} onClick={() => onChange(item)}>{item}</button>)}</div>;
}

