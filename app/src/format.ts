import { getLang, t } from "./i18n";

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
  return isNaN(+d) ? iso : d.toLocaleString(getLang(), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** "30 Oct"; with `relative`, "Today" / "Yesterday" for recent days. */
export function fmtDay(iso: string, relative = false): string {
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  if (relative) {
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(new Date()) - day(d)) / 86_400_000);
    if (diff === 0) return t("date.today");
    if (diff === 1) return t("date.yesterday");
  }
  return d.toLocaleDateString(getLang(), { day: "numeric", month: "long" });
}

const UPPER = /^(gt\d?|gt\drs|gtr|rs\d?|amg|lmp\d|lmh|dtm|bmw|vw|f\d|tcr|gte|gtd)$/i;

/**
 * Readable name from a game folder id: "ctk_sokol big_ring" -> "Sokol Big Ring",
 * "cky_porsche992_gt3rs_2023" -> "Porsche992 GT3RS 2023". Names that already
 * look human (no underscores) are kept as they are.
 */
export function prettyName(id: string): string {
  if (!id.includes("_")) return id;
  const words = id
    .replace(/^[a-z]{2,4}_(?=[a-z])/, "")
    .split(/[_\s]+/)
    .filter(Boolean);
  return words.map((w) => (UPPER.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
