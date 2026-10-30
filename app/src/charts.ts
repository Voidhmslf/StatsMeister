import uPlot from "uplot";
import type { Comparison } from "./types";

export const COLOR_A = "#22d3ee";
export const COLOR_B = "#f472b6";
const COLOR_DELTA = "#fbbf24";
const AXIS = "#7d8794";
const GRID = "rgba(255,255,255,0.06)";

export interface ChartDef {
  key: string;
  title: string;
  unit: string;
  height: number;
  /** Multiplier applied to raw values (e.g. 0..1 -> %). */
  mul?: number;
  range?: [number, number];
  stepped?: boolean;
  digits?: number;
}

export const CHARTS: ChartDef[] = [
  { key: "delta", title: "Delta B − A", unit: "s", height: 120, digits: 3 },
  { key: "speed", title: "Speed", unit: "km/h", height: 200, digits: 1 },
  { key: "throttle", title: "Throttle", unit: "%", height: 100, mul: 100, range: [0, 100], digits: 0 },
  { key: "brake", title: "Brake", unit: "%", height: 100, mul: 100, range: [0, 100], digits: 0 },
  { key: "steer_deg", title: "Steering", unit: "°", height: 110, digits: 0 },
  { key: "steer", title: "Steering", unit: "%", height: 110, mul: 100, digits: 0 },
  { key: "gear", title: "Gear", unit: "", height: 80, stepped: true, digits: 0 },
  { key: "rpm", title: "RPM", unit: "", height: 110, digits: 0 },
  { key: "g_lat", title: "Lateral G", unit: "g", height: 110, digits: 2 },
];

export interface ChartSet {
  plots: uPlot[];
  destroy(): void;
}

/** Values of one chart's series at a grid index: [A, B] or [delta]. */
export function valuesAt(cmp: Comparison, def: ChartDef, i: number): (number | null)[] {
  if (def.key === "delta") return [cmp.delta?.[i] ?? null];
  const m = def.mul ?? 1;
  const a = cmp.reference.channels[def.key]?.[i];
  const b = cmp.compare?.channels[def.key]?.[i];
  return [a == null ? null : a * m, b == null ? null : b * m];
}

export function buildCharts(
  root: HTMLElement,
  cmp: Comparison,
  onCursor: (idx: number | null) => void,
): ChartSet {
  root.innerHTML = "";
  const plots: uPlot[] = [];
  const width = Math.max(300, root.clientWidth - 8);
  let syncing = false;

  const has = (key: string) => cmp.reference.channels[key] != null;
  const defs = CHARTS.filter((d) => {
    if (d.key === "delta") return cmp.delta != null;
    // Prefer the steering angle in degrees when the source provides it.
    if (d.key === "steer" && has("steer_deg")) return false;
    return has(d.key);
  });

  defs.forEach((def, n) => {
    const wrap = document.createElement("div");
    wrap.className = "chart";
    const head = document.createElement("div");
    head.className = "chart-head";
    head.innerHTML = `<span class="chart-title">${def.title}</span><span class="chart-unit">${def.unit}</span><span class="chart-vals" data-key="${def.key}"></span>`;
    wrap.append(head);
    root.append(wrap);

    const m = def.mul ?? 1;
    const scaled = (v: number[] | undefined) => (v ? v.map((x) => x * m) : []);
    let data: uPlot.AlignedData;
    let series: uPlot.Series[];
    if (def.key === "delta") {
      data = [cmp.x, cmp.delta!, cmp.x.map(() => 0)];
      series = [
        {},
        { stroke: COLOR_DELTA, width: 1.5 },
        { stroke: "rgba(255,255,255,0.25)", width: 1, dash: [4, 4] },
      ];
    } else {
      data = [cmp.x, scaled(cmp.reference.channels[def.key])];
      const paths = def.stepped ? uPlot.paths.stepped!({ align: 1 }) : undefined;
      series = [{}, { stroke: COLOR_A, width: 1.5, paths }];
      if (cmp.compare) {
        data.push(scaled(cmp.compare.channels[def.key]));
        series.push({ stroke: COLOR_B, width: 1.25, paths });
      }
    }

    const isLast = n === defs.length - 1;
    const opts: uPlot.Options = {
      width,
      height: def.height,
      legend: { show: false },
      cursor: {
        sync: { key: "statsmeister", setSeries: false },
        drag: { x: true, y: false },
        points: { size: 5 },
      },
      scales: {
        x: { time: false },
        y: def.range ? { range: def.range } : {},
      },
      axes: [
        {
          stroke: AXIS,
          grid: { stroke: GRID },
          ticks: { stroke: GRID },
          size: isLast ? 30 : 6,
          values: isLast ? (_u, v) => v.map((m) => `${m} m`) : () => [],
        },
        {
          stroke: AXIS,
          grid: { stroke: GRID },
          ticks: { stroke: GRID },
          size: 52,
          font: "11px system-ui",
        },
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
    plots.push(new uPlot(opts, data, wrap));
  });

  // Resizing plots can toggle the scrollbar and re-trigger the observer, so
  // defer to the next frame and skip no-op width changes.
  let lastWidth = width;
  let frame = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const w = Math.max(300, root.clientWidth - 8);
      if (w === lastWidth) return;
      lastWidth = w;
      plots.forEach((p, i) => p.setSize({ width: w, height: defs[i].height }));
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
        ? `<b style="color:${COLOR_DELTA}">${(vals[0] ?? 0) >= 0 ? "+" : ""}${fmt(vals[0])}</b>`
        : `<b style="color:${COLOR_A}">${fmt(vals[0])}</b>` +
          (vals.length > 1 && cmp.compare ? ` <b style="color:${COLOR_B}">${fmt(vals[1])}</b>` : "");
  }
}
