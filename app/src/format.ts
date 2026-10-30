import { getLang } from "./i18n";

export function fmtLap(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "–";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

export function fmtDelta(s: number): string {
  return `${s >= 0 ? "+" : "−"}${Math.abs(s).toFixed(3)}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(+d) ? iso : d.toLocaleString(getLang(), { dateStyle: "medium", timeStyle: "short" });
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
