import type { Comparison } from "./types";
import { COLOR_A, COLOR_B } from "./charts";

const GAIN = "#4fc27a";
const LOSS = "#e5675a";
const LINE = "#3a3b41";
const LABEL = "#c9c9cf";
const BG = "#17181b";

export interface MapOptions {
  /**
   * "delta": colour the whole lap by where the compared lap gains or loses.
   * "focus": grey lap with only the listed corners highlighted.
   */
  mode: "delta" | "focus";
  /** Corners to highlight and label in focus mode. */
  focus?: number[];
  /** Corner drawn emphasised in focus mode. */
  active?: number | null;
}

/** Top-down track outline drawn from the reference lap's positions. */
export class TrackMap {
  private base: HTMLCanvasElement | null = null;
  private pts: [number, number][] = [];
  private cmp: Comparison | null = null;
  private idx: number | null = null;
  private opts: MapOptions = { mode: "delta" };
  private optsKey = "";

  constructor(private canvas: HTMLCanvasElement) {
    new ResizeObserver(() => {
      requestAnimationFrame(() => this.cmp && this.render(this.cmp, this.idx, this.opts, true));
    }).observe(canvas);
  }

  render(cmp: Comparison | null, idx: number | null, opts: MapOptions = this.opts, force = false) {
    const key = JSON.stringify(opts);
    const changed = force || cmp !== this.cmp || key !== this.optsKey;
    this.cmp = cmp;
    this.idx = idx;
    this.opts = opts;
    this.optsKey = key;
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h || changed) {
      c.width = w;
      c.height = h;
      this.base = cmp ? this.drawBase(cmp, w, h, dpr) : null;
    }
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    if (!this.base) return;
    ctx.drawImage(this.base, 0, 0);
    if (idx != null && this.pts[idx]) {
      const [x, y] = this.pts[idx];
      ctx.fillStyle = cmp?.compare ? COLOR_B : COLOR_A;
      ctx.strokeStyle = BG;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawBase(cmp: Comparison, w: number, h: number, dpr: number): HTMLCanvasElement | null {
    const xs = cmp.reference.channels["pos_x"];
    const zs = cmp.reference.channels["pos_z"];
    if (!xs || !zs || xs.length < 2) {
      this.pts = [];
      return null;
    }
    const pad = 18 * dpr;
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const scale = Math.min((w - 2 * pad) / (maxX - minX || 1), (h - 2 * pad) / (maxZ - minZ || 1));
    const ox = (w - (maxX - minX) * scale) / 2;
    const oy = (h - (maxZ - minZ) * scale) / 2;
    this.pts = xs.map((x, i) => [ox + (x - minX) * scale, oy + (zs[i] - minZ) * scale]);

    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d")!;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const stroke = (from: number, to: number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width * dpr;
      ctx.beginPath();
      ctx.moveTo(...this.pts[from]);
      for (let i = from + 1; i <= to && i < this.pts.length; i++) ctx.lineTo(...this.pts[i]);
      ctx.stroke();
    };

    stroke(0, this.pts.length - 1, LINE, 5);

    const labelled: number[] = [];
    if (this.opts.mode === "focus") {
      for (const c of cmp.corners) {
        if (!this.opts.focus?.includes(c.number)) continue;
        // Highlight from the braking zone to the apex exit, not the whole straight.
        const from = Math.max(c.start, c.apex - Math.round((c.apex - c.start) * 0.5));
        const to = Math.min(c.end, c.apex + Math.round((c.end - c.apex) * 0.35));
        stroke(from, to, LOSS, c.number === this.opts.active ? 6 : 4);
        labelled.push(c.number);
      }
    } else if (cmp.delta) {
      const d = cmp.delta;
      // Smooth the delta slope over ~20 m so the colours are readable.
      const win = Math.max(1, Math.round(20 / (cmp.track_length_m / cmp.x.length)));
      const colorAt = (i: number) => {
        const slope = (d[Math.min(d.length - 1, i + win)] - d[Math.max(0, i - win)]) / (2 * win);
        return slope < -2e-5 ? GAIN : slope > 2e-5 ? LOSS : null;
      };
      let runStart = 0;
      let run = colorAt(0);
      for (let i = 1; i <= this.pts.length; i++) {
        const col = i < this.pts.length ? colorAt(i) : undefined;
        if (col !== run) {
          if (run) stroke(runStart, i, run, 3);
          runStart = i;
          run = col ?? null;
        }
      }
      labelled.push(...cmp.corners.map((c) => c.number));
    } else {
      stroke(0, this.pts.length - 1, "#6b6b73", 2);
      labelled.push(...cmp.corners.map((c) => c.number));
    }

    // Corner numbers, pushed away from the map centre so they sit outside the line.
    ctx.font = `600 ${11 * dpr}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cx = w / 2, cy = h / 2;
    for (const c of cmp.corners) {
      if (!labelled.includes(c.number)) continue;
      const [x, y] = this.pts[c.apex] ?? [];
      if (x == null) continue;
      const dx = x - cx, dy = y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const lx = x + (dx / len) * 14 * dpr, ly = y + (dy / len) * 14 * dpr;
      ctx.fillStyle = this.opts.mode === "focus" ? LOSS : LABEL;
      ctx.fillText(String(c.number), lx, ly);
    }

    // Start/finish line across the track.
    const [sx, sy] = this.pts[0];
    const [nx, ny] = this.pts[Math.min(3, this.pts.length - 1)];
    const ang = Math.atan2(ny - sy, nx - sx) + Math.PI / 2;
    ctx.strokeStyle = "#e4e4e7";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(sx - Math.cos(ang) * 7 * dpr, sy - Math.sin(ang) * 7 * dpr);
    ctx.lineTo(sx + Math.cos(ang) * 7 * dpr, sy + Math.sin(ang) * 7 * dpr);
    ctx.stroke();
    return off;
  }
}
