import { useEffect, useMemo, useRef, useState } from "react";
import { layoutNextLineRange, materializeLineRange, prepareWithSegments, type LayoutCursor, type PreparedTextWithSegments } from "@chenglou/pretext";

const PARAGRAPHS = [
  "For as long as the internet’s been around, we’ve used apps to find people. It worked until it didn’t. So we took discovery out of the feeds and made it multiplayer across humans and their agents.",
  "On the individual level, it's simple: state a purpose, and the network rearranges to meet it. Posting and waiting give way to ambient optimism - or, trusting that the right opportunities will find you.",
];

/** Must match `.site-prose` in site.css. */
const FONT = "300 15px 'Public Sans'";
const LINE_HEIGHT = 25.5;
const PARAGRAPH_GAP = 22;
/** Space between the headline and the body. Matches the flex gap below. */
const HEAD_GAP = 24;

const ART_SRC = "/site/discovery-drawing.png";
const ART_RATIO = 739 / 1400;
/** Pixels kept between a line's end and the dense pencil. The visible stroke sits a little left of that edge. */
const CLEARANCE = 40;
/** Gap kept between the headline and the drawing. The arch's faint edge sits left of the dense pencil. */
const HEAD_CLEARANCE = 56;
/** A line this narrow is crowded; that drawing scale is rejected. */
const MIN_LINE = 300;
/** Below this column width the drawing stacks under the text instead. */
const FLOW_MIN_WIDTH = 640;
/** Rows sampled from the drawing's alpha to find its left edge. */
const PROFILE_ROWS = 160;
/** Alpha (0 to 255) that counts as ink. High enough that the faint grid lines don't block text, so it follows the dense pencil. */
const INK_ALPHA = 140;

/**
 * For each sampled row of the drawing, how far in from its left edge the ink
 * starts, as a fraction of its width (1 means the row is empty).
 */
function readProfile(img: HTMLImageElement): Float32Array {
  const w = 320;
  const h = PROFILE_ROWS;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const profile = new Float32Array(h).fill(1);
  if (!ctx) return profile;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > INK_ALPHA) {
        profile[y] = x / w;
        break;
      }
    }
  }
  return profile;
}

type Flow = { lines: string[][]; artShare: number; artTop: number };
type Head = { w: number; h: number };

/** Width left of the ink at `top`. Null when a body line would be crowded. */
function lineWidthAt(
  profile: Float32Array,
  width: number,
  artShare: number,
  top: number,
  sample: number,
  min: number,
  artTop: number,
): number | null {
  const artW = width * artShare;
  const artH = artW * ART_RATIO;
  const local = top - artTop;
  if (local + sample <= 0 || local >= artH + 36) return width;
  const from = Math.max(0, Math.floor((Math.max(0, local) / artH) * PROFILE_ROWS));
  const to = Math.min(PROFILE_ROWS - 1, Math.ceil(((local + sample) / artH) * PROFILE_ROWS));
  let edge = 1;
  for (let r = from; r <= to; r++) edge = Math.min(edge, profile[r]);
  if (edge >= 1) return Math.max(min, width - artW - CLEARANCE);
  const natural = width - artW + edge * artW - CLEARANCE;
  return natural >= min ? natural : null;
}

function layoutAt(
  prepared: PreparedTextWithSegments[],
  profile: Float32Array,
  width: number,
  artShare: number,
  origin: number,
  artTop: number,
): { lines: string[][]; bottom: number; artH: number } | null {
  const artH = width * artShare * ART_RATIO;
  const out: string[][] = [];
  let y = origin;
  for (const p of prepared) {
    const lines: string[] = [];
    let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
    for (;;) {
      const lineWidth = lineWidthAt(profile, width, artShare, y, LINE_HEIGHT, MIN_LINE, artTop);
      if (lineWidth === null) return null;
      const range = layoutNextLineRange(p, cursor, lineWidth);
      if (range === null) break;
      lines.push(materializeLineRange(p, range).text);
      cursor = range.end;
      y += LINE_HEIGHT;
    }
    out.push(lines);
    y += PARAGRAPH_GAP;
  }
  return { lines: out, bottom: y - PARAGRAPH_GAP, artH };
}

/**
 * Largest drawing whose vertical center lines up with the body, not the title.
 * Body lines follow the ink; a line clear of the drawing runs the full column.
 */
function flowLines(
  prepared: PreparedTextWithSegments[],
  profile: Float32Array,
  width: number,
  head: Head,
): Flow | null {
  if (head.h <= 0 || head.w <= 0) return null;
  const origin = head.h + HEAD_GAP;
  let best: Flow | null = null;
  for (let i = 0; i <= 24; i++) {
    const artShare = 0.4 + (0.24 * i) / 24;
    const headRoom = lineWidthAt(profile, width, artShare, 0, head.h, 0, 0);
    if (headRoom === null || headRoom < head.w + HEAD_CLEARANCE) continue;
    const probe = layoutAt(prepared, profile, width, artShare, origin, origin);
    if (!probe) continue;
    const artTop = Math.max(head.h, origin + (probe.bottom - origin - probe.artH) / 2);
    const laid = layoutAt(prepared, profile, width, artShare, origin, artTop);
    if (!laid) continue;
    best = { lines: laid.lines, artShare, artTop };
  }
  return best;
}

/**
 * "We took discovery out of the feeds" body: the paragraphs wrap around the
 * hand drawing's silhouette (measured with pretext). Narrow screens, and the
 * moment before fonts load, get the plain stacked layout.
 */
export default function FeedsFlow() {
  const box = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const [width, setWidth] = useState(0);
  const [head, setHead] = useState<Head>({ w: 0, h: 0 });
  const [prepared, setPrepared] = useState<PreparedTextWithSegments[] | null>(null);
  const [profile, setProfile] = useState<Float32Array | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
      const heading = headRef.current;
      if (!heading) return;
      const range = document.createRange();
      range.selectNodeContents(heading);
      setHead({ w: range.getBoundingClientRect().width, h: heading.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let live = true;
    document.fonts
      .load(FONT)
      .catch(() => undefined)
      .then(() => {
        if (live) setPrepared(PARAGRAPHS.map((text) => prepareWithSegments(text, FONT)));
      });
    const img = new Image();
    img.onload = () => live && setProfile(readProfile(img));
    img.src = ART_SRC;
    return () => {
      live = false;
    };
  }, []);

  const flow = useMemo(
    () => (prepared && profile && width >= FLOW_MIN_WIDTH ? flowLines(prepared, profile, width, head) : null),
    [prepared, profile, width, head],
  );

  return (
    <div
      ref={box}
      className={flow ? "home-flow" : "home-flow home-flow--stacked"}
      style={{ gap: HEAD_GAP, ...(flow ? { minHeight: flow.artTop + width * flow.artShare * ART_RATIO } : {}) }}
    >
      <h3 ref={headRef} className="site-h3">We took discovery out of the feeds</h3>
      <div className="site-prose home-flow-text">
        {PARAGRAPHS.map((text, i) => (
          <p key={i}>
            {flow
              ? flow.lines[i].map((line, j) => (
                  <span key={j} className="home-flow-line">{line}</span>
                ))
              : text}
          </p>
        ))}
      </div>
      <img
        className="home-flow-art"
        src={ART_SRC}
        alt="Pencil drawing: a grid and a dark wave arching over an open room, with a blue plant growing beneath it"
        width={1400}
        height={739}
        style={flow ? { width: `${flow.artShare * 100}%`, top: flow.artTop } : undefined}
      />
    </div>
  );
}
