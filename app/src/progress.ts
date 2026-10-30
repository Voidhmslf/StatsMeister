import uPlot from "uplot";
import { esc, fmtDate, fmtDay, fmtDelta, fmtLap } from "./format";
import { getLang, lapsCount, sessionsCount, t } from "./i18n";
import type { ComboProgress, SessionSummary } from "./types";

const COLOR_BEST = "#e4e4e7";
const COLOR_POTENTIAL = "#4fc27a";
const COLOR_MEDIAN = "#8a8a93";
const AXIS = "#8a8a93";
const GRID = "rgba(255,255,255,0.05)";
const FONT = '12px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

let plot: uPlot | null = null;
let observer: ResizeObserver | null = null;

/** History of one track + car; `onOpen` opens a session in the review. */
export function renderProgress(
  root: HTMLElement,
  p: ComboProgress | null,
  currentId: string | null,
  onOpen: (id: string) => void,
) {
  plot?.destroy();
  plot = null;
  observer?.disconnect();
  if (!p || !p.sessions.length) {
    root.innerHTML = `<p class="lead">${t("progress.empty")}</p>`;
    return;
  }

  const sessions = p.sessions;
  const pb = p.personal_best;
  const pbSession = pb ? sessions.find((s) => s.id === pb[0]) : undefined;
  const last = sessions[sessions.length - 1];
  const first = sessions[0];

  let lead = t("progress.lead", {
    sessions: sessionsCount(sessions.length),
    laps: lapsCount(sessions.reduce((n, s) => n + s.valid_laps, 0)),
    time: pb ? fmtLap(pb[1]) : "–",
    date: pbSession ? fmtDay(pbSession.started_at) : "",
  });
  if (sessions.length === 1) {
    lead += " " + t("progress.single");
  } else {
    if (pb && last.id === pb[0]) lead += " " + t("progress.lastPb");
    else if (pb && last.best_s != null) lead += " " + t("progress.lastSlower", { gap: (last.best_s - pb[1]).toFixed(2) });
    if (pb && first.best_s != null && first.best_s - pb[1] >= 0.01) {
      lead += " " + t("progress.improved", { gap: (first.best_s - pb[1]).toFixed(2) });
    }
  }

  const rows = [...sessions]
    .reverse()
    .map((s) => {
      const isPb = pb?.[0] === s.id;
      const d = pb && s.best_s != null && !isPb ? s.best_s - pb[1] : null;
      return `<tr data-id="${esc(s.id)}" class="${s.id === currentId ? "is-current" : ""}">
        <td>${fmtDate(s.started_at)}</td>
        <td class="num">${s.valid_laps}</td>
        <td class="num ${isPb ? "t-best" : ""}">${s.best_s != null ? fmtLap(s.best_s) : "–"}</td>
        <td class="num muted">${isPb ? t("laps.best") : d != null ? fmtDelta(d) : ""}</td>
        <td class="num">${s.median_s != null ? fmtLap(s.median_s) : "–"}</td>
        <td class="num muted">${s.stdev_s != null ? `±${s.stdev_s.toFixed(2)}` : "–"}</td>
        <td class="num">${s.potential_s != null ? fmtLap(s.potential_s) : "–"}</td>
      </tr>`;
    })
    .join("");

  root.innerHTML = `
    <p class="lead">${lead}</p>
    ${sessions.length > 1 ? `<div class="legend">
      <span style="--c:${COLOR_BEST}">${t("progress.best")}</span>
      <span style="--c:${COLOR_MEDIAN}">${t("progress.median")}</span>
      <span style="--c:${COLOR_POTENTIAL}">${t("progress.potential")}</span>
    </div>
    <div class="prog-chart"></div>` : ""}
    <section class="block">
      <table class="data sessions-table">
        <thead><tr><th>${t("progress.date")}</th><th class="num">${t("progress.laps")}</th><th class="num">${t("progress.best")}</th><th class="num">${t("progress.toPb")}</th>
          <th class="num">${t("progress.median")}</th><th class="num">${t("progress.spread")}</th><th class="num">${t("progress.potential")}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted small">${t("progress.hint")}</p>
    </section>`;

  root.querySelector(".sessions-table")!.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("tr[data-id]");
    if (row?.dataset.id) onOpen(row.dataset.id);
  });

  const chartEl = root.querySelector<HTMLElement>(".prog-chart");
  if (!chartEl) return;
  // One step per session rather than real time: practice comes in bursts
  // (several sessions a day, then a week off) and a time axis would bunch them.
  const xs = sessions.map((_, i) => i);
  const shortDate = (i: number) => {
    const d = new Date(sessions[i]?.started_at ?? "");
    return isNaN(+d) ? "" : d.toLocaleDateString(getLang(), { day: "numeric", month: "short" });
  };
  const ys = (f: (s: SessionSummary) => number | null) => sessions.map(f);
  const series = (stroke: string, width: number, dash?: number[]): uPlot.Series => ({
    stroke,
    width,
    dash,
    points: { show: true, size: 6, fill: stroke },
    spanGaps: true,
  });
  const width = () => Math.max(300, chartEl.clientWidth);
  const axis = { stroke: AXIS, font: FONT, grid: { stroke: GRID, width: 1 }, ticks: { show: false } };
  plot = new uPlot(
    {
      width: width(),
      height: 220,
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, points: { size: 8 } },
      scales: { x: { time: false, range: (_u, min, max) => [min - 0.5, max + 0.5] } },
      axes: [
        { ...axis, splits: () => xs, values: (_u, v) => v.map((i) => shortDate(i)) },
        { ...axis, size: 64, values: (_u, v) => v.map((x) => fmtLap(x)) },
      ],
      series: [{}, series(COLOR_BEST, 2), series(COLOR_MEDIAN, 1.5, [3, 4]), series(COLOR_POTENTIAL, 1.5, [6, 4])],
    },
    [xs, ys((s) => s.best_s), ys((s) => s.median_s), ys((s) => s.potential_s)] as uPlot.AlignedData,
    chartEl,
  );
  observer = new ResizeObserver(() => requestAnimationFrame(() => plot?.setSize({ width: width(), height: 220 })));
  observer.observe(chartEl);
}
