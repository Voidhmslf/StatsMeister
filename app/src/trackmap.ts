import type { Comparison } from "./types";
import { COLOR_A } from "./charts";

const GAIN = "#4ade80";
const LOSS = "#f87171";
const NEUTRAL = "#4b5563";

/** Top-down track outline from the reference lap, coloured by where lap B gains or loses time. */
export class TrackMap {
  private base: HTMLCanvasElement | null = null;
  private pts: [number, number][] = [];
  private cmp: Comparison | null = null;
  private idx: number | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    new ResizeObserver(() => {
      requestAnimationFrame(() => this.cmp && this.render(this.cmp, this.idx));
    }).observe(canvas);
  }

  render(cmp: Comparison | null, idx: number | null) {
    const changed = cmp !== this.cmp;
    this.cmp = cmp;
    this.idx = idx;
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr) || changed) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      this.base = cmp ? this.drawBase(cmp, c.width, c.height, dpr) : null;
    }
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!this.base) return;
    ctx.drawImage(this.base, 0, 0);
    if (idx != null && this.pts[idx]) {
      const [x, y] = this.pts[idx];
      ctx.fillStyle = COLOR_A;
      ctx.strokeStyle = "#0d1014";
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
    const pad = 14 * dpr;
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

    // Wide dark underlay, then the coloured racing line on top.
    ctx.strokeStyle = "#1f252d";
    ctx.lineWidth = 9 * dpr;
    ctx.beginPath();
    this.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();

    ctx.lineWidth = 3.5 * dpr;
    const d = cmp.delta;
    // Smooth the delta slope over ~20 m so the colours are readable.
    const win = Math.max(1, Math.round(20 / (cmp.track_length_m / cmp.x.length)));
    const colorAt = (i: number) => {
      if (!d) return COLOR_A;
      const a = d[Math.max(0, i - win)];
      const b = d[Math.min(d.length - 1, i + win)];
      const slope = (b - a) / (2 * win);
      if (slope < -2e-5) return GAIN;
      if (slope > 2e-5) return LOSS;
      return NEUTRAL;
    };
    let run = colorAt(0);
    ctx.beginPath();
    ctx.moveTo(...this.pts[0]);
    for (let i = 1; i < this.pts.length; i++) {
      ctx.lineTo(...this.pts[i]);
      const col = colorAt(i);
      if (col !== run || i === this.pts.length - 1) {
        ctx.strokeStyle = run;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(...this.pts[i]);
        run = col;
      }
    }

    // Corner numbers next to each apex.
    ctx.font = `600 ${10 * dpr}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cx = w / 2, cy = h / 2;
    for (const c of cmp.corners) {
      const [x, y] = this.pts[c.apex] ?? [];
      if (x == null) continue;
      // Push the label away from the map centre so it sits outside the line.
      const dx = x - cx, dy = y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const lx = x + (dx / len) * 12 * dpr, ly = y + (dy / len) * 12 * dpr;
      ctx.fillStyle = "#0d1014";
      ctx.beginPath();
      ctx.arc(lx, ly, 7 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#cbd5e1";
      ctx.fillText(String(c.number), lx, ly + 0.5 * dpr);
    }

    // Start/finish marker.
    const [sx, sy] = this.pts[0];
    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(sx - 3 * dpr, sy - 3 * dpr, 6 * dpr, 6 * dpr);
    return off;
  }
}
