let activeCurrency = "EUR";

export function setMoneyCurrency(currency: string) {
  activeCurrency = currency || "EUR";
}

export function money(value: number, currency = activeCurrency) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
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
