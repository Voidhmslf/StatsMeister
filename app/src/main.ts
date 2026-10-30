import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "uplot/dist/uPlot.min.css";
import "./style.css";
import { buildCharts, updateChartHeaders, COLOR_A, COLOR_B, type ChartSet } from "./charts";
import { TrackMap } from "./trackmap";
import { isValidLap, type Comparison, type LapRef, type LapStats, type RecorderEvent, type Session } from "./types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  sessions: [] as Session[],
  current: null as Session | null,
  a: null as LapRef | null,
  b: null as LapRef | null,
  cmp: null as Comparison | null,
  stats: new Map<string, LapStats[]>(),
  charts: null as ChartSet | null,
  cursor: null as number | null,
  recording: false,
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
  return isNaN(+d) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
    ul.innerHTML = `<li class="muted">No sessions recorded yet</li>`;
    return;
  }
  ul.innerHTML = state.sessions
    .map((s) => {
      const best = s.laps.filter(isValidLap).reduce((m, l) => Math.min(m, l.time_s), Infinity);
      const laps = s.laps.filter((l) => l.complete).length;
      return `<li class="session ${state.current?.id === s.id ? "active" : ""}" data-id="${esc(s.id)}">
        <div class="s-top"><span class="s-track">${esc(s.track || "Unknown track")}</span>
          ${s.finished ? `<span class="s-best">${fmtLap(best)}</span>` : `<span class="badge live">REC</span>`}</div>
        <div class="s-car">${esc(s.car || "Unknown car")}</div>
        <div class="s-meta">${esc(s.game)} · ${fmtDate(s.started_at)} · ${laps} laps</div>
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
  // Keep an existing A selection so laps from different sessions can be compared.
  if (autoPick && !state.a) {
    const valid = s.laps.filter(isValidLap);
    const best = valid.reduce<typeof valid[number] | null>((m, l) => (!m || l.time_s < m.time_s ? l : m), null);
    const pick = best ?? s.laps.find((l) => l.complete) ?? s.laps[0];
    if (pick) {
      // Default view: best lap vs the most recent valid lap.
      const latest = [...valid].reverse().find((l) => l !== best);
      state.a = { session: id, lap: pick.number };
      state.b = latest ? { session: id, lap: latest.number } : null;
      await updateComparison();
    }
  }
  renderLaps();
}

// ---------- laps ----------

function renderLaps() {
  const s = state.current;
  const table = $("laps");
  $("laps-title").textContent = s ? `Laps · ${s.track}` : "Laps";
  if (!s) {
    table.innerHTML = "";
    return;
  }
  if (!s.finished) {
    table.innerHTML = `<tr><td class="muted">Session is still being recorded (or was interrupted).</td></tr>`;
    return;
  }
  const best = s.laps.filter(isValidLap).reduce((m, l) => Math.min(m, l.time_s), Infinity);
  table.innerHTML =
    `<tr><th>#</th><th>Time</th><th>Δ best</th><th></th><th></th></tr>` +
    s.laps
      .map((l) => {
        const ref = { session: s.id, lap: l.number };
        const flags = [!l.complete && "partial", l.in_pit && "pit", l.cut && "cut"].filter(Boolean).join(" ");
        const isBest = isValidLap(l) && l.time_s === best;
        const d = isValidLap(l) && Number.isFinite(best) ? fmtDelta(l.time_s - best) : "";
        return `<tr class="lap ${isValidLap(l) ? "" : "invalid"} ${isBest ? "best" : ""}" data-lap="${l.number}">
          <td>${l.number}</td>
          <td class="num">${fmtLap(l.time_s)}</td>
          <td class="num dim">${isBest ? "best" : d}</td>
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
  state.charts?.destroy();
  state.cursor = null;
  state.charts = buildCharts($("charts"), state.cmp, onCursor);
  renderSummary();
  renderStats();
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
      <span class="chip-sub">Lap ${r.lap} · ${esc(s?.car ?? "")}<br>${esc(s ? fmtDate(s.started_at) : "")}</span>
    </div>`;
  };
  let html = chip(state.a, "a", COLOR_A);
  if (state.b) {
    html += chip(state.b, "b", COLOR_B);
    // Use the recorded lap times; the delta trace is integrated from samples and can be a few ms off.
    const total = (lapLabel(state.b).lap?.time_s ?? 0) - (lapLabel(state.a).lap?.time_s ?? 0);
    html += `<div class="gap ${total > 0 ? "loss" : "gain"}"><span>Gap</span><b>${fmtDelta(total)} s</b></div>`;
  } else {
    html += `<div class="hint">Pick a <b class="b">B</b> lap to compare — from this or any other session on the same track.</div>`;
  }
  html += `<div class="summary-actions"><button id="export-lap" class="btn btn-ghost">Export lap A (CSV)</button></div>`;
  el.innerHTML = html;
  $("export-lap").onclick = async () => {
    const path = await call<string>("export_csv", { session: state.a!.session, lap: state.a!.lap });
    toast(`Saved ${path}`);
  };
}

const READOUT: [string, string, number, number][] = [
  // label, channel, multiplier, digits
  ["Speed", "speed", 1, 1],
  ["Throttle %", "throttle", 100, 0],
  ["Brake %", "brake", 100, 0],
  ["Gear", "gear", 1, 0],
  ["RPM", "rpm", 1, 0],
  ["Steer %", "steer", 100, 0],
  ["Lat G", "g_lat", 1, 2],
  ["Long G", "g_long", 1, 2],
];

function renderReadout(idx: number | null) {
  const cmp = state.cmp;
  const el = $("readout");
  if (!cmp || idx == null) {
    el.innerHTML = `<tr><td class="muted">Hover the charts</td></tr>`;
    return;
  }
  const hasB = !!cmp.compare;
  const head = `<tr><th></th><th style="color:${COLOR_A}">A</th>${hasB ? `<th style="color:${COLOR_B}">B</th>` : ""}</tr>`;
  const row = (label: string, a: string, b: string) =>
    `<tr><td>${label}</td><td class="num">${a}</td>${hasB ? `<td class="num">${b}</td>` : ""}</tr>`;
  let html = head + row("Distance", `${Math.round(cmp.x[idx])} m`, "");
  html += row("Time", cmp.reference.elapsed[idx].toFixed(2), cmp.compare ? cmp.compare.elapsed[idx].toFixed(2) : "");
  for (const [label, ch, m, dg] of READOUT) {
    const a = cmp.reference.channels[ch]?.[idx];
    const b = cmp.compare?.channels[ch]?.[idx];
    if (a == null) continue;
    html += row(label, (a * m).toFixed(dg), b == null ? "" : (b * m).toFixed(dg));
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
  const rows: [string, (s: LapStats) => string][] = [
    ["Lap time", (s) => fmtLap(s.time_s)],
    ["Max speed", (s) => s.max_speed_kmh.toFixed(1)],
    ["Avg speed", (s) => s.avg_speed_kmh.toFixed(1)],
    ["Full throttle", (s) => `${s.full_throttle_pct.toFixed(1)}%`],
    ["Braking", (s) => `${s.braking_pct.toFixed(1)}%`],
    ["Coasting", (s) => `${s.coasting_pct.toFixed(1)}%`],
    ["Gear changes", (s) => String(s.gear_changes)],
    ["Max lat G", (s) => s.max_g_lat.toFixed(2)],
    ["Max brake G", (s) => s.max_g_brake.toFixed(2)],
  ];
  el.innerHTML =
    `<tr><th></th><th style="color:${COLOR_A}">A</th>${b ? `<th style="color:${COLOR_B}">B</th>` : ""}</tr>` +
    rows
      .map(([label, f]) => `<tr><td>${label}</td><td class="num">${f(a)}</td>${b ? `<td class="num">${f(b)}</td>` : ""}</tr>`)
      .join("");
}

$("export-session").addEventListener("click", async () => {
  if (!state.current) return;
  const path = await call<string>("export_csv", { session: state.current.id, lap: null });
  toast(`Saved ${path}`);
});

$("refresh").addEventListener("click", () => loadSessions());

// ---------- recorder ----------

function setRecording(on: boolean, status?: string) {
  state.recording = on;
  $("rec-label").textContent = on ? "Stop" : "Record";
  $("rec-btn").classList.toggle("on", on);
  $<HTMLSelectElement>("source").disabled = on;
  if (status !== undefined) $("rec-status").textContent = status;
}

$("rec-btn").addEventListener("click", async () => {
  if (state.recording) {
    $("rec-status").textContent = "Stopping…";
    await call("stop_recording");
    setRecording(false, "Idle");
    loadSessions();
  } else {
    const source = $<HTMLSelectElement>("source").value;
    await call("start_recording", { source });
    setRecording(true, "Starting…");
  }
});

listen<RecorderEvent>("recorder", ({ payload: e }) => {
  const status = $("rec-status");
  switch (e.type) {
    case "waiting":
      status.textContent = "Waiting for game…";
      break;
    case "session_started":
      status.textContent = `● ${e.info.track} · ${e.info.car}`;
      loadSessions();
      break;
    case "lap_completed":
      if (e.lap.complete) {
        status.textContent = `● Lap ${e.lap.number}: ${fmtLap(e.lap.time_s)}`;
        toast(`Lap ${e.lap.number}: ${fmtLap(e.lap.time_s)}${isValidLap(e.lap) ? "" : " (invalid)"}`);
      }
      break;
    case "session_saved":
      toast(`Session saved: ${e.laps} laps`);
      state.stats.delete(e.id);
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

listen("recorder-stopped", () => setRecording(false, "Idle"));

// ---------- init ----------

(async () => {
  const st = await call<{ running: boolean; source: string | null }>("recorder_status");
  if (st.running) {
    if (st.source) $<HTMLSelectElement>("source").value = st.source;
    setRecording(true, "Recording…");
  }
  renderReadout(null);
  await loadSessions();
})();
