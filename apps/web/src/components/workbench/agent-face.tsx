const PALETTE = ["#0B5FA5", "#2E8B7A", "#E8C84A", "#7B62B8", "#C9518B", "#F26B0F"];
const INK = "#111";
const PAPER = "#FAF8F3";
const UNIT = 160;

type Layer = {
  key: string;
  left: number;
  top: number;
  w: number;
  h: number;
  bg?: string;
  line?: boolean;
  round?: boolean;
  radius?: string;
  inner?: Layer[];
  innerRow?: boolean;
};

function faceRandom(seed: string) {
  let h = 2166136261 >>> 0;
  const s = String(seed || "index");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

function L(key: string, left: number, top: number, w: number, h: number, extra?: Partial<Layer>): Layer {
  return { key, left, top, w, h, ...extra };
}

const FACES: Array<{ bg: (c: string[]) => string; layers: (c: string[]) => Layer[] }> = [
  { bg: (c) => c[0], layers: (c) => [
    L("stem", 76, 10, 8, 22, { bg: INK }),
    L("cap", 66, 0, 28, 14, { bg: c[1], line: true }),
    L("eyeL", 24, 52, 36, 36, { bg: PAPER, line: true }),
    L("eyeR", 96, 52, 36, 36, { bg: PAPER, line: true }),
    L("pupL", 36, 64, 14, 14, { bg: INK }),
    L("pupR", 108, 64, 14, 14, { bg: INK }),
    L("mouth", 40, 112, 76, 14, { bg: INK }),
  ] },
  { bg: (c) => c[0], layers: (c) => [
    L("iris", 28, 28, 100, 100, { bg: c[1], line: true, round: true }),
    L("pupil", 60, 60, 36, 36, { bg: INK, round: true }),
    L("glint", 70, 70, 12, 12, { bg: PAPER, round: true }),
    L("nubL", 0, 74, 26, 12, { bg: INK }),
    L("nubR", 134, 74, 26, 12, { bg: INK }),
  ] },
  { bg: () => PAPER, layers: (c) => [
    L("band", 18, 20, 120, 14, { bg: c[1], line: true }),
    L("visor", 18, 44, 120, 44, { bg: c[0], line: true, innerRow: true, inner: [L("vL", 0, 0, 20, 20, { bg: INK }), L("vR", 0, 0, 20, 20, { bg: INK })] }),
    L("legL", 40, 106, 22, 34, { bg: INK }),
    L("legR", 94, 106, 22, 34, { bg: INK }),
  ] },
  { bg: (c) => c[0], layers: () => [
    L("eye", 44, 26, 72, 72, { bg: PAPER, line: true, round: true }),
    L("pupil", 70, 52, 28, 28, { bg: INK, round: true }),
    ...[0, 1, 2, 3, 4].map((i) => L(`t${i}`, 30 + i * 24, 116, 16, 16, { bg: INK })),
  ] },
  { bg: () => PAPER, layers: (c) => [
    L("q1", 0, 0, 80, 80, { bg: c[0] }),
    L("q2", 80, 0, 80, 80, { bg: c[1] }),
    L("q3", 0, 80, 80, 80, { bg: c[2] }),
    L("q4", 80, 80, 80, 80, { bg: c[0] }),
    L("eyeS", 26, 30, 26, 26, { bg: INK }),
    L("eyeC", 106, 30, 26, 26, { bg: INK, round: true }),
    L("mouth", 26, 108, 108, 14, { bg: INK }),
  ] },
  { bg: () => PAPER, layers: (c) => [
    L("dome", 18, 34, 120, 120, { bg: c[0], line: true, radius: "60px 60px 0 0" }),
    L("eyeL", 44, 74, 24, 24, { bg: PAPER, line: true }),
    L("eyeR", 88, 74, 24, 24, { bg: PAPER, line: true }),
    L("mouth", 56, 120, 44, 10, { bg: c[1] }),
  ] },
  { bg: (c) => `linear-gradient(135deg, ${c[0]} 0 50%, ${c[1]} 50% 100%)`, layers: () => [
    L("eyeL", 26, 50, 30, 30, { bg: PAPER, line: true, round: true }),
    L("eyeR", 100, 50, 30, 30, { bg: PAPER, line: true, round: true }),
    L("mouth", 44, 108, 68, 20, { bg: PAPER, line: true }),
  ] },
  { bg: (c) => c[0], layers: (c) => [
    L("b1", 22, 22, 104, 16, { bg: c[1], line: true }),
    L("b2", 22, 48, 64, 16, { bg: PAPER, line: true }),
    L("b3", 22, 74, 88, 16, { bg: c[2], line: true }),
    L("b4", 22, 100, 44, 16, { bg: c[3], line: true }),
    L("dot", 120, 120, 24, 24, { bg: INK, round: true }),
  ] },
  { bg: (c) => c[0], layers: (c) => [
    L("o", 22, 22, 116, 116, { bg: PAPER, line: true }),
    L("m", 42, 42, 76, 76, { bg: c[1], line: true }),
    L("i", 63, 63, 34, 34, { bg: INK }),
  ] },
  { bg: () => PAPER, layers: (c) => {
    const cells = [c[0], null, null, c[0], null, INK, INK, null, c[1], null, null, c[1], null, c[2], c[2], null];
    return cells.flatMap((fill, i) => fill ? [L(`p${i}`, (i % 4) * 40, Math.floor(i / 4) * 40, 40, 40, { bg: fill })] : []);
  } },
];

function faceFor(seed: string) {
  const rnd = faceRandom(seed);
  const face = FACES[Math.floor(rnd() * FACES.length)] || FACES[0];
  const pool = PALETTE.slice();
  const colors: string[] = [];
  while (colors.length < 4 && pool.length) colors.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return { face, colors };
}

export function AgentFace({ seed, size = 22 }: { seed: string; size?: number }) {
  const { face, colors } = faceFor(seed);
  const scale = size / UNIT;
  return (
    <div title="agent" style={{ width: size, height: size, flex: "0 0 auto", boxSizing: "border-box", position: "relative", overflow: "hidden", border: `${size >= 40 ? 2 : 1}px solid ${INK}`, background: face.bg(colors) }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: UNIT, height: UNIT, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {face.layers(colors).map((layer) => (
          <div key={layer.key} style={{
            position: "absolute", boxSizing: "border-box",
            left: layer.left, top: layer.top, width: layer.w, height: layer.h,
            background: layer.bg,
            border: layer.line ? `2px solid ${INK}` : undefined,
            borderRadius: layer.round ? "50%" : layer.radius,
            display: layer.innerRow ? "flex" : undefined,
            alignItems: layer.innerRow ? "center" : undefined,
            justifyContent: layer.innerRow ? "space-around" : undefined,
          }}>
            {layer.inner?.map((inner) => (
              <div key={inner.key} style={{ width: inner.w, height: inner.h, background: inner.bg, flex: "0 0 auto" }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
