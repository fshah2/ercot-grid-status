export function fmtNumber(n: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(n);
}

export function fmtMoney(n: number, digits = 0) {
  return `$${fmtNumber(n, digits)}`;
}

export function fmtTime(tsIso: string) {
  const d = new Date(tsIso);
  return d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit"
  });
}
