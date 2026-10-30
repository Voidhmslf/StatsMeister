import uPlot from "uplot";
import { esc, fmtDate, fmtDelta, fmtLap } from "./format";
import { getLang, lapsCount, t } from "./i18n";
import type { ComboProgress, SessionSummary } from "./types";

const COLOR_BEST = "#c084fc";
const COLOR_POTENTIAL = "#4ade80";
const COLOR_MEDIAN = "#7d8794";
const GRID = "rgba(255,255,255,0.06)";

let plot: uPlot | null = null;
let observer: ResizeObserver | null = null;

/** History of one track + car; `onOpen` opens a session in the analysis view. */
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
    root.innerHTML = `<div class="empty">${t("progress.empty")}</div>`;
    return;
  }

  const pb = p.personal_best;
  const pbSession = pb ? p.sessions.find((s) => s.id === pb[0]) : undefined;
  const last = p.sessions[p.sessions.length - 1];
  const first = p.sessions[0];
  const lastVsPb = pb && last.best_s != null ? last.best_s - pb[1] : null;
  const sinceFirst = first.best_s != null && pb ? pb[1] - first.best_s : null;

  const rows = [...p.sessions]
    .reverse()
    .map((s) => {
      const isPb = pb?.[0] === s.id;
      const d = pb && s.best_s != null ? s.best_s - pb[1] : null;
      return `<tr data-id="${esc(s.id)}" class="${isPb ? "pb" : ""} ${s.id === currentId ? "current" : ""}">
        <td>${fmtDate(s.started_at)}</td>
        <td class="num">${s.valid_laps}</td>
        <td class="num best">${s.best_s != null ? fmtLap(s.best_s) : "–"}${isPb ? " ★" : ""}</td>
        <td class="num dim">${d != null && !isPb ? fmtDelta(d) : ""}</td>
        <td class="num pot">${s.potential_s != null ? fmtLap(s.potential_s) : "–"}</td>
        <td class="num">${s.median_s != null ? fmtLap(s.median_s) : "–"}</td>
        <td class="num dim">${s.stdev_s != null ? `±${s.stdev_s.toFixed(3)}` : "–"}</td>
      </tr>`;
    })
    .join("");

  root.innerHTML = `
    <div class="prog-head">
      <div class="prog-title"><b>${esc(p.key.track)}</b> · ${esc(p.key.car)}</div>
      <div class="prog-cards">
        <div class="prog-card"><span>${t("progress.pb")}</span><b class="best">${pb ? fmtLap(pb[1]) : "–"}</b><small>${pbSession ? fmtDate(pbSession.started_at) : ""}</small></div>
        <div class="prog-card"><span>${t("progress.lastVsPb")}</span><b class="${lastVsPb != null && lastVsPb <= 0 ? "gain" : "loss"}">${lastVsPb != null ? (lastVsPb === 0 ? t("progress.isPb") : fmtDelta(lastVsPb)) : "–"}</b><small>${fmtDate(last.started_at)}</small></div>
        <div class="prog-card"><span>${t("progress.sinceFirst")}</span><b class="${sinceFirst != null && sinceFirst < 0 ? "gain" : ""}">${sinceFirst != null ? fmtDelta(sinceFirst) : "–"}</b><small>${t("progress.sessions", { n: p.sessions.length })} · ${lapsCount(p.sessions.reduce((n, s) => n + s.valid_laps, 0))}</small></div>
      </div>
    </div>
    <div class="prog-legend">
      <span style="--c:${COLOR_BEST}">${t("progress.best")}</span>
      <span style="--c:${COLOR_POTENTIAL}">${t("progress.potential")}</span>
      <span style="--c:${COLOR_MEDIAN}">${t("progress.median")}</span>
    </div>
    <div id="prog-chart" class="prog-chart"></div>
    <div class="muted prog-hint">${t("progress.hint")}</div>
    <table class="prog-table">
      <tr><th>${t("progress.date")}</th><th class="num">${t("progress.laps")}</th><th class="num">${t("progress.best")}</th><th class="num">${t("progress.toPb")}</th>
        <th class="num">${t("progress.potential")}</th><th class="num">${t("progress.median")}</th><th class="num">${t("progress.spread")}</th></tr>
      ${rows}
    </table>`;

  root.querySelector(".prog-table")!.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("tr[data-id]");
    if (row?.dataset.id) onOpen(row.dataset.id);
  });

  const chartEl = root.querySelector<HTMLElement>("#prog-chart")!;
  // One step per session rather than real time: practice comes in bursts
  // (several sessions a day, then a week off) and a time axis would bunch them.
  const sessions = p.sessions;
  const xs = sessions.map((_, i) => i);
  const shortDate = (i: number) => {
    const d = new Date(sessions[i]?.started_at ?? "");
    return isNaN(+d) ? "" : d.toLocaleDateString(getLang(), { day: "numeric", month: "short" });
  };
  const ys = (f: (s: SessionSummary) => number | null) => sessions.map(f);
  const series = (stroke: string, dash?: number[]): uPlot.Series => ({
    stroke,
    width: 2,
    dash,
    points: { show: true, size: 7, fill: stroke },
    spanGaps: true,
  });
  const width = () => Math.max(300, chartEl.clientWidth);
  plot = new uPlot(
    {
      width: width(),
      height: 240,
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, points: { size: 8 } },
      scales: { x: { time: false, range: (_u, min, max) => [min - 0.5, max + 0.5] } },
      axes: [
        {
          stroke: "#7d8794",
          grid: { stroke: GRID },
          ticks: { stroke: GRID },
          // Integer ticks only, labelled with the session date.
          splits: () => xs,
          values: (_u, v) => v.map((i) => shortDate(i)),
        },
        {
          stroke: "#7d8794",
          grid: { stroke: GRID },
          ticks: { stroke: GRID },
          size: 70,
          values: (_u, v) => v.map((x) => fmtLap(x)),
        },
      ],
      series: [{}, series(COLOR_BEST), series(COLOR_POTENTIAL, [6, 4]), series(COLOR_MEDIAN, [2, 4])],
    },
    [xs, ys((s) => s.best_s), ys((s) => s.potential_s), ys((s) => s.median_s)] as uPlot.AlignedData,
    chartEl,
  );
  observer = new ResizeObserver(() => requestAnimationFrame(() => plot?.setSize({ width: width(), height: 240 })));
  observer.observe(chartEl);
}
