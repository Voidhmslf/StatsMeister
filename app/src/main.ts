import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import "uplot/dist/uPlot.min.css";
import "./style.css";
import { buildCharts, updateChartHeaders, COLOR_A, COLOR_B, type ChartSet } from "./charts";
import { applyStatic, getLang, isKey, lapsCount, setLang, t, type Lang } from "./i18n";
import { TrackMap } from "./trackmap";
import {
  isValidLap,
  type Comparison,
  type Hint,
  type LapRef,
  type LapStats,
  type Potential,
  type RecorderEvent,
  type Session,
} from "./types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  sessions: [] as Session[],
  current: null as Session | null,
  a: null as LapRef | null,
  b: null as LapRef | null,
  cmp: null as Comparison | null,
  stats: new Map<string, LapStats[]>(),
  potential: new Map<string, Potential | null>(),
  charts: null as ChartSet | null,
  cursor: null as number | null,
  recording: false,
  /** Re-evaluated on language change so the status line follows it. */
  status: () => t("rec.idle"),
};

const map = new TrackMap($<HTMLCanvasElement>("map"));

// ---------- formatting ----------

function fmtLap(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "–";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

function fmtDelta(s: number): string {
  return `${s >= 0 ? "+" : "−"}${Math.abs(s).toFixed(3)}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(+d) ? iso : d.toLocaleString(getLang(), { dateStyle: "medium", timeStyle: "short" });
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

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

function setStatus(fn: () => string) {
  state.status = fn;
  $("rec-status").textContent = fn();
}

// ---------- sessions ----------

async function loadSessions() {
  state.sessions = await call<Session[]>("list_sessions");
  renderSessions();
  const keep = state.current && sessionById(state.current.id);
  if (keep) selectSession(keep.id, false);
  else if (state.sessions.find((s) => s.finished)) selectSession(state.sessions.find((s) => s.finished)!.id);
  else renderLaps();
}

function renderSessions() {
  const ul = $("sessions");
  if (!state.sessions.length) {
    ul.innerHTML = `<li class="muted">${t("sessions.empty")}</li>`;
    return;
  }
  ul.innerHTML = state.sessions
    .map((s) => {
      const best = s.laps.filter(isValidLap).reduce((m, l) => Math.min(m, l.time_s), Infinity);
      const laps = s.laps.filter((l) => l.complete).length;
      return `<li class="session ${state.current?.id === s.id ? "active" : ""}" data-id="${esc(s.id)}">
        <div class="s-top"><span class="s-track">${esc(s.track || t("sessions.unknownTrack"))}</span>
          ${s.finished ? `<span class="s-best">${fmtLap(best)}</span>` : `<span class="badge live">${t("sessions.rec")}</span>`}</div>
        <div class="s-car">${esc(s.car || t("sessions.unknownCar"))}</div>
        <div class="s-meta">${esc(s.game)} · ${fmtDate(s.started_at)} · ${lapsCount(laps)}</div>
      </li>`;
    })
    .join("");
}

$("sessions").addEventListener("click", (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>(".session");
  if (li?.dataset.id) selectSession(li.dataset.id);
});

async function selectSession(id: string, autoPick = true) {
  const s = sessionById(id);
  if (!s) return;
  state.current = s;
  renderSessions();
  renderLaps();
  $<HTMLButtonElement>("export-session").disabled = !s.finished;
  if (!s.finished) return;
  if (!state.stats.has(id)) {
    state.stats.set(id, await call<LapStats[]>("lap_stats", { session: id }));
  }
  if (!state.potential.has(id)) {
    state.potential.set(id, await call<Potential | null>("session_potential", { session: id }));
  }
  renderPotential();
  // Keep an existing A selection so laps from different sessions can be compared.
  if (autoPick && !state.a) {
    const valid = s.laps.filter(isValidLap);
    const best = valid.reduce<typeof valid[number] | null>((m, l) => (!m || l.time_s < m.time_s ? l : m), null);
    const pick = best ?? s.laps.find((l) => l.complete) ?? s.laps[0];
    if (pick) {
      // Default view: best lap vs the most recent representative lap. Laps
      // more than 3 % off the best are usually mistakes and would swamp the
      // delta scale, so fall back to the second-best lap in that case.
      const others = valid.filter((l) => l !== best);
      const close = others.filter((l) => best && l.time_s <= best.time_s * 1.03);
      const second = [...others].sort((x, y) => x.time_s - y.time_s)[0];
      const b = close.length ? close[close.length - 1] : second;
      state.a = { session: id, lap: pick.number };
      state.b = b ? { session: id, lap: b.number } : null;
      await updateComparison();
    }
  }
  renderLaps();
}

// ---------- laps ----------

function renderLaps() {
  const s = state.current;
  const table = $("laps");
  $("laps-title").textContent = s ? t("laps.titleTrack", { track: s.track }) : t("laps.title");
  if (!s) {
    table.innerHTML = "";
    return;
  }
  if (!s.finished) {
    table.innerHTML = `<tr><td class="muted">${t("laps.recording")}</td></tr>`;
    return;
  }
  const best = s.laps.filter(isValidLap).reduce((m, l) => Math.min(m, l.time_s), Infinity);
  table.innerHTML =
    `<tr><th>#</th><th>${t("laps.time")}</th><th>${t("laps.deltaBest")}</th><th></th><th></th></tr>` +
    s.laps
      .map((l) => {
        const ref = { session: s.id, lap: l.number };
        const flags = [!l.complete && t("laps.partial"), l.in_pit && t("laps.pit"), l.cut && t("laps.cut")]
          .filter(Boolean)
          .join(" ");
        const isBest = isValidLap(l) && l.time_s === best;
        const d = isValidLap(l) && Number.isFinite(best) ? fmtDelta(l.time_s - best) : "";
        return `<tr class="lap ${isValidLap(l) ? "" : "invalid"} ${isBest ? "best" : ""}" data-lap="${l.number}">
          <td>${l.number}</td>
          <td class="num">${fmtLap(l.time_s)}</td>
          <td class="num dim">${isBest ? t("laps.best") : d}</td>
          <td class="flags">${flags}</td>
          <td class="pick">
            <button class="ab a ${sameRef(state.a, ref) ? "on" : ""}" data-slot="a">A</button>
            <button class="ab b ${sameRef(state.b, ref) ? "on" : ""}" data-slot="b">B</button>
          </td></tr>`;
      })
      .join("");
}

$("laps").addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const row = target.closest<HTMLElement>(".lap");
  if (!row || !state.current) return;
  const ref = { session: state.current.id, lap: Number(row.dataset.lap) };
  const slot = target.closest<HTMLElement>(".ab")?.dataset.slot ?? "a";
  if (slot === "b") {
    state.b = sameRef(state.b, ref) ? null : ref;
  } else {
    state.a = ref;
    if (sameRef(state.a, state.b)) state.b = null;
  }
  renderLaps();
  updateComparison();
});

// ---------- comparison ----------

async function updateComparison() {
  if (!state.a) return;
  state.cmp = await call<Comparison>("compare_laps", { reference: state.a, compare: state.b });
  for (const r of [state.a, state.b]) {
    if (r && !state.stats.has(r.session)) {
      state.stats.set(r.session, await call<LapStats[]>("lap_stats", { session: r.session }));
    }
  }
  renderComparison();
}

/** Redraws everything that depends on the current comparison (no refetch). */
function renderComparison() {
  if (!state.cmp) return;
  state.charts?.destroy();
  state.cursor = null;
  lastCursor = undefined;
  state.charts = buildCharts($("charts"), state.cmp, onCursor);
  renderSummary();
  renderCoach();
  renderCorners();
  renderStats();
  map.render(null, null);
  onCursor(null);
}

let lastCursor: number | null | undefined;
function onCursor(idx: number | null) {
  if (idx === lastCursor) return;
  lastCursor = idx;
  state.cursor = idx;
  if (!state.cmp) return;
  map.render(state.cmp, idx);
  updateChartHeaders($("charts"), state.cmp, idx);
  renderReadout(idx);
}

function lapLabel(r: LapRef) {
  const s = sessionById(r.session);
  const lap = s?.laps.find((l) => l.number === r.lap);
  return { s, lap };
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

function renderSummary() {
  const el = $("summary");
  if (!state.a || !state.cmp) {
    el.innerHTML = "";
    return;
  }
  const chip = (r: LapRef, cls: string, color: string) => {
    const { s, lap } = lapLabel(r);
    return `<div class="chip ${cls}" style="--c:${color}">
      <span class="chip-tag">${cls.toUpperCase()}</span>
      <span class="chip-time">${fmtLap(lap?.time_s ?? 0)}</span>
      <span class="chip-sub">${t("summary.lap", { n: r.lap })} · ${esc(s?.car ?? "")}<br>${esc(s ? fmtDate(s.started_at) : "")}</span>
    </div>`;
  };
  let html = chip(state.a, "a", COLOR_A);
  if (state.b) {
    html += chip(state.b, "b", COLOR_B);
    // Use the recorded lap times; the delta trace is integrated from samples and can be a few ms off.
    const total = (lapLabel(state.b).lap?.time_s ?? 0) - (lapLabel(state.a).lap?.time_s ?? 0);
    html += `<div class="gap ${total > 0 ? "loss" : "gain"}"><span>${t("summary.gap")}</span><b>${fmtDelta(total)} ${t("unit.s")}</b></div>`;
  } else {
    html += `<div class="hint">${t("summary.pickB")}</div>`;
  }
  html += `<div class="summary-actions"><button id="export-lap" class="btn btn-ghost">${t("summary.exportLap")}</button></div>`;
  el.innerHTML = html;
  $("export-lap").onclick = async () => {
    const path = await call<string>("export_csv", { session: state.a!.session, lap: state.a!.lap });
    toast(t("toast.exported", { path }));
  };
}

// ---------- coach ----------

/** Hint numbers rounded for reading: metres and km/h without false precision. */
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

function renderCoach() {
  const el = $("coach");
  const cmp = state.cmp;
  if (!cmp?.compare) {
    el.innerHTML = "";
    return;
  }
  // One card per corner, biggest loss first; hints arrive sorted that way.
  const byCorner = new Map<number, Hint[]>();
  for (const h of cmp.hints) byCorner.set(h.corner, [...(byCorner.get(h.corner) ?? []), h]);
  const cards = [...byCorner.entries()]
    .slice(0, 4)
    .map(
      ([corner, hints]) => `<div class="coach-card" data-corner="${corner}">
        <div class="coach-head"><b>T${corner}</b><span class="loss">${t("coach.lost", { s: hints[0].loss_s.toFixed(3) })}</span></div>
        ${hints.map((h) => `<p>${hintText(h)}</p>`).join("")}
      </div>`,
    )
    .join("");
  el.innerHTML = `<div class="coach-title"><h2>${t("coach.title")}</h2><span class="muted">${t("coach.sub")}</span></div>
    ${cards ? `<div class="coach-cards">${cards}</div>` : `<div class="muted">${t("coach.noLoss")}</div>`}`;
}

$("coach").addEventListener("click", (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>(".coach-card");
  if (card) zoomToCorner(Number(card.dataset.corner));
});

// ---------- potential ----------

function renderPotential() {
  const panel = $("potential-panel");
  const s = state.current;
  const p = s ? state.potential.get(s.id) : null;
  panel.hidden = !p;
  if (!s || !p) return;
  const gain = p.reference_time_s - p.theoretical_best_s;
  const worstSpread = Math.max(0.05, ...p.segments.map((x) => x.stdev_s));
  // Biggest reserves first: that is where practice pays off.
  const rows = [...p.segments]
    .sort((x, y) => y.reference_s - y.best_s - (x.reference_s - x.best_s))
    .map((seg) => {
      const g = Math.max(0, seg.reference_s - seg.best_s);
      return `<tr data-corner="${seg.corner}" data-lap="${seg.best_lap}" title="${t("potential.rowTitle", { a: p.reference_lap, b: seg.best_lap, c: seg.corner })}">
        <td class="cn">T${seg.corner}</td>
        <td class="num ${g > 0.0005 ? "gain" : "dim"}">${g > 0.0005 ? `−${g.toFixed(3)}` : "—"}</td>
        <td class="num dim">${g > 0.0005 ? t("potential.lap", { n: seg.best_lap }) : ""}</td>
        <td class="spread"><span style="width:${((seg.stdev_s / worstSpread) * 100).toFixed(0)}%"></span></td>
        <td class="num dim">±${seg.stdev_s.toFixed(2)}</td>
      </tr>`;
    })
    .join("");
  $("potential").innerHTML = `
    <div class="pot-head">
      <span class="pot-time">${fmtLap(p.theoretical_best_s)}</span>
      <span class="pot-gain">−${gain.toFixed(3)} ${t("unit.s")}</span>
    </div>
    <div class="pot-sub">${t("potential.sub", { laps: p.laps_used.join(", ") })}</div>
    <table class="pot-table">
      <tr><th></th><th class="num">${t("potential.reserve")}</th><th class="num">${t("potential.from")}</th><th colspan="2">${t("potential.consistency")}</th></tr>
      ${rows}
    </table>`;
}

$("potential").addEventListener("click", async (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>("tr[data-corner]");
  const s = state.current;
  const p = s ? state.potential.get(s.id) : null;
  if (!row || !s || !p) return;
  const lap = Number(row.dataset.lap);
  state.a = { session: s.id, lap: p.reference_lap };
  state.b = lap !== p.reference_lap ? { session: s.id, lap } : null;
  renderLaps();
  await updateComparison();
  zoomToCorner(Number(row.dataset.corner));
});

// ---------- corners ----------

function renderCorners() {
  const el = $("corners");
  const cmp = state.cmp;
  if (!cmp || !cmp.corners.length) {
    el.innerHTML = "";
    return;
  }
  const hasB = !!cmp.compare;
  const m = t("unit.m");
  const worst = Math.max(0.05, ...cmp.corners.map((c) => Math.abs(c.delta_s ?? 0)));
  const sp = (v: number | null) => (v == null ? "–" : v.toFixed(0));
  // B relative to A along the lap: "+12 m" = B does it 12 m later.
  const shift = (p: [number | null, number | null]) => {
    const [a, b] = p;
    if (a == null && b == null) return "";
    if (a == null) return `<span class="dim">${t("corners.bOnly")}</span>`;
    if (b == null) return `<span class="dim">${t("corners.aOnly")}</span>`;
    const d = Math.round(b - a);
    return d === 0 ? t("corners.same") : `${d > 0 ? "+" : "−"}${Math.abs(d)} ${m}`;
  };
  const hintsFor = (n: number) =>
    cmp.hints
      .filter((h) => h.corner === n)
      .map(hintText)
      .join("\n");
  const rows = cmp.corners
    .map((c) => {
      const d = c.delta_s ?? 0;
      const w = (Math.abs(d) / worst) * 100;
      const minDiff = c.min_speed[0] != null && c.min_speed[1] != null ? c.min_speed[1] - c.min_speed[0] : null;
      return `<tr data-corner="${c.number}" title="${esc(hintsFor(c.number))}">
        <td class="cn">T${c.number}</td>
        <td class="num dim">${Math.round(c.apex_m)} ${m}</td>
        ${hasB ? `<td class="num ${d > 0.005 ? "loss" : d < -0.005 ? "gain" : ""}">${fmtDelta(d)}</td>
        <td class="bar"><span class="${d > 0 ? "loss" : "gain"}" style="width:${w.toFixed(0)}%"></span></td>` : ""}
        <td class="num">${sp(c.min_speed[0])}${hasB ? ` / ${sp(c.min_speed[1])}` : ""}</td>
        ${hasB ? `<td class="num ${minDiff != null && minDiff < -2 ? "loss" : minDiff != null && minDiff > 2 ? "gain" : "dim"}">${minDiff == null ? "" : `${minDiff > 0 ? "+" : "−"}${Math.abs(minDiff).toFixed(1)}`}</td>
        <td class="num">${shift(c.brake_m)}</td>
        <td class="num">${shift(c.throttle_m)}</td>` : ""}
      </tr>`;
    })
    .join("");
  el.innerHTML = `<table class="corner-table">
    <tr><th>${t("corners.corner")}</th><th class="num">${t("corners.apex")}</th>${hasB ? `<th class="num">${t("corners.bVsA")}</th><th></th>` : ""}
      <th class="num">${t("corners.minSpeed")}${hasB ? " A / B" : ""}</th>${hasB ? `<th class="num">${t("corners.deltaMin")}</th><th class="num">${t("corners.brakeB")}</th><th class="num">${t("corners.throttleB")}</th>` : ""}</tr>
    ${rows}</table>`;
}

$("corners").addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>("tr[data-corner]");
  if (row) zoomToCorner(Number(row.dataset.corner));
});

// ---------- inspector ----------

const READOUT: ["ch.speed" | "ch.throttle" | "ch.brake" | "ch.gear" | "ch.rpm" | "ch.steer" | "ch.g_lat" | "ch.g_long", string, number, number, string][] = [
  // label, channel, multiplier, digits, suffix
  ["ch.speed", "speed", 1, 1, ""],
  ["ch.throttle", "throttle", 100, 0, " %"],
  ["ch.brake", "brake", 100, 0, " %"],
  ["ch.gear", "gear", 1, 0, ""],
  ["ch.rpm", "rpm", 1, 0, ""],
  ["ch.steer", "steer_deg", 1, 0, "°"],
  ["ch.g_lat", "g_lat", 1, 2, ""],
  ["ch.g_long", "g_long", 1, 2, ""],
];

function renderReadout(idx: number | null) {
  const cmp = state.cmp;
  const el = $("readout");
  if (!cmp || idx == null) {
    el.innerHTML = `<tr><td class="muted">${t("cursor.hover")}</td></tr>`;
    return;
  }
  const hasB = !!cmp.compare;
  const head = `<tr><th></th><th style="color:${COLOR_A}">A</th>${hasB ? `<th style="color:${COLOR_B}">B</th>` : ""}</tr>`;
  const row = (label: string, a: string, b: string) =>
    `<tr><td>${label}</td><td class="num">${a}</td>${hasB ? `<td class="num">${b}</td>` : ""}</tr>`;
  let html = head + row(t("cursor.distance"), `${Math.round(cmp.x[idx])} ${t("unit.m")}`, "");
  html += row(t("cursor.time"), cmp.reference.elapsed[idx].toFixed(2), cmp.compare ? cmp.compare.elapsed[idx].toFixed(2) : "");
  for (const [label, ch, m, dg, suffix] of READOUT) {
    const a = cmp.reference.channels[ch]?.[idx];
    const b = cmp.compare?.channels[ch]?.[idx];
    if (a == null) continue;
    html += row(t(label) + suffix, (a * m).toFixed(dg), b == null ? "" : (b * m).toFixed(dg));
  }
  el.innerHTML = html;
}

function renderStats() {
  const el = $("stats");
  const get = (r: LapRef | null) => (r ? state.stats.get(r.session)?.find((s) => s.lap === r.lap) : undefined);
  const a = get(state.a);
  const b = get(state.b);
  if (!a) {
    el.innerHTML = "";
    return;
  }
  const rows: [Parameters<typeof t>[0], (s: LapStats) => string][] = [
    ["st.lapTime", (s) => fmtLap(s.time_s)],
    ["st.maxSpeed", (s) => s.max_speed_kmh.toFixed(1)],
    ["st.avgSpeed", (s) => s.avg_speed_kmh.toFixed(1)],
    ["st.fullThrottle", (s) => `${s.full_throttle_pct.toFixed(1)}%`],
    ["st.braking", (s) => `${s.braking_pct.toFixed(1)}%`],
    ["st.coasting", (s) => `${s.coasting_pct.toFixed(1)}%`],
    ["st.gearChanges", (s) => String(s.gear_changes)],
    ["st.maxLatG", (s) => s.max_g_lat.toFixed(2)],
    ["st.maxBrakeG", (s) => s.max_g_brake.toFixed(2)],
  ];
  el.innerHTML =
    `<tr><th></th><th style="color:${COLOR_A}">A</th>${b ? `<th style="color:${COLOR_B}">B</th>` : ""}</tr>` +
    rows
      .map(([label, f]) => `<tr><td>${t(label)}</td><td class="num">${f(a)}</td>${b ? `<td class="num">${f(b)}</td>` : ""}</tr>`)
      .join("");
}

$("export-session").addEventListener("click", async () => {
  if (!state.current) return;
  const path = await call<string>("export_csv", { session: state.current.id, lap: null });
  toast(t("toast.exported", { path }));
});

$("refresh").addEventListener("click", () => loadSessions());

// ---------- replay import ----------

async function importReplay(path: string) {
  toast(t("toast.importing", { file: path.split(/[\\/]/).pop() ?? path }));
  const meta = await call<Session>("import_replay", { path });
  toast(t("toast.imported", { track: meta.track, laps: lapsCount(meta.laps.filter(isValidLap).length) }));
  state.a = null;
  state.b = null;
  await loadSessions();
  await selectSession(meta.id);
}

$("import").addEventListener("click", async () => {
  const path = await open({
    multiple: false,
    filters: [{ name: t("dialog.replay"), extensions: ["acreplay"] }],
  });
  if (typeof path === "string") await importReplay(path);
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
    setStatus(() => t("rec.idle"));
    loadSessions();
  } else {
    const source = $<HTMLSelectElement>("source").value;
    await call("start_recording", { source });
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
      setStatus(() => `● ${e.info.track} · ${e.info.car}`);
      loadSessions();
      break;
    case "lap_completed":
      if (e.lap.complete) {
        const params = { n: e.lap.number, time: fmtLap(e.lap.time_s) };
        setStatus(() => t("rec.lap", params));
        toast(t(isValidLap(e.lap) ? "toast.lap" : "toast.lapInvalid", params));
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
  setStatus(() => t("rec.idle"));
});

// ---------- language ----------

function applyLanguage(l: Lang, persist = false) {
  setLang(l, persist);
  $<HTMLSelectElement>("lang").value = l;
  applyStatic();
  $("rec-status").textContent = state.status();
  renderSessions();
  renderLaps();
  renderPotential();
  if (state.cmp) renderComparison();
  else renderReadout(null);
}

$("lang").addEventListener("change", (e) => applyLanguage((e.target as HTMLSelectElement).value as Lang, true));

// ---------- init ----------

(async () => {
  applyLanguage(getLang());
  const st = await call<{ running: boolean; source: string | null }>("recorder_status");
  if (st.running) {
    if (st.source) $<HTMLSelectElement>("source").value = st.source;
    setRecording(true);
    setStatus(() => t("rec.recording"));
  }
  await loadSessions();
})();
