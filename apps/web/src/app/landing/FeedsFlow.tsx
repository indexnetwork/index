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

const ART_SRC = "/site/discovery-drawing.png";
const ART_RATIO = 739 / 1400;
/** Share of the column the drawing takes. */
const ART_SHARE = 0.48;
/** Space kept between a line's end and the nearest ink, as a share of the column. */
const CLEARANCE_SHARE = 0.1;
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

/**
 * Lays each paragraph out line by line, giving every line the width left of
 * the drawing's ink at that height, so the text follows the drawing's shape.
 */
function flowLines(
  prepared: PreparedTextWithSegments[],
  profile: Float32Array,
  width: number,
): string[][] {
  const artW = width * ART_SHARE;
  const artH = artW * ART_RATIO;
  const artX = width - artW;
  const clearance = width * CLEARANCE_SHARE;

  const lineWidthAt = (top: number) => {
    const from = Math.max(0, Math.floor((top / artH) * PROFILE_ROWS));
    const to = Math.min(PROFILE_ROWS - 1, Math.ceil(((top + LINE_HEIGHT) / artH) * PROFILE_ROWS));
    let edge = 1;
    for (let r = from; r <= to; r++) edge = Math.min(edge, profile[r]);
    if (from > to || edge >= 1) return width;
    return Math.max(160, artX + edge * artW - clearance);
  };

  const out: string[][] = [];
  let y = 0;
  for (const p of prepared) {
    const lines: string[] = [];
    let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
    for (;;) {
      const range = layoutNextLineRange(p, cursor, lineWidthAt(y));
      if (range === null) break;
      lines.push(materializeLineRange(p, range).text);
      cursor = range.end;
      y += LINE_HEIGHT;
    }
    out.push(lines);
    y += PARAGRAPH_GAP;
  }
  return out;
}

/**
 * "We took discovery out of the feeds" body: the paragraphs wrap around the
 * hand drawing's silhouette (measured with pretext). Narrow screens, and the
 * moment before fonts load, get the plain stacked layout.
 */
export default function FeedsFlow() {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [prepared, setPrepared] = useState<PreparedTextWithSegments[] | null>(null);
  const [profile, setProfile] = useState<Float32Array | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
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

  const lines = useMemo(
    () => (prepared && profile && width >= FLOW_MIN_WIDTH ? flowLines(prepared, profile, width) : null),
    [prepared, profile, width],
  );

  return (
    <div
      ref={box}
      className={lines ? "home-flow" : "home-flow home-flow--stacked"}
      style={lines ? { minHeight: width * ART_SHARE * ART_RATIO } : undefined}
    >
      <div className="site-prose home-flow-text">
        {PARAGRAPHS.map((text, i) => (
          <p key={i}>
            {lines
              ? lines[i].map((line, j) => (
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
        style={lines ? { width: `${ART_SHARE * 100}%` } : undefined}
      />
    </div>
  );
}
