/**
 * The opening of the map: the visitor starts above a deck of cumulus and falls through it
 * onto the city. Clouds are soft puffs painted once into small sprites, then placed at
 * different depths; as the fall progresses each layer swells and slides outward from the
 * middle of the screen (nearer ones faster), and finally thins away to reveal the map.
 *
 * The layer is a single 2D canvas that never takes pointer events, so the map can be grabbed
 * mid-fall. It is drawn at most ~1100 px across and scaled up by CSS: cloud is soft, and
 * phones keep their frame rate.
 */

type Rgb = readonly [number, number, number];

interface Puff {
  x: number; // -1..1 across the screen from its centre (at depth 1)
  y: number;
  depth: number; // distance below the camera at the start of the fall
  size: number; // radius as a fraction of the shorter screen side (at depth 1)
  sprite: number;
}

export interface CloudPalette {
  lit: Rgb;
  body: Rgb;
  shade: Rgb;
}

/** Day cloud is warm paper white; night cloud only faintly lit (bright tops on dark read as bubbles). */
export function cloudPaletteForSun(sunAltitudeDeg: number): CloudPalette {
  const night = Math.max(0, Math.min(1, (2 - sunAltitudeDeg) / 10));
  const golden = Math.max(0, Math.min(1, 1 - Math.abs(sunAltitudeDeg - 4) / 8)) * (1 - night);
  const mix = (day: Rgb, dusk: Rgb, dark: Rgb): Rgb =>
    day.map((v, i) => {
      const warm = v + (dusk[i]! - v) * golden;
      return Math.round(warm + (dark[i]! - warm) * night);
    }) as unknown as Rgb;
  return {
    lit: mix([253, 250, 244], [255, 236, 214], [150, 157, 180]),
    body: mix([237, 232, 223], [240, 214, 196], [122, 129, 154]),
    shade: mix([207, 204, 201], [205, 178, 170], [96, 103, 130]),
  };
}

/** Small seeded generator so the deck is the same every visit. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function paintSprite(seed: number, pal: CloudPalette): HTMLCanvasElement {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d");
  if (!g) return c;
  const rnd = seeded(seed * 7919 + 17);
  const css = (rgb: Rgb, a = 1) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  g.filter = "blur(7px)";
  // a flat-ish underside first, then rounded heads on top, each lit from the upper left
  for (let k = 0; k < 10; k++) {
    const head = k >= 3;
    const x = S * (0.26 + rnd() * 0.48);
    const y = S * (head ? 0.34 + rnd() * 0.22 : 0.5 + rnd() * 0.12);
    const r = S * (head ? 0.12 + rnd() * 0.12 : 0.16 + rnd() * 0.08);
    const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.08, x, y, r);
    grad.addColorStop(0, css(pal.lit));
    grad.addColorStop(0.55, css(pal.body));
    grad.addColorStop(1, css(pal.shade, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class CloudIntro {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sprites: HTMLCanvasElement[];
  private readonly puffs: Puff[];
  private readonly palette: CloudPalette;
  private idleRaf = 0;
  private progress = 0;
  private done = false;

  constructor(sunAltitudeDeg: number) {
    this.palette = cloudPaletteForSun(sunAltitudeDeg);
    this.canvas = document.createElement("canvas");
    this.canvas.className = "cloud-intro";
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d");
    this.sprites = [1, 2, 3, 4, 5].map((s) => paintSprite(s, this.palette));

    const rnd = seeded(2026);
    this.puffs = [];
    for (let i = 0; i < 64; i++) {
      // more puffs near the camera's line of sight, so the middle clears last
      const a = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 0.7) * 1.35;
      this.puffs.push({
        x: Math.cos(a) * r,
        y: Math.sin(a) * r * 0.8,
        depth: 0.12 + rnd() * 1.05,
        size: 0.22 + rnd() * 0.26,
        sprite: Math.floor(rnd() * 5),
      });
    }
    // far puffs first: painter's order
    this.puffs.sort((p, q) => q.depth - p.depth);
  }

  /** Covers the screen with cloud while the drawing loads. */
  mount(parent: HTMLElement = document.body): void {
    parent.appendChild(this.canvas);
    this.resize();
    window.addEventListener("resize", this.resize);
    const idle = (now: number) => {
      if (this.done || this.progress > 0) return;
      this.draw(0, now / 1000);
      this.idleRaf = window.requestAnimationFrame(idle);
    };
    this.idleRaf = window.requestAnimationFrame(idle);
  }

  /** 0 = above the deck, 1 = through it. */
  setProgress(t: number): void {
    if (this.done) return;
    this.progress = Math.max(0, Math.min(1, t));
    this.draw(this.progress, performance.now() / 1000);
    if (this.progress >= 1) this.finish();
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    if (this.idleRaf) window.cancelAnimationFrame(this.idleRaf);
    window.removeEventListener("resize", this.resize);
    this.canvas.classList.add("gone");
    window.setTimeout(() => this.canvas.remove(), 400);
  }

  private readonly resize = (): void => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const k = Math.min(1, 1100 / Math.max(W, H, 1));
    this.canvas.width = Math.max(1, Math.round(W * k));
    this.canvas.height = Math.max(1, Math.round(H * k));
    if (!this.done) this.draw(this.progress, performance.now() / 1000);
  };

  private draw(t: number, timeSec: number): void {
    const g = this.ctx;
    if (!g) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const short = Math.min(W, H);
    const cx = W * 0.5;
    const cy = H * 0.5;
    const pal = this.palette;
    g.clearRect(0, 0, W, H);

    // a solid sheet under the puffs for the first part of the fall: nothing of the map shows yet
    const sheet = 1 - smoothstep(0.05, 0.42, t);
    if (sheet > 0.001) {
      const grad = g.createRadialGradient(cx, cy * 0.8, short * 0.1, cx, cy, Math.hypot(W, H) * 0.6);
      grad.addColorStop(0, `rgba(${pal.lit.join(",")},${sheet})`);
      grad.addColorStop(1, `rgba(${pal.body.join(",")},${sheet})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }

    const fall = t * 1.25;
    const fadeOut = 1 - smoothstep(0.82, 1, t);
    for (const p of this.puffs) {
      const z = p.depth - fall;
      if (z <= 0.03) continue; // already passed the camera
      const f = 0.42 / z;
      const drift = Math.sin(timeSec * 0.25 + p.depth * 9) * 0.012;
      const x = cx + (p.x + drift) * W * 0.5 * f;
      const y = cy + p.y * H * 0.5 * f;
      const r = p.size * short * f;
      // puffs right in front of the camera thin out instead of filling the screen
      const alpha = smoothstep(0.03, 0.22, z) * fadeOut;
      if (alpha < 0.01 || r < 2) continue;
      if (x + r < 0 || x - r > W || y + r < 0 || y - r > H) continue;
      g.globalAlpha = alpha;
      g.drawImage(this.sprites[p.sprite]!, x - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
  }
}
