import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import "uplot/dist/uPlot.min.css";
import "./style.css";
import { buildCharts, updateChartHeaders, COLOR_A, COLOR_B, type ChartSet } from "./charts";
import { esc, fmtDate, fmtDay, fmtDelta, fmtLap, prettyName } from "./format";
import { applyStatic, getLang, isKey, lapsCount, setLang, t, type Lang } from "./i18n";
import { renderProgress } from "./progress";
import { TrackMap } from "./trackmap";
import {
  isValidLap,
  type ComboProgress,
  type Comparison,
  type Hint,
  type Lap,
  type LapRef,
  type LapStats,
  type Potential,
  type RecorderEvent,
  type Session,
} from "./types";

type View = "review" | "telemetry" | "progress";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  sessions: [] as Session[],
  current: null as Session | null,
  /** Reference lap (the faster one) and the lap compared against it. */
  a: null as LapRef | null,
  b: null as LapRef | null,
  cmp: null as Comparison | null,
  stats: new Map<string, LapStats[]>(),
  potential: new Map<string, Potential | null>(),
  progress: null as ComboProgress | null,
  view: "review" as View,
  openCorner: null as number | null,
  charts: null as ChartSet | null,
  mini: null as ChartSet | null,
  recording: false,
  /** Re-evaluated on language change so the status line follows it. */
  status: () => "",
};

const reviewMap = new TrackMap($<HTMLCanvasElement>("review-map"));
const teleMap = new TrackMap($<HTMLCanvasElement>("tele-map"));

// ---------- helpers ----------

let toastTimer = 0;
function toast(msg: string, kind: "info" | "error" = "info") {
  const el = $("toast");
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.className = "toast"), kind === "error" ? 6000 : 3500);
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    toast(String(e), "error");
    throw e;
  }
}

const sameRef = (x: LapRef | null, y: LapRef | null) =>
  !!x && !!y && x.session === y.session && x.lap === y.lap;

const sessionById = (id: string) => state.sessions.find((s) => s.id === id);

function lapOf(r: LapRef | null): Lap | undefined {
  return r ? sessionById(r.session)?.laps.find((l) => l.number === r.lap) : undefined;
}

function bestLap(s: Session): Lap | undefined {
  return s.laps.filter(isValidLap).reduce<Lap | undefined>((m, l) => (!m || l.time_s < m.time_s ? l : m), undefined);
}

/** "Lap 5", or "personal best, 12 Oct" for a lap from another session. */
function lapName(r: LapRef): string {
  if (state.current && r.session !== state.current.id) {
    const s = sessionById(r.session);
    return t("lap.pbFrom", { date: s ? fmtDay(s.started_at) : "" });
  }
  const best = state.current && bestLap(state.current);
  return best && r.lap === best.number ? t("lap.best", { n: r.lap }) : t("lap.n", { n: r.lap });
}

function setStatus(fn: () => string) {
  state.status = fn;
  $("rec-status").textContent = fn();
  $("rec-status").hidden = !fn();
}

// ---------- sessions sidebar ----------

async function loadSessions() {
  state.sessions = await call<Session[]>("list_sessions");
  renderSidebar();
  const keep = state.current && sessionById(state.current.id);
  if (keep) {
    state.current = keep;
    renderSession();
  } else {
    const first = state.sessions.find((s) => s.finished) ?? state.sessions[0];
    if (first) await selectSession(first.id);
    else showWelcome();
  }
}

function renderSidebar() {
  const nav = $("sessions");
  if (!state.sessions.length) {
    nav.innerHTML = `<p class="side-empty">${t("sessions.empty")}</p>`;
    return;
  }
  let lastDay = "";
  nav.innerHTML = state.sessions
    .map((s) => {
      const day = fmtDay(s.started_at, true);
      const header = day !== lastDay ? `<div class="day">${esc(day)}</div>` : "";
      lastDay = day;
      const best = bestLap(s);
      return `${header}<button class="session ${state.current?.id === s.id ? "on" : ""}" data-id="${esc(s.id)}">
        <span class="s-track">${esc(prettyName(s.track) || t("sessions.unknownTrack"))}</span>
        <span class="s-time">${s.finished ? (best ? fmtLap(best.time_s) : "–") : t("sessions.live")}</span>
        <span class="s-car">${esc(prettyName(s.car) || t("sessions.unknownCar"))}</span>
      </button>`;
    })
    .join("");
}

$("sessions").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".session");
  if (b?.dataset.id) selectSession(b.dataset.id);
});

function showWelcome() {
  state.current = null;
  $("welcome").hidden = false;
  $("session").hidden = true;
}

async function selectSession(id: string) {
  const s = sessionById(id);
  if (!s) return;
  state.current = s;
  state.openCorner = null;
  $("welcome").hidden = true;
  $("session").hidden = false;
  renderSidebar();
  state.cmp = null;
  state.progress = null;
  const best = bestLap(s);
  if (s.finished && best) {
    state.a = { session: id, lap: best.number };
    state.b = defaultCompare(s, best);
    const [stats, potential, progress] = await Promise.all([
      state.stats.get(id) ?? call<LapStats[]>("lap_stats", { session: id }),
      state.potential.has(id) ? state.potential.get(id)! : call<Potential | null>("session_potential", { session: id }),
      call<ComboProgress>("combo_progress", { session: id }),
    ]);
    if (state.current?.id !== id) return; // another session was picked meanwhile
    state.stats.set(id, stats);
    state.potential.set(id, potential);
    state.progress = progress;
    await updateComparison();
  } else {
    state.a = null;
    state.b = null;
    renderSession();
  }
}

/**
 * The lap to compare with the best one: the latest lap within 3 % of it
 * (a representative recent lap), else the second best. Slower laps are
 * usually mistakes and would hide the real, repeatable losses.
 */
function defaultCompare(s: Session, best: Lap): LapRef | null {
  const others = s.laps.filter((l) => isValidLap(l) && l !== best);
  const close = others.filter((l) => l.time_s <= best.time_s * 1.03);
  const pick = close.length ? close[close.length - 1] : [...others].sort((x, y) => x.time_s - y.time_s)[0];
  return pick ? { session: s.id, lap: pick.number } : null;
}

async function updateComparison() {
  if (!state.a) return;
  const cmp = await call<Comparison>("compare_laps", { reference: state.a, compare: state.b });
  for (const r of [state.a, state.b]) {
    if (r && !state.stats.has(r.session)) {
      state.stats.set(r.session, await call<LapStats[]>("lap_stats", { session: r.session }));
    }
  }
  state.cmp = cmp;
  renderSession();
}

// ---------- session view ----------

function renderSession() {
  const s = state.current;
  if (!s) return;
  const best = bestLap(s);
  $("s-title").textContent = prettyName(s.track) || t("sessions.unknownTrack");
  $("s-meta").textContent = [prettyName(s.car), fmtDate(s.started_at), lapsCount(s.laps.filter(isValidLap).length)]
    .filter(Boolean)
    .join(" · ");
  $("s-best").innerHTML = best ? `<span>${t("session.best")}</span><b class="t-best">${fmtLap(best.time_s)}</b>` : "";
  $<HTMLButtonElement>("tab-telemetry").disabled = !state.cmp;
  $<HTMLButtonElement>("tab-progress").disabled = !s.finished;
  if (!state.cmp && state.view !== "review") state.view = "review";
  document.querySelectorAll<HTMLElement>(".tab").forEach((b) => {
    const on = b.dataset.view === state.view;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  });
  for (const v of ["review", "telemetry", "progress"] as View[]) $(`view-${v}`).hidden = state.view !== v;
  if (state.view === "review") renderReview();
  if (state.view === "telemetry") renderTelemetry();
  if (state.view === "progress") renderProgressView();
}

document.querySelectorAll<HTMLElement>(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    state.view = b.dataset.view as View;
    renderSession();
  }),
);

// ---------- review ----------

function renderReview() {
  const s = state.current!;
  const root = $("review-body");
  state.mini?.destroy();
  state.mini = null;
  const best = bestLap(s);

  if (!s.finished) {
    root.innerHTML = `<p class="lead">${t("review.recording")}</p>`;
    reviewMap.render(null, null);
    return;
  }
  if (!best || !state.cmp) {
    root.innerHTML = `<p class="lead">${t("review.noValid")}</p>${lapsTable(s)}`;
    reviewMap.render(null, null);
    return;
  }

  const p = state.potential.get(s.id);
  let lead = t("review.lead", { time: fmtLap(best.time_s), n: best.number });
  if (p && p.reference_time_s - p.theoretical_best_s >= 0.05) {
    lead += " " + t("review.potential", {
      time: fmtLap(p.theoretical_best_s),
      gain: (p.reference_time_s - p.theoretical_best_s).toFixed(2),
    });
  }
  const pb = state.progress?.personal_best;
  if (pb && pb[0] !== s.id && pb[1] < best.time_s) {
    const pbSession = sessionById(pb[0]);
    lead += " " + t("review.pb", { time: fmtLap(pb[1]), gap: (best.time_s - pb[1]).toFixed(2), date: pbSession ? fmtDay(pbSession.started_at) : "" });
  } else if (pb && pb[0] === s.id && (state.progress?.sessions.length ?? 0) > 1) {
    lead += " " + t("review.newPb");
  }

  root.innerHTML = `
    <p class="lead">${lead}</p>
    <section class="block">
      <div class="block-head">
        <h2>${t("review.lossTitle")}</h2>
        ${compareSelect("review-compare")}
      </div>
      ${lossList()}
    </section>
    <section class="block">
      <h2>${t("review.lapsTitle")}</h2>
      ${lapsTable(s)}
    </section>`;

  const focus = topLosses().map(([c]) => c);
  reviewMap.render(state.cmp, null, { mode: "focus", focus, active: state.openCorner });
  if (state.openCorner != null) openCornerDetail(state.openCorner);
}

/** Corners where the compared lap loses most, with their hints (max 4). */
function topLosses(): [number, Hint[]][] {
  const byCorner = new Map<number, Hint[]>();
  for (const h of state.cmp?.hints ?? []) byCorner.set(h.corner, [...(byCorner.get(h.corner) ?? []), h]);
  return [...byCorner.entries()].slice(0, 4);
}

function hintText(h: Hint): string {
  const key = `hint.${h.kind}`;
  if (!isKey(key)) return h.kind;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (typeof v === "number" && k !== "corner" && k !== "loss_s") {
      params[k] = k.endsWith("_m") ? String(Math.round(v)) : v.toFixed(1);
    }
  }
  return t(key, params);
}

function lossList(): string {
  if (!state.b) return `<p class="muted">${t("review.single")}</p>`;
  const losses = topLosses();
  if (!losses.length) return `<p class="muted">${t("review.lossNone", { lap: lapName(state.b) })}</p>`;
  const rest = (state.cmp?.corners ?? []).filter(
    (c) => (c.delta_s ?? 0) >= 0.05 && !losses.some(([n]) => n === c.number),
  ).length;
  return `<ol class="losses">${losses
    .map(
      ([corner, hints]) => `<li class="${state.openCorner === corner ? "open" : ""}" data-corner="${corner}">
        <button class="loss-head" aria-expanded="${state.openCorner === corner}">
          <span class="loss-corner">${t("review.corner", { n: corner })}</span>
          <span class="loss-time">${t("review.lost", { s: hints[0].loss_s.toFixed(2) })}</span>
          <span class="loss-toggle">${state.openCorner === corner ? t("review.hide") : t("review.show")}</span>
        </button>
        ${hints.map((h) => `<p>${hintText(h)}</p>`).join("")}
        <div class="loss-detail"></div>
      </li>`,
    )
    .join("")}</ol>${rest ? `<p class="muted small">${t("review.more", { n: rest })}</p>` : ""}`;
}

function openCornerDetail(corner: number) {
  const cmp = state.cmp;
  const li = $("review-body").querySelector<HTMLElement>(`li[data-corner="${corner}"]`);
  const c = cmp?.corners.find((c) => c.number === corner);
  const el = li?.querySelector<HTMLElement>(".loss-detail");
  if (!cmp || !c || !el) return;
  state.mini?.destroy();
  el.innerHTML = `<div class="legend">${legend()}</div><div class="mini"></div>`;
  // Braking zone, apex and exit; the rest of the following straight only squeezes the corner.
  const apexM = cmp.x[c.apex];
  const fromM = cmp.x[c.start];
  const toM = Math.min(cmp.x[c.end], apexM + Math.max(150, apexM - fromM));
  state.mini = buildCharts(el.querySelector<HTMLElement>(".mini")!, cmp, () => {}, {
    keys: ["speed", "throttle", "brake"],
    range: [fromM, toM],
    compact: true,
    syncKey: "review",
  });
}

$("review-body").addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const head = target.closest<HTMLElement>(".loss-head");
  if (head) {
    const n = Number(head.closest<HTMLElement>("li")!.dataset.corner);
    state.openCorner = state.openCorner === n ? null : n;
    renderReview();
    return;
  }
  const row = target.closest<HTMLElement>("tr[data-lap]");
  if (row && state.current) {
    const lap = Number(row.dataset.lap);
    const best = bestLap(state.current);
    if (!best || lap === best.number || !isValidLap(lapOf({ session: state.current.id, lap })!)) return;
    state.a = { session: state.current.id, lap: best.number };
    state.b = { session: state.current.id, lap };
    state.openCorner = null;
    updateComparison();
  }
});

$("review-body").addEventListener("change", (e) => {
  const sel = e.target as HTMLSelectElement;
  if (sel.id === "review-compare") applyComparePick(sel.value);
});

/** Comparison options: best lap vs each other valid lap, and the personal best vs today's best. */
function compareOptions(): { value: string; label: string; a: LapRef; b: LapRef }[] {
  const s = state.current;
  const best = s && bestLap(s);
  if (!s || !best) return [];
  const a = { session: s.id, lap: best.number };
  const opts = s.laps
    .filter((l) => isValidLap(l) && l !== best)
    .map((l) => ({
      value: `${s.id}|${l.number}`,
      label: t("compare.vsLap", { n: l.number, time: fmtLap(l.time_s) }),
      a,
      b: { session: s.id, lap: l.number },
    }));
  const pb = state.progress?.personal_best;
  const pbSummary = pb && state.progress?.sessions.find((x) => x.id === pb[0]);
  if (pb && pbSummary?.best_lap != null && pb[0] !== s.id) {
    opts.unshift({
      value: `pb|${pb[0]}|${pbSummary.best_lap}`,
      label: t("compare.vsPb", { time: fmtLap(pb[1]), date: fmtDay(pbSummary.started_at) }),
      a: { session: pb[0], lap: pbSummary.best_lap },
      b: a,
    });
  }
  return opts;
}

function compareSelect(id: string): string {
  const opts = compareOptions();
  if (!opts.length) return "";
  const current = opts.find((o) => sameRef(o.a, state.a) && sameRef(o.b, state.b))?.value;
  return `<label class="field field-inline"><span>${t("compare.label")}</span><select id="${id}">${opts
    .map((o) => `<option value="${esc(o.value)}" ${o.value === current ? "selected" : ""}>${esc(o.label)}</option>`)
    .join("")}</select></label>`;
}

function applyComparePick(value: string) {
  const o = compareOptions().find((o) => o.value === value);
  if (!o) return;
  state.a = o.a;
  state.b = o.b;
  state.openCorner = null;
  updateComparison();
}

function legend(): string {
  return `<span style="--c:${COLOR_A}">${esc(state.a ? lapName(state.a) : "")}</span>${
    state.b ? `<span style="--c:${COLOR_B}">${esc(lapName(state.b))}</span>` : ""
  }`;
}

function lapsTable(s: Session): string {
  const valid = s.laps.filter(isValidLap);
  const best = bestLap(s);
  // Bars show the gap to the best lap; cap the scale so one slow lap doesn't flatten the rest.
  const worst = Math.min(
    best ? best.time_s * 1.05 : 0,
    Math.max(...valid.map((l) => l.time_s), best?.time_s ?? 0),
  );
  const span = best ? Math.max(0.2, worst - best.time_s) : 1;
  const rows = s.laps
    .filter((l) => l.complete || l.time_s > 5)
    .map((l) => {
      const ok = isValidLap(l);
      const isBest = l === best;
      const compared = state.b && state.b.session === s.id && state.b.lap === l.number;
      const why = [!l.complete && t("laps.partial"), l.in_pit && t("laps.pit"), l.cut && t("laps.cut")].filter(Boolean).join(", ");
      const gap = ok && best && !isBest ? l.time_s - best.time_s : null;
      const w = gap != null ? Math.min(100, (gap / span) * 100) : 0;
      return `<tr data-lap="${l.number}" class="${ok ? "" : "invalid"} ${isBest ? "is-best" : ""} ${compared ? "is-cmp" : ""}">
        <td class="n">${t("lap.n", { n: l.number })}</td>
        <td class="time">${fmtLap(l.time_s)}</td>
        <td class="gap">${isBest ? t("laps.best") : gap != null ? fmtDelta(gap) : esc(why)}</td>
        <td class="bar">${gap != null ? `<span style="width:${w.toFixed(0)}%"></span>` : ""}</td>
      </tr>`;
    })
    .join("");
  return `<table class="laps">${rows}</table><p class="muted small">${t("review.lapsHint")}</p>`;
}

// ---------- telemetry ----------

function renderTelemetry() {
  const cmp = state.cmp;
  if (!cmp) return;
  $("tele-head").innerHTML = `${compareSelect("tele-compare")}<div class="legend">${legend()}</div>
    <button id="export-lap" class="btn btn-quiet">${t("tele.export")}</button>`;
  $("export-lap").onclick = async () => {
    const path = await call<string>("export_csv", { session: state.a!.session, lap: state.a!.lap });
    toast(t("toast.exported", { path }));
  };
  state.charts?.destroy();
  lastCursor = undefined;
  state.charts = buildCharts($("charts"), cmp, onCursor);
  renderCorners();
  renderPotential();
  renderStats();
  teleMap.render(cmp, null, { mode: "delta" });
  onCursor(null);
}

$("tele-head").addEventListener("change", (e) => {
  const sel = e.target as HTMLSelectElement;
  if (sel.id === "tele-compare") applyComparePick(sel.value);
});

let lastCursor: number | null | undefined;
function onCursor(idx: number | null) {
  if (idx === lastCursor) return;
  lastCursor = idx;
  if (!state.cmp || state.view !== "telemetry") return;
  teleMap.render(state.cmp, idx, { mode: "delta" });
  updateChartHeaders($("charts"), state.cmp, idx);
  renderReadout(idx);
}

function zoomToCorner(number: number) {
  const cmp = state.cmp;
  const c = cmp?.corners.find((c) => c.number === number);
  if (!cmp || !c || !state.charts) return;
  $("corners").querySelectorAll("tr.sel").forEach((r) => r.classList.remove("sel"));
  $("corners").querySelector(`tr[data-corner="${number}"]`)?.classList.add("sel");
  // Setting the scale on one plot propagates to the others via the sync hook.
  state.charts.plots[0]?.setScale("x", { min: cmp.x[c.start], max: cmp.x[c.end] });
}

function renderCorners() {
  const el = $("corners");
  const cmp = state.cmp;
  if (!cmp || !cmp.corners.length) {
    el.innerHTML = "";
    return;
  }
  const hasB = !!cmp.compare;
  const m = t("unit.m");
  const sp = (v: number | null) => (v == null ? "–" : v.toFixed(0));
  const shift = (p: [number | null, number | null]) => {
    const [a, b] = p;
    if (a == null && b == null) return "";
    if (a == null) return t("corners.bOnly");
    if (b == null) return t("corners.aOnly");
    const d = Math.round(b - a);
    return d === 0 ? t("corners.same") : `${d > 0 ? "+" : "−"}${Math.abs(d)} ${m}`;
  };
  const rows = cmp.corners
    .map((c) => {
      const d = c.delta_s ?? 0;
      const cls = d > 0.02 ? "loss" : d < -0.02 ? "gain" : "";
      const minDiff = c.min_speed[0] != null && c.min_speed[1] != null ? c.min_speed[1] - c.min_speed[0] : null;
      return `<tr data-corner="${c.number}" title="${esc(
        cmp.hints.filter((h) => h.corner === c.number).map(hintText).join("\n"),
      )}">
        <td>${c.number}</td>
        ${hasB ? `<td class="num ${cls}">${fmtDelta(d)}</td>` : ""}
        <td class="num">${sp(c.min_speed[0])}${hasB ? ` / ${sp(c.min_speed[1])}` : ""}</td>
        ${hasB ? `<td class="num">${minDiff == null ? "" : `${minDiff > 0 ? "+" : "−"}${Math.abs(minDiff).toFixed(1)}`}</td>
        <td class="num">${shift(c.brake_m)}</td>
        <td class="num">${shift(c.throttle_m)}</td>` : ""}
      </tr>`;
    })
    .join("");
  el.innerHTML = `<table class="data">
    <thead><tr><th>${t("corners.corner")}</th>${hasB ? `<th class="num">${t("corners.time")}</th>` : ""}
      <th class="num">${t("corners.minSpeed")}</th>${hasB ? `<th class="num">${t("corners.deltaMin")}</th><th class="num">${t("corners.brake")}</th><th class="num">${t("corners.throttle")}</th>` : ""}</tr></thead>
    <tbody>${rows}</tbody></table>`;
}

$("corners").addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>("tr[data-corner]");
  if (row) zoomToCorner(Number(row.dataset.corner));
});

function renderPotential() {
  const s = state.current;
  const p = s ? state.potential.get(s.id) : null;
  const el = $("tele-potential");
  if (!p) {
    el.innerHTML = "";
    return;
  }
  const rows = [...p.segments]
    .sort((x, y) => y.reference_s - y.best_s - (x.reference_s - x.best_s))
    .filter((seg) => seg.reference_s - seg.best_s > 0.0005)
    .map(
      (seg) => `<tr data-corner="${seg.corner}" data-lap="${seg.best_lap}">
        <td>${seg.corner}</td>
        <td class="num gain">−${(seg.reference_s - seg.best_s).toFixed(3)}</td>
        <td class="num">${t("lap.n", { n: seg.best_lap })}</td>
        <td class="num">±${seg.stdev_s.toFixed(2)}</td>
      </tr>`,
    )
    .join("");
  el.innerHTML = `<h3>${t("potential.title", { time: fmtLap(p.theoretical_best_s) })}</h3>
    <p class="muted small">${t("potential.sub")}</p>
    <table class="data"><thead><tr><th>${t("corners.corner")}</th><th class="num">${t("potential.reserve")}</th><th class="num">${t("potential.from")}</th><th class="num">${t("potential.spread")}</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

$("tele-potential").addEventListener("click", async (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>("tr[data-corner]");
  const s = state.current;
  const best = s && bestLap(s);
  if (!row || !s || !best) return;
  state.a = { session: s.id, lap: best.number };
  state.b = { session: s.id, lap: Number(row.dataset.lap) };
  await updateComparison();
  zoomToCorner(Number(row.dataset.corner));
});

const READOUT: ["ch.speed" | "ch.throttle" | "ch.brake" | "ch.gear" | "ch.rpm" | "ch.steer" | "ch.g_lat" | "ch.g_long", string, number, number][] = [
  ["ch.speed", "speed", 1, 0],
  ["ch.throttle", "throttle", 100, 0],
  ["ch.brake", "brake", 100, 0],
  ["ch.gear", "gear", 1, 0],
  ["ch.rpm", "rpm", 1, 0],
  ["ch.steer", "steer_deg", 1, 0],
  ["ch.g_lat", "g_lat", 1, 2],
  ["ch.g_long", "g_long", 1, 2],
];

function renderReadout(idx: number | null) {
  const cmp = state.cmp;
  const el = $("readout");
  if (!cmp || idx == null) {
    el.innerHTML = `<p class="muted small">${t("cursor.hover")}</p>`;
    return;
  }
  const hasB = !!cmp.compare;
  const row = (label: string, a: string, b: string) =>
    `<tr><td>${label}</td><td class="num">${a}</td>${hasB ? `<td class="num">${b}</td>` : ""}</tr>`;
  let html = row(t("cursor.distance"), `${Math.round(cmp.x[idx])} ${t("unit.m")}`, "");
  html += row(t("cursor.time"), cmp.reference.elapsed[idx].toFixed(2), cmp.compare ? cmp.compare.elapsed[idx].toFixed(2) : "");
  for (const [label, ch, m, dg] of READOUT) {
    const a = cmp.reference.channels[ch]?.[idx];
    const b = cmp.compare?.channels[ch]?.[idx];
    if (a == null) continue;
    html += row(t(label), (a * m).toFixed(dg), b == null ? "" : (b * m).toFixed(dg));
  }
  el.innerHTML = `<table class="data compact"><thead><tr><th></th><th class="num" style="color:${COLOR_A}">●</th>${hasB ? `<th class="num" style="color:${COLOR_B}">●</th>` : ""}</tr></thead><tbody>${html}</tbody></table>`;
}

function renderStats() {
  const el = $("tele-stats");
  const get = (r: LapRef | null) => (r ? state.stats.get(r.session)?.find((s) => s.lap === r.lap) : undefined);
  const a = get(state.a);
  const b = get(state.b);
  if (!a) {
    el.innerHTML = "";
    return;
  }
  const rows: [Parameters<typeof t>[0], (s: LapStats) => string][] = [
    ["st.maxSpeed", (s) => s.max_speed_kmh.toFixed(0)],
    ["st.avgSpeed", (s) => s.avg_speed_kmh.toFixed(0)],
    ["st.fullThrottle", (s) => `${s.full_throttle_pct.toFixed(0)}%`],
    ["st.braking", (s) => `${s.braking_pct.toFixed(0)}%`],
    ["st.coasting", (s) => `${s.coasting_pct.toFixed(0)}%`],
    ["st.maxLatG", (s) => s.max_g_lat.toFixed(2)],
    ["st.maxBrakeG", (s) => s.max_g_brake.toFixed(2)],
  ];
  el.innerHTML = `<h3>${t("stats.title")}</h3><table class="data compact"><thead><tr><th></th><th class="num" style="color:${COLOR_A}">●</th>${b ? `<th class="num" style="color:${COLOR_B}">●</th>` : ""}</tr></thead><tbody>${rows
    .map(([label, f]) => `<tr><td>${t(label)}</td><td class="num">${f(a)}</td>${b ? `<td class="num">${f(b)}</td>` : ""}</tr>`)
    .join("")}</tbody></table>`;
}

// ---------- progress ----------

function renderProgressView() {
  renderProgress($("view-progress"), state.progress, state.current?.id ?? null, async (id) => {
    state.view = "review";
    await selectSession(id);
  });
}

// ---------- import, demo, export ----------

async function importReplay(path: string) {
  toast(t("toast.importing", { file: path.split(/[\\/]/).pop() ?? path }));
  const meta = await call<Session>("import_replay", { path });
  toast(t("toast.imported", { track: prettyName(meta.track), laps: lapsCount(meta.laps.filter(isValidLap).length) }));
  state.sessions = await call<Session[]>("list_sessions");
  renderSidebar();
  await selectSession(meta.id);
}

async function pickReplay() {
  const path = await open({ multiple: false, filters: [{ name: t("dialog.replay"), extensions: ["acreplay"] }] });
  if (typeof path === "string") await importReplay(path);
}

$("import").addEventListener("click", pickReplay);
$("welcome-import").addEventListener("click", pickReplay);

$("welcome-demo").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("welcome-demo");
  btn.disabled = true;
  btn.textContent = t("welcome.demoBusy");
  try {
    const id = await call<string>("create_demo_session");
    state.sessions = await call<Session[]>("list_sessions");
    renderSidebar();
    await selectSession(id);
  } finally {
    btn.disabled = false;
    btn.textContent = t("welcome.demo");
  }
});

getCurrentWebview().onDragDropEvent(async ({ payload: p }) => {
  $("drop").classList.toggle("show", p.type === "enter" || p.type === "over");
  if (p.type !== "drop") return;
  for (const path of p.paths.filter((x) => x.toLowerCase().endsWith(".acreplay"))) {
    await importReplay(path);
  }
});

// ---------- recorder ----------

function setRecording(on: boolean) {
  state.recording = on;
  $("rec-label").dataset.i18n = on ? "app.stop" : "app.record";
  $("rec-label").textContent = on ? t("app.stop") : t("app.record");
  $("rec-btn").classList.toggle("on", on);
  $<HTMLSelectElement>("source").disabled = on;
}

$("rec-btn").addEventListener("click", async () => {
  if (state.recording) {
    setStatus(() => t("rec.stopping"));
    await call("stop_recording");
    setRecording(false);
    setStatus(() => "");
    loadSessions();
  } else {
    await call("start_recording", { source: $<HTMLSelectElement>("source").value });
    setRecording(true);
    setStatus(() => t("rec.starting"));
  }
});

listen<RecorderEvent>("recorder", ({ payload: e }) => {
  switch (e.type) {
    case "waiting":
      setStatus(() => t("rec.waiting"));
      break;
    case "session_started":
      setStatus(() => t("rec.onTrack", { track: prettyName(e.info.track) }));
      loadSessions();
      break;
    case "lap_completed":
      if (e.lap.complete) {
        const params = { n: e.lap.number, time: fmtLap(e.lap.time_s) };
        setStatus(() => t("rec.lap", params));
        if (!isValidLap(e.lap)) toast(t("toast.lapInvalid", params));
      }
      break;
    case "session_saved":
      toast(t("toast.saved", { laps: lapsCount(e.laps) }));
      state.stats.delete(e.id);
      state.potential.delete(e.id);
      loadSessions();
      break;
    case "session_discarded":
      loadSessions();
      break;
    case "error":
      toast(e.message, "error");
      break;
  }
});

listen("recorder-stopped", () => {
  setRecording(false);
  setStatus(() => "");
});

// ---------- language ----------

function applyLanguage(l: Lang, persist = false) {
  setLang(l, persist);
  $<HTMLSelectElement>("lang").value = l;
  applyStatic();
  $("rec-status").textContent = state.status();
  renderSidebar();
  if (state.current) renderSession();
}

$("lang").addEventListener("change", (e) => applyLanguage((e.target as HTMLSelectElement).value as Lang, true));

// ---------- init ----------

(async () => {
  applyLanguage(getLang());
  setStatus(() => "");
  const st = await call<{ running: boolean; source: string | null }>("recorder_status");
  if (st.running) {
    if (st.source) $<HTMLSelectElement>("source").value = st.source;
    setRecording(true);
    setStatus(() => t("rec.recording"));
  }
  await loadSessions();
})();
