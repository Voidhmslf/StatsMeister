import uPlot from "uplot";
import type { Comparison } from "./types";
import { t } from "./i18n";

/** Line colours: the reference (best) lap is neutral, the compared lap carries the accent. */
export const COLOR_A = "#e4e4e7";
export const COLOR_B = "#f0a43a";
const COLOR_DELTA = "#a1a1aa";
const AXIS = "#8a8a93";
const GRID = "rgba(255,255,255,0.05)";
const FONT = '12px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

export interface ChartDef {
  key: string;
  /** i18n key of the chart title. */
  title: "ch.delta" | "ch.speed" | "ch.throttle" | "ch.brake" | "ch.steer" | "ch.gear" | "ch.rpm" | "ch.g_lat";
  /** Unit label, or an i18n key for translated units. */
  unit: string;
  height: number;
  /** Multiplier applied to raw values (e.g. 0..1 -> %). */
  mul?: number;
  range?: [number, number];
  stepped?: boolean;
  digits?: number;
}

export const CHARTS: ChartDef[] = [
  { key: "delta", title: "ch.delta", unit: "unit.s", height: 110, digits: 3 },
  { key: "speed", title: "ch.speed", unit: "unit.kmh", height: 190, digits: 1 },
  { key: "throttle", title: "ch.throttle", unit: "%", height: 90, mul: 100, range: [0, 100], digits: 0 },
  { key: "brake", title: "ch.brake", unit: "%", height: 90, mul: 100, range: [0, 100], digits: 0 },
  { key: "steer_deg", title: "ch.steer", unit: "°", height: 100, digits: 0 },
  { key: "steer", title: "ch.steer", unit: "%", height: 100, mul: 100, digits: 0 },
  { key: "gear", title: "ch.gear", unit: "", height: 70, stepped: true, digits: 0 },
  { key: "rpm", title: "ch.rpm", unit: "", height: 100, digits: 0 },
  { key: "g_lat", title: "ch.g_lat", unit: "g", height: 100, digits: 2 },
];

export interface ChartSet {
  plots: uPlot[];
  destroy(): void;
}

export interface ChartOptions {
  /** Only these chart keys, in this order. Default: all available. */
  keys?: string[];
  /** Fixed x window in metres, e.g. one corner. */
  range?: [number, number];
  /** Shorter charts for inline use. */
  compact?: boolean;
  /** Cursor sync group; charts in different groups don't move together. */
  syncKey?: string;
}

/** Values of one chart's series at a grid index: [A, B] or [delta]. */
export function valuesAt(cmp: Comparison, def: ChartDef, i: number): (number | null)[] {
  if (def.key === "delta") return [cmp.delta?.[i] ?? null];
  const m = def.mul ?? 1;
  const a = cmp.reference.channels[def.key]?.[i];
  const b = cmp.compare?.channels[def.key]?.[i];
  return [a == null ? null : a * m, b == null ? null : b * m];
}

function availableDefs(cmp: Comparison, keys?: string[]): ChartDef[] {
  const has = (key: string) => cmp.reference.channels[key] != null;
  const defs = CHARTS.filter((d) => {
    if (d.key === "delta") return cmp.delta != null;
    // Prefer the steering angle in degrees when the source provides it.
    if (d.key === "steer" && has("steer_deg")) return false;
    return has(d.key);
  });
  return keys ? keys.flatMap((k) => defs.filter((d) => d.key === k)) : defs;
}

export function buildCharts(
  root: HTMLElement,
  cmp: Comparison,
  onCursor: (idx: number | null) => void,
  opts: ChartOptions = {},
): ChartSet {
  root.innerHTML = "";
  const plots: uPlot[] = [];
  const width = () => Math.max(240, root.clientWidth);
  let syncing = false;
  const defs = availableDefs(cmp, opts.keys);
  const height = (d: ChartDef) => (opts.compact ? Math.round(d.height * 0.7) : d.height);

  defs.forEach((def, n) => {
    const wrap = document.createElement("div");
    wrap.className = "chart";
    const head = document.createElement("div");
    head.className = "chart-head";
    const unit = def.unit.startsWith("unit.") ? t(def.unit as "unit.s") : def.unit;
    head.innerHTML = `<span class="chart-title">${t(def.title)}${unit ? `, ${unit}` : ""}</span><span class="chart-vals" data-key="${def.key}"></span>`;
    wrap.append(head);
    root.append(wrap);

    const m = def.mul ?? 1;
    const scaled = (v: number[] | undefined) => (v ? v.map((x) => x * m) : []);
    let data: uPlot.AlignedData;
    let series: uPlot.Series[];
    if (def.key === "delta") {
      data = [cmp.x, cmp.delta!, cmp.x.map(() => 0)];
      series = [{}, { stroke: COLOR_DELTA, width: 1.5 }, { stroke: "rgba(255,255,255,0.18)", width: 1 }];
    } else {
      data = [cmp.x, scaled(cmp.reference.channels[def.key])];
      const paths = def.stepped ? uPlot.paths.stepped!({ align: 1 }) : undefined;
      series = [{}, { stroke: COLOR_A, width: 1.5, paths }];
      if (cmp.compare) {
        data.push(scaled(cmp.compare.channels[def.key]));
        series.push({ stroke: COLOR_B, width: 1.5, paths });
      }
    }

    const isLast = n === defs.length - 1;
    const axis = { stroke: AXIS, font: FONT, grid: { stroke: GRID, width: 1 }, ticks: { show: false } };
    const plotOpts: uPlot.Options = {
      width: width(),
      height: height(def),
      legend: { show: false },
      cursor: {
        sync: { key: opts.syncKey ?? "telemetry", setSeries: false },
        drag: { x: !opts.range, y: false },
        points: { size: 5 },
      },
      scales: {
        x: opts.range ? { time: false, range: opts.range } : { time: false },
        y: def.range ? { range: def.range } : {},
      },
      axes: [
        {
          ...axis,
          size: isLast ? 28 : 4,
          values: isLast ? (_u, v) => v.map((x) => `${x} ${t("unit.m")}`) : () => [],
        },
        { ...axis, size: 48 },
      ],
      series,
      hooks: {
        setCursor: [(u) => onCursor(u.cursor.idx ?? null)],
        setScale: [
          (u, key) => {
            if (key !== "x" || syncing) return;
            syncing = true;
            const { min, max } = u.scales.x;
            for (const p of plots) {
              if (p !== u && min != null && max != null) p.setScale("x", { min, max });
            }
            syncing = false;
          },
        ],
      },
    };
    plots.push(new uPlot(plotOpts, data, wrap));
  });

  // Resizing plots can toggle the scrollbar and re-trigger the observer, so
  // defer to the next frame and skip no-op width changes.
  let lastWidth = width();
  let frame = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const w = width();
      if (w === lastWidth) return;
      lastWidth = w;
      plots.forEach((p, i) => p.setSize({ width: w, height: height(defs[i]) }));
    });
  });
  ro.observe(root);

  return {
    plots,
    destroy() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      plots.forEach((p) => p.destroy());
    },
  };
}

export function updateChartHeaders(root: HTMLElement, cmp: Comparison, idx: number | null) {
  for (const def of CHARTS) {
    const el = root.querySelector<HTMLElement>(`.chart-vals[data-key="${def.key}"]`);
    if (!el) continue;
    if (idx == null) {
      el.innerHTML = "";
      continue;
    }
    const vals = valuesAt(cmp, def, idx);
    const fmt = (v: number | null) => (v == null || Number.isNaN(v) ? "–" : v.toFixed(def.digits ?? 1));
    el.innerHTML =
      def.key === "delta"
        ? `<span>${(vals[0] ?? 0) >= 0 ? "+" : ""}${fmt(vals[0])}</span>`
        : `<span style="color:${COLOR_A}">${fmt(vals[0])}</span>` +
          (vals.length > 1 && cmp.compare ? `<span style="color:${COLOR_B}">${fmt(vals[1])}</span>` : "");
  }
}
