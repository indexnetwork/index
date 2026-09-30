import { useEffect, useRef } from "react";

const W = 1080;
const H = 620;
const INK = "#041729";
const BLUE = "#4091BB";
const MUTE = "#5E6F7C";
const BG = "#FCFEFB";
/** Milliseconds per animation time unit; higher is slower. */
const TIME_SCALE_MS = 700;
const NAMES = ["Mira", "Theo", "Zoe", "Omar", "Nina", "Sam"];
/** Which counterparty matches in each 9s cycle. */
const HITS = [2, 0, 4, 1, 5, 3];

type Pt = { x: number; y: number };
type Images = Record<string, HTMLImageElement>;

const identicon = (seed: string) =>
  `https://api.dicebear.com/9.x/identicon/svg?seed=${seed}&rowColor=041729&backgroundColor=e8eee5&scale=70`;
const portrait = (name: string) =>
  `https://api.dicebear.com/9.x/notionists/svg?seed=${name}-idx&backgroundColor=e8eee5`;

function loadImages(): Images {
  const imgs: Images = {};
  const load = (key: string, src: string) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.src = src;
    imgs[key] = im;
  };
  load("you", portrait("you"));
  load("agent", identicon("index-agent"));
  for (const n of NAMES) {
    load(n, portrait(n));
    load(`agent-${n}`, identicon(`agent-${n}`));
  }
  return imgs;
}

/** Point on the curved path from `p` to `q` at `u` ∈ [0, 1]. */
function bezier(p: Pt, q: Pt, u: number): Pt {
  const x0 = p.x + 34, y0 = p.y + (q.y - p.y) * 0.04, x3 = q.x - 32, y3 = q.y;
  const x1 = x0 + 260, y1 = y0 + (y3 - y0) * 0.3, x2 = x3 - 280, y2 = y3;
  const m = 1 - u;
  return {
    x: m * m * m * x0 + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u * u * u * x3,
    y: m * m * m * y0 + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u * u * u * y3,
  };
}

function drawFan(c: CanvasRenderingContext2D, t: number, dpr: number, imgs: Images) {
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = BG;
  c.fillRect(0, 0, W, H);

  const you = { x: 90, y: 64 };
  const me = { x: 90, y: 320 };
  const targets = NAMES.map((n, i) => ({ n, x: 900, y: 52 + i * 100 }));
  const cycle = 9;
  const k = Math.floor(t / cycle);
  const ph = t % cycle;
  const hit = HITS[k % HITS.length];

  c.lineCap = "round";
  targets.forEach((q, i) => {
    c.strokeStyle = "rgba(4,23,41,.3)";
    c.lineWidth = 1.5;
    c.beginPath();
    for (let u = 0; u <= 1.001; u += 0.02) {
      const p = bezier(me, q, u);
      if (u === 0) c.moveTo(p.x, p.y);
      else c.lineTo(p.x, p.y);
    }
    c.stroke();

    // three ink dots ping-pong along each path
    const speed = 0.14 + (i % 3) * 0.03;
    for (const offset of [0, 0.33, 0.66]) {
      const raw = t * speed + i * 0.37 + offset;
      const u = raw % 1;
      const back = Math.floor(raw) % 2 === 1;
      const p = bezier(me, q, back ? 1 - u : u);
      c.fillStyle = INK;
      c.beginPath();
      c.arc(p.x, p.y, 4.5, 0, 7);
      c.fill();
    }
  });

  // the match travels back along its path, then up to "you"
  let youPulse = 0;
  if (ph > 5.4 && ph < 7.2) {
    const u = (ph - 5.4) / 1.8;
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const p = bezier(me, targets[hit], 1 - e);
    c.fillStyle = BLUE;
    c.beginPath();
    c.arc(p.x, p.y, 7, 0, 7);
    c.fill();
  } else if (ph >= 7.2 && ph < 7.9) {
    const u = (ph - 7.2) / 0.7;
    c.fillStyle = BLUE;
    c.beginPath();
    c.arc(me.x, me.y - 34 - u * (me.y - you.y - 56), 7, 0, 7);
    c.fill();
  } else if (ph >= 7.9) {
    youPulse = 1 - (ph - 7.9) / 1.1;
  }

  c.strokeStyle = "rgba(4,23,41,.5)";
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(me.x, you.y + 24);
  c.lineTo(me.x, me.y - 34);
  c.stroke();

  const avatar = (x: number, y: number, r: number, bg: string, fg: string, key: string) => {
    const rr = r * 0.28;
    c.save();
    c.beginPath();
    c.roundRect(x - r, y - r, r * 2, r * 2, rr);
    c.fillStyle = bg;
    c.fill();
    c.clip();
    const im = imgs[key];
    if (im && im.complete && im.naturalWidth) {
      c.drawImage(im, x - r, y - r, r * 2, r * 2);
      c.restore();
      c.strokeStyle = "rgba(4,23,41,.25)";
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(x - r, y - r, r * 2, r * 2, rr);
      c.stroke();
      return;
    }
    // fallback silhouette while images load (or if they fail)
    c.fillStyle = fg;
    c.beginPath();
    c.arc(x, y - r * 0.18, r * 0.34, 0, 7);
    c.fill();
    c.beginPath();
    c.ellipse(x, y + r * 0.78, r * 0.62, r * 0.5, 0, 0, 7);
    c.fill();
    c.restore();
  };
  const ring = (x: number, y: number, r: number, col: string, w: number) => {
    c.strokeStyle = col;
    c.lineWidth = w;
    c.beginPath();
    c.roundRect(x - r, y - r, r * 2, r * 2, r * 0.3);
    c.stroke();
  };

  if (youPulse > 0) ring(you.x, you.y, 24 + (1 - youPulse) * 22, `rgba(64,145,187,${youPulse})`, 2.5);
  avatar(you.x, you.y, 22, "#DCE7D7", "#8FA39A", "you");
  c.font = "400 22px 'Source Serif 4', Georgia, serif";
  c.textBaseline = "middle";
  c.textAlign = "left";
  c.fillStyle = INK;
  c.fillText("you", you.x + 36, you.y + 1);

  avatar(me.x, me.y, 28, "#E8EEE5", "#A9B8B0", "agent");
  c.textAlign = "center";
  c.fillStyle = INK;
  c.fillText("your agent", me.x, me.y + 58);

  targets.forEach((q, i) => {
    const on = i === hit && ph > 4.6;
    avatar(q.x, q.y, 28, on ? "#DCEAF2" : "#E8EEE5", on ? "#8DB7CE" : "#A9B8B0", `agent-${q.n}`);
    if (on) ring(q.x, q.y, 32, BLUE, 2.5);
    const bx = q.x + 22, by = q.y + 22;
    c.fillStyle = BG;
    c.beginPath();
    c.roundRect(bx - 14, by - 14, 28, 28, 7);
    c.fill();
    avatar(bx, by, 12, "#E8EEE5", "#A9B8B0", q.n);
    c.fillStyle = on ? INK : MUTE;
    c.font = "400 17px 'Source Serif 4', Georgia, serif";
    c.fillText(`${q.n}’s agent`, q.x + 110, q.y + 1);
  });
}

/**
 * "How it works" animation: your agent fans out to other people's agents,
 * one negotiation succeeds, and the match travels back to you.
 */
export default function FanCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;

    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    cv.width = W * dpr;
    cv.height = H * dpr;
    const imgs = loadImages();
    const t0 = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      drawFan(ctx, (now - t0) / TIME_SCALE_MS, dpr, imgs);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      className="home-fan"
      role="img"
      aria-label="Your agent negotiating with six other people's agents in parallel; one match comes back to you."
    />
  );
}
