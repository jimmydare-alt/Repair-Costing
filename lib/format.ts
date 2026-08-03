export const currency = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

export function money(value: number) {
  return currency.format(Number.isFinite(value) ? value : 0);
}

export function percent(value: number) {
  return `${Number.isFinite(value) ? Math.round(value) : 0}%`;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
