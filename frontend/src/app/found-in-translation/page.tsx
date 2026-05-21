'use client';
import { useEffect, useRef, useState } from 'react';
import Nav, { ensureLandingV5Fonts } from '@/app/landing-v5/Nav';
import Footer from '@/app/landing-v5/Footer';
import '@/app/landing-v5/landing-v5.css';
import { apiUrl } from '@/lib/api';

// ── Found in Translation -1: Superstudio / Continuous Monument ──
// Inspired by Superstudio's 1969 Continuous Monument: a white megastructure
// with a grid, superimposed over any landscape. Architecture as protocol.
// The monument doesn't end. The grid continues. Intent travels the surface.

const KF = `
  @keyframes ticker {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
  }
  @keyframes blinkHard {
    0%,49%  { opacity: 1; }
    50%,100% { opacity: 0; }
  }
  @keyframes marchRight {
    from { background-position: 0 0; }
    to   { background-position: 60px 0; }
  }
`;

const SANS = "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const PALETTE = {
  bg: '#0b1612',
  cream: '#ece3cf',
  creamSoft: 'rgba(236, 227, 207, 0.78)',
  creamFaint: 'rgba(236, 227, 207, 0.5)',
  rule: 'rgba(236, 227, 207, 0.22)',
  ruleStrong: 'rgba(236, 227, 207, 0.45)',
};

function useScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const h = () => {
      const d = document.documentElement;
      setP(d.scrollTop / (d.scrollHeight - d.clientHeight) || 0);
    };
    addEventListener('scroll', h, { passive: true });
    return () => removeEventListener('scroll', h);
  }, []);
  return p;
}

function useFadeIn(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!ref.current) return;
    const els = ref.current.querySelectorAll<HTMLElement>('[data-fade]');
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target as HTMLElement;
          el.style.transitionDelay = `${el.dataset.delay ?? 0}ms`;
          el.style.opacity = '1';
          el.style.transform = 'none';
        }),
      { threshold: 0.05 },
    );
    els.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
      el.style.transition = 'opacity .6s ease, transform .6s ease';
      io.observe(el);
    });
    return () => io.disconnect();
  }, [ref]);
}

// ── PROTOCOL CORRIDOR CANVAS ────────────────────────────────────────
// Original artwork inspired by Superstudio's Continuous Monument.
// Two massive gridded slab-walls converge to a vanishing point, framing
// a corridor that represents the protocol connecting human intent.
// The "ground" below is a network landscape of nodes and connections.
function ProtocolCorridorCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let raf: number;
    let tick = 0;

    const resize = () => { cv.width = innerWidth; cv.height = innerHeight; };
    resize(); addEventListener('resize', resize);

    // Bilinear quad grid: clips to a quadrilateral, then draws N×M perspective-correct lines
    const quadGrid = (
      bl: [number, number], br: [number, number],
      tr: [number, number], tl: [number, number],
      nx: number, ny: number, col: string, lw: number
    ) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(bl[0], bl[1]); ctx.lineTo(br[0], br[1]);
      ctx.lineTo(tr[0], tr[1]); ctx.lineTo(tl[0], tl[1]);
      ctx.closePath(); ctx.clip();
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      for (let i = 0; i <= nx; i++) {
        const s = i / nx;
        ctx.beginPath();
        ctx.moveTo(bl[0] + (br[0] - bl[0]) * s, bl[1] + (br[1] - bl[1]) * s);
        ctx.lineTo(tl[0] + (tr[0] - tl[0]) * s, tl[1] + (tr[1] - tl[1]) * s);
        ctx.stroke();
      }
      for (let i = 0; i <= ny; i++) {
        const s = i / ny;
        ctx.beginPath();
        ctx.moveTo(bl[0] + (tl[0] - bl[0]) * s, bl[1] + (tl[1] - bl[1]) * s);
        ctx.lineTo(br[0] + (tr[0] - br[0]) * s, br[1] + (tr[1] - br[1]) * s);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawFig = (x: number, y: number, h: number) => {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = Math.max(0.7, h * 0.05);
      ctx.beginPath(); ctx.arc(x, y - h + h * 0.1, h * 0.09, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y - h + h * 0.2); ctx.lineTo(x, y - h * 0.38); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - h * 0.11, y - h * 0.68); ctx.lineTo(x + h * 0.11, y - h * 0.68); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - h * 0.38); ctx.lineTo(x - h * 0.08, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - h * 0.38); ctx.lineTo(x + h * 0.08, y); ctx.stroke();
    };

    const draw = () => {
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);

      const cx = W * 0.5;
      const vy = H * 0.44;
      const sT = H * 0.69;

      const skyG = ctx.createLinearGradient(0, 0, 0, vy);
      skyG.addColorStop(0, '#7c7a78');
      skyG.addColorStop(0.5, '#a8a6a2');
      skyG.addColorStop(1, '#cdcbc7');
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, vy);

      const gG = ctx.createLinearGradient(0, vy, 0, H);
      gG.addColorStop(0, '#c2c0bc');
      gG.addColorStop(1, '#686462');
      ctx.fillStyle = gG; ctx.fillRect(0, vy, W, H - vy);

      ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.5;
      const rawT = ((tick * 0.006) % 1);
      for (let i = 0; i <= 22; i++) {
        const bx = W * (-0.3 + i * 1.6 / 22);
        ctx.beginPath(); ctx.moveTo(cx, vy); ctx.lineTo(bx, H); ctx.stroke();
      }
      for (let i = 0; i < 14; i++) {
        const p = Math.pow(((i / 14) + rawT) % 1, 2.0);
        const y = vy + (H - vy) * p;
        if (y > vy && y < H) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      }

      for (let row = 1; row < 10; row++) {
        for (let col = 0; col < 22; col++) {
          const p = Math.pow(row / 10, 1.8);
          const y = vy + (H - vy) * p + 4;
          const x = cx + (col / 22 - 0.5) * W * (0.28 + p * 0.9);
          if (x < 2 || x > W - 2 || y > H - 4) continue;
          const r = 0.8 + p * 1.6;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0,0,0,${0.1 + p * 0.18})`; ctx.fill();
        }
      }

      const lBl: [number, number] = [-W * 0.08, H];
      const lBr: [number, number] = [W * 0.38, H];
      const lTr: [number, number] = [cx, vy];
      const lTl: [number, number] = [-W * 0.42, vy * 0.28];

      ctx.beginPath();
      ctx.moveTo(lTl[0], lTl[1]); ctx.lineTo(lTr[0], lTr[1]);
      ctx.lineTo(W * 0.38, sT); ctx.lineTo(-W * 0.08, sT);
      ctx.closePath();
      const lTopG = ctx.createLinearGradient(cx, vy, W * 0.38, sT);
      lTopG.addColorStop(0, '#b6cada'); lTopG.addColorStop(1, '#d0e0ec');
      ctx.fillStyle = lTopG; ctx.fill();
      quadGrid(
        [-W * 0.08, sT], [W * 0.38, sT],
        lTr, lTl,
        24, 20, 'rgba(0,0,0,0.07)', 0.5
      );

      ctx.beginPath();
      ctx.moveTo(W * 0.38, H); ctx.lineTo(W * 0.38, sT); ctx.lineTo(cx, vy);
      ctx.closePath();
      const lFaceG = ctx.createLinearGradient(W * 0.38, sT, cx, vy);
      lFaceG.addColorStop(0, '#2e3e4a'); lFaceG.addColorStop(1, '#6a7c88');
      ctx.fillStyle = lFaceG; ctx.fill();
      quadGrid(
        [W * 0.38, H], [cx, vy],
        [cx, vy], [W * 0.38, sT],
        16, 14, 'rgba(255,255,255,0.055)', 0.5
      );

      const rBl: [number, number] = [W * 0.62, H];
      const rBr: [number, number] = [W * 1.08, H];
      const rTr: [number, number] = [W * 1.42, vy * 0.28];
      const rTl: [number, number] = [cx, vy];

      ctx.beginPath();
      ctx.moveTo(rTl[0], rTl[1]); ctx.lineTo(rTr[0], rTr[1]);
      ctx.lineTo(W * 1.08, sT); ctx.lineTo(W * 0.62, sT);
      ctx.closePath();
      const rTopG = ctx.createLinearGradient(cx, vy, W * 0.62, sT);
      rTopG.addColorStop(0, '#b6cada'); rTopG.addColorStop(1, '#ccdde9');
      ctx.fillStyle = rTopG; ctx.fill();
      quadGrid(
        [W * 0.62, sT], [W * 1.08, sT],
        rTr, rTl,
        24, 20, 'rgba(0,0,0,0.07)', 0.5
      );

      ctx.beginPath();
      ctx.moveTo(W * 0.62, H); ctx.lineTo(W * 0.62, sT); ctx.lineTo(cx, vy);
      ctx.closePath();
      const rFaceG = ctx.createLinearGradient(W * 0.62, sT, cx, vy);
      rFaceG.addColorStop(0, '#2e3e4a'); rFaceG.addColorStop(1, '#6a7c88');
      ctx.fillStyle = rFaceG; ctx.fill();
      quadGrid(
        [W * 0.62, H], [cx, vy],
        [cx, vy], [W * 0.62, sT],
        16, 14, 'rgba(255,255,255,0.055)', 0.5
      );

      const fH = H * 0.055;
      drawFig(W * 0.38 - fH * 0.25, H, fH);
      drawFig(W * 0.38 - fH * 0.8, H, fH * 0.82);
      drawFig(W * 0.62 + fH * 0.25, H, fH);
      drawFig(W * 0.62 + fH * 0.8, H, fH * 0.82);

      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = `${Math.max(8, W * 0.006)}px "IBM Plex Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('PROTOCOL · INDEX NETWORK', cx, vy - 8);

      tick++;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />;
}

// ── THE MONUMENT CANVAS (original, kept as fallback) ─────────────────
function MonumentCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let raf: number;
    let offset = 0;

    const resize = () => { cv.width = innerWidth; cv.height = innerHeight; };
    resize(); addEventListener('resize', resize);

    const drawFigure = (x: number, baseY: number, h: number) => {
      ctx.fillStyle = '#000';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(0.8, h * 0.06);
      ctx.beginPath();
      ctx.arc(x, baseY - h + h * 0.11, h * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, baseY - h + h * 0.2);
      ctx.lineTo(x, baseY - h * 0.38);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - h * 0.12, baseY - h * 0.68);
      ctx.lineTo(x + h * 0.12, baseY - h * 0.68);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, baseY - h * 0.38);
      ctx.lineTo(x - h * 0.09, baseY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, baseY - h * 0.38);
      ctx.lineTo(x + h * 0.09, baseY);
      ctx.stroke();
    };

    const draw = () => {
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);

      const horizY = H * 0.46;
      const vx = W * 0.5;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, horizY);
      ctx.clip();
      const gSz = Math.max(40, W / 22);
      const mOff = (offset * 0.08) % gSz;
      ctx.strokeStyle = 'rgba(0,0,0,0.11)';
      ctx.lineWidth = 0.6;
      for (let x = -gSz + mOff; x < W + gSz; x += gSz) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, horizY); ctx.stroke();
      }
      for (let y = gSz * 0.5; y < horizY; y += gSz) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.restore();

      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, horizY); ctx.lineTo(W, horizY); ctx.stroke();

      const numRays = 32;
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.7;
      for (let i = 0; i <= numRays; i++) {
        const t = i / numRays;
        const bx = -W * 0.3 + t * W * 1.6;
        ctx.beginPath(); ctx.moveTo(vx, horizY); ctx.lineTo(bx, H); ctx.stroke();
      }

      const numH = 20;
      ctx.strokeStyle = 'rgba(0,0,0,0.11)';
      ctx.lineWidth = 0.5;
      const rawT = (offset * 0.006) % 1;
      for (let i = 0; i < numH; i++) {
        const t = Math.pow(((i / numH) + rawT) % 1, 2.2);
        const y = horizY + (H - horizY) * t;
        if (y > horizY && y < H) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
      }

      const figH = H * 0.055;
      const figs = [0.14, 0.32, 0.5, 0.68, 0.86];
      figs.forEach((fx) => {
        drawFigure(W * fx, horizY, figH);
      });

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.font = `${Math.max(9, W * 0.007)}px "IBM Plex Mono", monospace`;
      ctx.letterSpacing = '0.15em';
      ctx.textAlign = 'left';
      ctx.fillText('N 43°41′ E 11°15′  ·  EL. 0.00 m', 16, H - 14);
      ctx.textAlign = 'right';
      ctx.fillText('CONTINUOUS MONUMENT · INDEX NETWORK PROTOCOL', W - 16, H - 14);
      ctx.letterSpacing = '0em';

      ctx.textAlign = 'right';
      ctx.font = `${Math.max(9, W * 0.0065)}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillText('ELEVATION 1:5000', W - 16, 20);

      offset += 0.35;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />;
}

// ── ARCH CALLOUT ────────────────────────────────────────────────
function ArchCallout({ children }: { children: React.ReactNode }) {
  return (
    <div data-fade style={{ margin: '4rem 0', border: `1px solid ${PALETTE.ruleStrong}`, padding: '3rem 3.5rem', background: 'transparent', color: PALETTE.cream, position: 'relative' }}>
      <p style={{ fontFamily: SANS, fontWeight: 700, fontSize: 'clamp(1.4rem,3.5vw,2.6rem)', lineHeight: 1.1, letterSpacing: '-0.02em', margin: 0 }}>{children}</p>
      {[{ top: 8, left: 8 }, { top: 8, right: 8 }, { bottom: 8, left: 8 }, { bottom: 8, right: 8 }].map((pos, i) => (
        <div key={i} style={{ position: 'absolute', width: 12, height: 12, border: `1px solid ${PALETTE.creamFaint}`, ...pos }} />
      ))}
    </div>
  );
}

// ── FIG 01: THE CONVERSATION ────────────────────────────────────
// Architectural elevation of two humans with intent lattice between them
function ConversationFig() {
  return (
    <figure data-fade style={{ margin: '3rem 0', border: '1px solid rgba(236, 227, 207, 0.22)', position: 'relative', background: '#fff', overflow: 'hidden' }}>
      <svg viewBox="0 0 960 340" width="100%" style={{ display: 'block' }} aria-label="Fig. 01 — Two humans. Intent: latent.">
        {[{ x: 8, y: 8, r: true, b: false }, { x: 952, y: 8, r: false, b: false }, { x: 8, y: 332, r: true, b: true }, { x: 952, y: 332, r: false, b: true }].map(({ x, y, r, b }, i) => (
          <g key={i}>
            <line x1={x} y1={b ? y - 12 : y + 12} x2={x} y2={b ? y - 22 : y + 22} stroke="black" strokeWidth="1" opacity="0.4" />
            <line x1={r ? x + 12 : x - 12} y1={y} x2={r ? x + 22 : x - 22} y2={y} stroke="black" strokeWidth="1" opacity="0.4" />
          </g>
        ))}

        <circle cx="165" cy="90" r="26" fill="white" stroke="black" strokeWidth="1.5" />
        <line x1="165" y1="116" x2="165" y2="130" stroke="black" strokeWidth="1.5" />
        <rect x="148" y="130" width="34" height="62" fill="white" stroke="black" strokeWidth="1.5" />
        <line x1="182" y1="142" x2="236" y2="158" stroke="black" strokeWidth="1.5" />
        <line x1="148" y1="142" x2="118" y2="168" stroke="black" strokeWidth="1.5" />
        <line x1="158" y1="192" x2="144" y2="248" stroke="black" strokeWidth="1.5" />
        <line x1="172" y1="192" x2="186" y2="248" stroke="black" strokeWidth="1.5" />
        <text x="165" y="272" textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="11" letterSpacing="2" fill="black">HUMAN A</text>

        <circle cx="795" cy="90" r="26" fill="white" stroke="black" strokeWidth="1.5" />
        <line x1="795" y1="116" x2="795" y2="130" stroke="black" strokeWidth="1.5" />
        <rect x="778" y="130" width="34" height="62" fill="white" stroke="black" strokeWidth="1.5" />
        <line x1="778" y1="142" x2="724" y2="158" stroke="black" strokeWidth="1.5" />
        <line x1="812" y1="142" x2="842" y2="168" stroke="black" strokeWidth="1.5" />
        <line x1="788" y1="192" x2="774" y2="248" stroke="black" strokeWidth="1.5" />
        <line x1="802" y1="192" x2="816" y2="248" stroke="black" strokeWidth="1.5" />
        <text x="795" y="272" textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="11" letterSpacing="2" fill="black">HUMAN B</text>

        <rect x="350" y="58" width="260" height="162" fill="white" stroke="black" strokeWidth="2" />
        {[26, 52, 78, 104, 130, 156, 182, 208, 234].map((dx) => (
          <line key={dx} x1={350 + dx} y1="58" x2={350 + dx} y2="220" stroke="black" strokeWidth="0.5" opacity="0.4" />
        ))}
        {[18, 36, 54, 72, 90, 108, 126, 144].map((dy) => (
          <line key={dy} x1="350" y1={58 + dy} x2="610" y2={58 + dy} stroke="black" strokeWidth="0.5" opacity="0.4" />
        ))}
        <line x1="480" y1="58" x2="480" y2="220" stroke="black" strokeWidth="1" opacity="0.2" />
        <line x1="350" y1="139" x2="610" y2="139" stroke="black" strokeWidth="1" opacity="0.2" />
        {[[350, 58], [610, 58], [350, 220], [610, 220]].map(([px, py], i) => (
          <g key={i}>
            <line x1={px - 8} y1={py} x2={px - 14} y2={py} stroke="black" strokeWidth="1.5" />
            <line x1={px} y1={py - 8} x2={px} y2={py - 14} stroke="black" strokeWidth="1.5" />
          </g>
        ))}
        <text x="480" y="244" textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="9" letterSpacing="2" fill="black" opacity="0.6">INTENT: UNEXPRESSED</text>

        <line x1="191" y1="100" x2="350" y2="130" stroke="black" strokeWidth="0.8" strokeDasharray="6,5" opacity="0.5" />
        <line x1="769" y1="100" x2="610" y2="130" stroke="black" strokeWidth="0.8" strokeDasharray="6,5" opacity="0.5" />

        <line x1="165" y1="300" x2="795" y2="300" stroke="black" strokeWidth="0.8" />
        <polygon points="165,297 165,303 153,300" fill="black" />
        <polygon points="795,297 795,303 807,300" fill="black" />
        <line x1="165" y1="293" x2="165" y2="307" stroke="black" strokeWidth="0.8" />
        <line x1="795" y1="293" x2="795" y2="307" stroke="black" strokeWidth="0.8" />
        <text x="480" y="318" textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="9" letterSpacing="3" fill="black" opacity="0.6">DISTANCE: UNDEFINED · SIGNAL: LATENT</text>

        <line x1="0" y1="330" x2="960" y2="330" stroke="black" strokeWidth="0.5" opacity="0.25" />
        <text x="14" y="342" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="8" letterSpacing="1.8" fill="black" opacity="0.45">FIG. 01 — THE CONVERSATION · INTENT: LATENT · SYSTEM: NO MATCH</text>
      </svg>
    </figure>
  );
}

// ── FIG 02: FUTILITY OF SEARCH ──────────────────────────────────
// One figure facing an infinite perspective wall of identical search results
function SearchFrustrationFig() {
  const cards: { x: number; y: number; w: number; h: number }[] = [];
  const cols = 5;
  const rows = 4;
  for (let c = 0; c < cols; c++) {
    const scale = 1 - c * 0.16;
    const cardW = 110 * scale;
    const cardH = 70 * scale;
    const startX = 300 + c * 130;
    const centerY = 155;
    for (let r = 0; r < rows; r++) {
      const totalH = rows * cardH + (rows - 1) * 10 * scale;
      const y = centerY - totalH / 2 + r * (cardH + 10 * scale);
      cards.push({ x: startX, y, w: cardW, h: cardH });
    }
  }

  return (
    <figure data-fade style={{ margin: '3rem 0', border: '1px solid rgba(236, 227, 207, 0.22)', background: '#fff', overflow: 'hidden' }}>
      <svg viewBox="0 0 980 320" width="100%" style={{ display: 'block' }} aria-label="Fig. 02 — The futility of search.">
        {[{ x: 8, y: 8 }, { x: 972, y: 8 }, { x: 8, y: 312 }, { x: 972, y: 312 }].map(({ x, y }, i) => (
          <g key={i}>
            <line x1={x} y1={y + 8} x2={x} y2={y + 16} stroke="black" strokeWidth="0.8" opacity="0.35" />
            <line x1={x + (i % 2 === 0 ? 8 : -8)} y1={y} x2={x + (i % 2 === 0 ? 16 : -16)} y2={y} stroke="black" strokeWidth="0.8" opacity="0.35" />
          </g>
        ))}

        <circle cx="140" cy="108" r="24" fill="white" stroke="black" strokeWidth="1.5" />
        <line x1="140" y1="132" x2="140" y2="146" stroke="black" strokeWidth="1.5" />
        <rect x="124" y="146" width="32" height="55" fill="white" stroke="black" strokeWidth="1.5" />
        <line x1="156" y1="158" x2="230" y2="158" stroke="black" strokeWidth="1.5" />
        <line x1="124" y1="158" x2="96" y2="178" stroke="black" strokeWidth="1.5" />
        <line x1="133" y1="201" x2="122" y2="250" stroke="black" strokeWidth="1.5" />
        <line x1="147" y1="201" x2="158" y2="250" stroke="black" strokeWidth="1.5" />
        <text x="140" y="270" textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="10" letterSpacing="2" fill="black">YOU</text>

        <line x1="235" y1="155" x2="295" y2="155" stroke="black" strokeWidth="1" strokeDasharray="5,4" opacity="0.5" />
        <polygon points="295,152 295,158 303,155" fill="black" opacity="0.5" />

        {cards.map((c, i) => (
          <g key={i}>
            <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="#f8f8f8" stroke="black" strokeWidth="0.7" />
            <rect x={c.x + c.w * 0.1} y={c.y + c.h * 0.2} width={c.w * 0.8} height={c.h * 0.12} fill="rgba(0,0,0,0.15)" />
            <rect x={c.x + c.w * 0.1} y={c.y + c.h * 0.42} width={c.w * 0.65} height={c.h * 0.1} fill="rgba(0,0,0,0.08)" />
            <rect x={c.x + c.w * 0.1} y={c.y + c.h * 0.62} width={c.w * 0.5} height={c.h * 0.1} fill="rgba(0,0,0,0.06)" />
          </g>
        ))}

        <circle cx="940" cy="155" r="4" fill="black" opacity="0.2" />
        <line x1="300" y1="65" x2="940" y2="155" stroke="black" strokeWidth="0.4" opacity="0.12" strokeDasharray="4,4" />
        <line x1="300" y1="250" x2="940" y2="155" stroke="black" strokeWidth="0.4" opacity="0.12" strokeDasharray="4,4" />

        <text x="935" y="132" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="28" fill="black" opacity="0.25" textAnchor="middle">∞</text>

        <line x1="300" y1="292" x2="920" y2="292" stroke="black" strokeWidth="0.7" />
        <polygon points="300,289 300,295 290,292" fill="black" />
        <polygon points="920,289 920,295 930,292" fill="black" />
        <text x="610" y="308" textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="9" letterSpacing="2.5" fill="black" opacity="0.55">SEARCH RESULTS: n → ∞  ·  SIGNAL: 0</text>

        <line x1="0" y1="314" x2="980" y2="314" stroke="black" strokeWidth="0.5" opacity="0.2" />
        <text x="14" y="323" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="8" letterSpacing="1.8" fill="black" opacity="0.4">FIG. 02 — INFINITE SCROLL · IDENTICAL RESULTS · INTENT: UNMATCHED</text>
      </svg>
    </figure>
  );
}

// ── THE MONUMENT ELEVATION ──────────────────────────────────────
// Full-bleed SVG: the Continuous Monument face-on in architectural elevation.
// A white slab with grid, extending infinitely left and right.
// Tiny scale figures at the base. Architectural dimension notation.
function MonumentElevation({ label }: { label: string }) {
  const gridStep = 40;
  const W = 1800, H = 320;
  const monTop = 30;
  const groundY = 255;
  const figH = 38;

  const vLines: number[] = [];
  for (let x = gridStep; x < W; x += gridStep) vLines.push(x);
  const hLines: number[] = [];
  for (let y = monTop + gridStep; y < groundY; y += gridStep) hLines.push(y);

  const figXs = [120, 320, 580, 900, 1220, 1480, 1700];

  return (
    <div data-fade style={{ margin: '4rem -2rem', borderTop: `1px solid ${PALETTE.rule}`, borderBottom: `1px solid ${PALETTE.rule}`, overflow: 'hidden', background: '#fff', position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} aria-label={label}>
        <rect x="0" y={monTop} width={W} height={groundY - monTop} fill="white" stroke="none" />

        {vLines.map((x) => (
          <line key={x} x1={x} y1={monTop} x2={x} y2={groundY} stroke="black" strokeWidth="0.5" opacity="0.15" />
        ))}
        {hLines.map((y) => (
          <line key={y} x1={0} y1={y} x2={W} y2={y} stroke="black" strokeWidth="0.5" opacity="0.15" />
        ))}

        <line x1="0" y1={monTop} x2={W} y2={monTop} stroke="black" strokeWidth="1.5" />
        <line x1="0" y1={groundY} x2={W} y2={groundY} stroke="black" strokeWidth="2" />

        {Array.from({ length: 20 }, (_, i) => (
          <line
            key={i}
            x1={i * 120} y1={groundY + 2}
            x2={i * 120 + 80} y2={groundY + 24}
            stroke="black" strokeWidth="0.5" opacity="0.12"
          />
        ))}

        {figXs.map((fx, i) => (
          <g key={i}>
            <circle cx={fx} cy={groundY - figH + figH * 0.11} r={figH * 0.09} fill="black" />
            <line x1={fx} y1={groundY - figH + figH * 0.21} x2={fx} y2={groundY - figH * 0.36} stroke="black" strokeWidth="2" />
            <line x1={fx - figH * 0.12} y1={groundY - figH * 0.7} x2={fx + figH * 0.12} y2={groundY - figH * 0.7} stroke="black" strokeWidth="1.5" />
            <line x1={fx} y1={groundY - figH * 0.36} x2={fx - figH * 0.1} y2={groundY} stroke="black" strokeWidth="1.5" />
            <line x1={fx} y1={groundY - figH * 0.36} x2={fx + figH * 0.1} y2={groundY} stroke="black" strokeWidth="1.5" />
          </g>
        ))}

        <line x1="52" y1={monTop} x2="52" y2={groundY} stroke="black" strokeWidth="0.8" />
        <polygon points="52,30 49,42 55,42" fill="black" opacity="0.6" />
        <polygon points="52,255 49,243 55,243" fill="black" opacity="0.6" />
        <text x="38" y="145" textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="9" letterSpacing="1.5" fill="black" opacity="0.5" transform="rotate(-90 38 145)">HEIGHT: ∞</text>

        <text x={W / 2} y={monTop - 10} textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="8" letterSpacing="2" fill="black" opacity="0.35">← MONUMENT EXTENDS TO INFINITY →</text>

        <line x1="0" y1={monTop + 20} x2="0" y2={monTop + 20} stroke="black" strokeWidth="1" strokeDasharray="5,3" />

        <text x={W - 14} y={H - 10} textAnchor="end" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="9" letterSpacing="2" fill="black" opacity="0.4">{label}</text>

        <circle cx="14" cy={groundY - 40} r="10" fill="none" stroke="black" strokeWidth="1" opacity="0.3" />
        <line x1="0" y1={groundY - 40} x2="28" y2={groundY - 40} stroke="black" strokeWidth="0.7" opacity="0.3" />
        <line x1="14" y1={groundY - 54} x2="14" y2={groundY - 26} stroke="black" strokeWidth="0.7" opacity="0.3" />
        <circle cx={W - 14} cy={groundY - 40} r="10" fill="none" stroke="black" strokeWidth="1" opacity="0.3" />
        <line x1={W - 28} y1={groundY - 40} x2={W} y2={groundY - 40} stroke="black" strokeWidth="0.7" opacity="0.3" />
        <line x1={W - 14} y1={groundY - 54} x2={W - 14} y2={groundY - 26} stroke="black" strokeWidth="0.7" opacity="0.3" />
      </svg>
    </div>
  );
}

// ── FIG 03: CLI ERA ──────────────────────────────────────────────
function InterfaceEvolutionFig() {
  return (
    <figure data-fade style={{ margin: '2rem 0', border: '1px solid rgba(236, 227, 207, 0.22)', overflow: 'hidden' }}>
      <img src="/found-in-translation/CLI.png" alt="CLI era terminal" style={{ display: 'block', width: '100%', height: 'auto' }} />
    </figure>
  );
}

// ── FIG 04: GUI ERA ──────────────────────────────────────────────
function GuiEraFig() {
  return (
    <figure data-fade style={{ margin: '2rem 0', border: '1px solid rgba(236, 227, 207, 0.22)', overflow: 'hidden' }}>
      <img src="/found-in-translation/GUI.jpg" alt="GUI era interface" style={{ display: 'block', width: '100%', height: 'auto' }} />
    </figure>
  );
}

// ── FIG 05: BEFORE / AFTER ──────────────────────────────────────
function BeforeAfterFig() {
  return (
    <figure data-fade style={{ margin: '2rem 0', border: '1px solid rgba(236, 227, 207, 0.22)', background: '#f5f4f0', overflow: 'hidden' }}>
      <svg viewBox="0 0 800 260" width="100%" style={{ display: 'block' }} aria-label="Before and after: keyword search vs expressive intent">
        {/* backgrounds first */}
        <rect x="0" y="0" width="400" height="260" fill="#f5f4f0" />
        <rect x="400" y="0" width="400" height="260" fill="#f5f4f0" />

        {/* left content */}
        <text x="40" y="52" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="9" letterSpacing="2" fill="#aaa">BEFORE</text>
        {/* keyword tags */}
        <rect x="40" y="66" width="152" height="24" rx="12" fill="#fff" stroke="#ccc" strokeWidth="1.5" />
        <text x="116" y="82" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="10" fill="#999" textAnchor="middle">creative technologist</text>
        <rect x="200" y="66" width="140" height="24" rx="12" fill="#fff" stroke="#ccc" strokeWidth="1.5" />
        <text x="270" y="82" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="10" fill="#999" textAnchor="middle">software engineers</text>
        <rect x="40" y="98" width="50" height="24" rx="12" fill="#fff" stroke="#ccc" strokeWidth="1.5" />
        <text x="65" y="114" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="10" fill="#999" textAnchor="middle">nyc</text>
        <rect x="98" y="98" width="56" height="24" rx="12" fill="#fff" stroke="#ccc" strokeWidth="1.5" />
        <text x="126" y="114" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="10" fill="#999" textAnchor="middle">saas</text>

        {/* right content */}
        <text x="440" y="52" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="9" letterSpacing="2" fill="#aaa">NOW</text>
        <rect x="440" y="68" width="320" height="88" rx="3" fill="#fff" stroke="#ccc" strokeWidth="1.5" />
        <text x="456" y="89" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="11" fill="#555" fontStyle="italic">&quot;I&apos;m a 0-1 builder who likes to stay close</text>
        <text x="456" y="105" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="11" fill="#555" fontStyle="italic">to consumer culture — looking for a team</text>
        <text x="456" y="121" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="11" fill="#555" fontStyle="italic">working on something new and weird,</text>
        <text x="456" y="137" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="11" fill="#555" fontStyle="italic">probably pre-seed or seed.&quot;</text>

        {/* divider — drawn after content but before arrow */}
        <line x1="400" y1="0" x2="400" y2="260" stroke="#ccc" strokeWidth="1.5" />

        {/* arrow button — drawn last so it sits on top */}
        <circle cx="400" cy="112" r="22" fill="#000" />
        <line x1="389" y1="112" x2="407" y2="112" stroke="#fff" strokeWidth="2" />
        <polygon points="405,107 405,117 414,112" fill="#fff" />

        <text x="20" y="252" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="8" letterSpacing="1.8" fill="#000" opacity="0.2">FIG. 05 — INTENT EXPRESSION · KEYWORD → CONTEXT-RICH</text>
      </svg>
    </figure>
  );
}

// ── AGENT NETWORK PLAN ──────────────────────────────────────────
// Architectural PLAN VIEW (top-down) of the agent network.
// Looks like a floor plan where the "rooms" are network nodes.
function AgentNetworkPlan() {
  const nodes = [
    { id: 'YOU', x: 400, y: 230, r: 36, fill: '#000', label: '#fff', isYou: true },
    { id: 'AGENT', x: 220, y: 115, r: 22, fill: '#fff', label: '#000' },
    { id: 'PEER A', x: 400, y: 80, r: 20, fill: '#fff', label: '#000' },
    { id: 'PEER B', x: 580, y: 115, r: 22, fill: '#fff', label: '#000' },
    { id: 'BRIDGE', x: 640, y: 280, r: 20, fill: '#fff', label: '#000' },
    { id: 'MATCH', x: 580, y: 370, r: 26, fill: '#fff', label: '#000' },
    { id: 'COLLAB', x: 400, y: 400, r: 20, fill: '#fff', label: '#000' },
    { id: 'OPP.', x: 200, y: 360, r: 22, fill: '#fff', label: '#000' },
    { id: 'FRIEND', x: 160, y: 258, r: 18, fill: '#fff', label: '#000' },
  ];

  const connections = [
    [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8],
    [1, 8], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8],
  ];

  return (
    <figure data-fade style={{ margin: '3rem 0', border: '1px solid rgba(236, 227, 207, 0.22)', background: '#fff', overflow: 'hidden' }}>
      <svg viewBox="0 0 800 490" width="100%" style={{ display: 'block' }} aria-label="Agent network — plan view">
        {Array.from({ length: 26 }, (_, row) =>
          Array.from({ length: 17 }, (_, col) => (
            <circle key={`${row}-${col}`} cx={col * 50 + 25} cy={row * 30 + 15} r="1" fill="black" opacity="0.1" />
          ))
        )}

        {[{ x: 10, y: 10 }, { x: 790, y: 10 }, { x: 10, y: 480 }, { x: 790, y: 480 }].map(({ x, y }, i) => (
          <g key={i}>
            <line x1={x} y1={y + 8} x2={x} y2={y + 18} stroke="black" strokeWidth="0.8" opacity="0.3" />
            <line x1={x + (i % 2 === 0 ? 8 : -8)} y1={y} x2={x + (i % 2 === 0 ? 18 : -18)} y2={y} stroke="black" strokeWidth="0.8" opacity="0.3" />
          </g>
        ))}

        {connections.map(([a, b], i) => {
          const na = nodes[a], nb = nodes[b];
          const isDirect = a === 0;
          return (
            <line
              key={i}
              x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
              stroke="black"
              strokeWidth={isDirect ? 1.5 : 0.7}
              strokeDasharray={isDirect ? 'none' : '5,4'}
              opacity={isDirect ? 0.4 : 0.2}
            />
          );
        })}

        {nodes.map((n) => (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={n.r + 12} fill="none" stroke="black" strokeWidth="0.5" opacity="0.12" />
            <line x1={n.x - n.r - 8} y1={n.y} x2={n.x - n.r + 4} y2={n.y} stroke="black" strokeWidth="0.5" opacity="0.25" />
            <line x1={n.x + n.r - 4} y1={n.y} x2={n.x + n.r + 8} y2={n.y} stroke="black" strokeWidth="0.5" opacity="0.25" />
            <line x1={n.x} y1={n.y - n.r - 8} x2={n.x} y2={n.y - n.r + 4} stroke="black" strokeWidth="0.5" opacity="0.25" />
            <line x1={n.x} y1={n.y + n.r - 4} x2={n.x} y2={n.y + n.r + 8} stroke="black" strokeWidth="0.5" opacity="0.25" />
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.fill} stroke="black" strokeWidth={n.isYou ? 2.5 : 1.5} />
            <text
              x={n.x} y={n.y + (n.isYou ? 5 : 4)} textAnchor="middle"
              fontFamily="'JetBrains Mono', ui-monospace, monospace"
              fontSize={n.isYou ? 10 : 8}
              fontWeight={n.isYou ? 700 : 400}
              letterSpacing="1"
              fill={n.label}
            >
              {n.id}
            </text>
            {!n.isYou && (
              <text
                x={n.x + n.r + 14} y={n.y - n.r + 4}
                fontFamily="'JetBrains Mono', ui-monospace, monospace"
                fontSize="7"
                fill="black"
                opacity="0.35"
                letterSpacing="1"
              >
                {`(${n.x},${n.y})`}
              </text>
            )}
          </g>
        ))}

        <text x="400" y="472" textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="9" letterSpacing="2.5" fill="black" opacity="0.5">AGENT NETWORK — PLAN VIEW · SCALE 1:1000 · 9 NODES</text>
      </svg>
    </figure>
  );
}

// ── STRUCTURE CARD ──────────────────────────────────────────────
function StructureCard({ title, sub, body }: { title: string; sub: string; body: string }) {
  return (
    <div data-fade style={{ border: '1px solid rgba(236, 227, 207, 0.22)', padding: '2rem', background: '#fff', position: 'relative' }}>
      <div style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: '0.55rem', letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: '1rem', color: '#666' }}>{sub}</div>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 'clamp(1.6rem,3vw,2.2rem)', letterSpacing: '-0.02em', textTransform: 'uppercase', marginBottom: '1rem', color: '#000', lineHeight: 1 }}>{title}</div>
      <p style={{ fontFamily: SANS, fontSize: '0.85rem', lineHeight: 1.7, color: '#333', margin: 0 }}>{body}</p>
    </div>
  );
}

const FLOW = [
  { t: 'A human expresses intent', d: 'Raw, unfiltered — in their own language' },
  { t: 'Their agent encodes it', d: 'Context, nuance, and goals preserved' },
  { t: 'Agents discover overlapping intents', d: 'Scanning the network continuously, quietly' },
  { t: 'They negotiate compatibility', d: 'Silent, tireless, on your behalf' },
  { t: 'They disclose appropriately', d: 'Availability, context, relevant files — shared selectively' },
  { t: 'They consult memory and peers', d: 'Gossip, reputation, trust signals weighed' },
  { t: 'An opportunity becomes legible', d: 'Intent, context, trust, and timing finally align' },
  { t: 'Humans are invited in', d: 'The door opens at the right moment' },
  { t: 'Humans decide: go or no-go', d: 'The final say is always yours' },
  { t: 'If go, conversation initiated', d: 'A new connection begins' },
];

export default function FoundInTranslationPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const progress = useScrollProgress();
  useFadeIn(pageRef as React.RefObject<HTMLElement>);

  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);
  const [waitlistForm, setWaitlistForm] = useState({ name: '', email: '', whatYouDo: '', whoToMeet: '' });
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isWaitlistOpen && waitlistStatus !== 'loading') setIsWaitlistOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isWaitlistOpen, waitlistStatus]);

  useEffect(() => {
    const open = () => setIsWaitlistOpen(true);
    window.addEventListener('openWaitlistModal', open);
    return () => window.removeEventListener('openWaitlistModal', open);
  }, []);

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waitlistForm.email || !waitlistForm.name) return;
    setWaitlistStatus('loading');
    try {
      const res = await fetch(apiUrl('/api/subscribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: waitlistForm.email, type: 'waitlist', name: waitlistForm.name, whatYouDo: waitlistForm.whatYouDo, whoToMeet: waitlistForm.whoToMeet }),
      });
      setWaitlistStatus(res.ok ? 'success' : 'error');
    } catch {
      setWaitlistStatus('error');
    }
  };

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Found in Translation | Index Network';

    const setMeta = (name: string, content: string, attr = 'name') => {
      let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
      return el;
    };

    const description = 'Some things find you. Most don\'t. That is, until language became our new interface and agents became our calling cards.';
    const origin = window.location.origin;
    const url = `${origin}/found-in-translation`;
    const image = `${origin}/found-in-translation/found-in-translation-1-hero.png`;

    setMeta('description', description);
    setMeta('og:type', 'article', 'property');
    setMeta('og:title', 'Found in Translation | Index Network', 'property');
    setMeta('og:description', description, 'property');
    setMeta('og:url', url, 'property');
    setMeta('og:image', image, 'property');
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', 'Found in Translation | Index Network');
    setMeta('twitter:description', description);
    setMeta('twitter:image', image);

    return () => {
      document.title = prevTitle;
    };
  }, []);

  const P: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: 'max(18px, 1.2rem)', lineHeight: 1.5, color: PALETTE.creamSoft, marginBottom: '0.8rem',
  };
  const WRAP: React.CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '0 2rem' };

  useEffect(() => {
    ensureLandingV5Fonts();
  }, []);

  return (
    <div ref={pageRef} className="landing-v5" style={{ background: PALETTE.bg, color: PALETTE.cream, minHeight: '100vh', overflowX: 'hidden', fontFamily: SANS }}>
      <style>{KF}</style>

      {isWaitlistOpen && (
        <div
          className="lv5-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => waitlistStatus !== 'loading' && setIsWaitlistOpen(false)}
        >
          <div className="lv5-modal-backdrop" aria-hidden="true" />
          <div className="lv5-modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="lv5-modal-close"
              onClick={() => setIsWaitlistOpen(false)}
              disabled={waitlistStatus === 'loading'}
              aria-label="Close"
            >
              ×
            </button>
            {waitlistStatus === 'success' ? (
              <div className="lv5-modal-success">
                <h3 className="lv5-modal-title">you&apos;re on the list</h3>
                <p className="lv5-modal-lede">Check your inbox for your welcome email.</p>
                <button
                  type="button"
                  className="lv5-modal-submit"
                  onClick={() => { setIsWaitlistOpen(false); setWaitlistStatus('idle'); setWaitlistForm({ name: '', email: '', whatYouDo: '', whoToMeet: '' }); }}
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <h3 className="lv5-modal-title">join the waitlist</h3>
                <p className="lv5-modal-lede">
                  Tell us a bit about yourself — we&rsquo;ll let you know when we&rsquo;re live and keep you posted on updates.
                </p>
                <form onSubmit={handleWaitlistSubmit} className="lv5-modal-form">
                  <label className="lv5-modal-label" htmlFor="fit-waitlist-name">
                    Name<span className="lv5-modal-req">*</span>
                  </label>
                  <input
                    type="text"
                    id="fit-waitlist-name"
                    className="lv5-modal-input"
                    value={waitlistForm.name}
                    onChange={(e) => setWaitlistForm({ ...waitlistForm, name: e.target.value })}
                    required
                    disabled={waitlistStatus === 'loading'}
                  />

                  <label className="lv5-modal-label" htmlFor="fit-waitlist-email" style={{ marginTop: 10 }}>
                    Email<span className="lv5-modal-req">*</span>
                  </label>
                  <input
                    type="email"
                    id="fit-waitlist-email"
                    className="lv5-modal-input"
                    value={waitlistForm.email}
                    onChange={(e) => setWaitlistForm({ ...waitlistForm, email: e.target.value })}
                    required
                    disabled={waitlistStatus === 'loading'}
                  />

                  <label className="lv5-modal-label" htmlFor="fit-waitlist-whatYouDo" style={{ marginTop: 10 }}>
                    What do you do?
                  </label>
                  <input
                    type="text"
                    id="fit-waitlist-whatYouDo"
                    className="lv5-modal-input"
                    value={waitlistForm.whatYouDo}
                    onChange={(e) => setWaitlistForm({ ...waitlistForm, whatYouDo: e.target.value })}
                    disabled={waitlistStatus === 'loading'}
                  />

                  <label className="lv5-modal-label" htmlFor="fit-waitlist-whoToMeet" style={{ marginTop: 10 }}>
                    Who do you want to meet?
                  </label>
                  <textarea
                    id="fit-waitlist-whoToMeet"
                    className="lv5-modal-input"
                    style={{ resize: 'vertical', minHeight: 80 }}
                    value={waitlistForm.whoToMeet}
                    onChange={(e) => setWaitlistForm({ ...waitlistForm, whoToMeet: e.target.value })}
                    rows={3}
                    disabled={waitlistStatus === 'loading'}
                  />

                  {waitlistStatus === 'error' && (
                    <p className="lv5-modal-error">Something went wrong. Please try again.</p>
                  )}

                  <button
                    type="submit"
                    className="lv5-modal-submit"
                    disabled={waitlistStatus === 'loading'}
                  >
                    {waitlistStatus === 'loading' ? 'Submitting…' : 'Join the waitlist'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 100, background: PALETTE.rule }}>
        <div style={{ height: '100%', width: `${progress * 100}%`, background: PALETTE.cream, transition: 'width 0.1s linear' }} />
      </div>

      <section style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', borderBottom: `1px solid ${PALETTE.ruleStrong}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
          <Nav />
        </div>
        <img
          src="/found-in-translation/found-in-translation-1-hero.png"
          alt="Monumental grid-plane emerging across a city skyline at dusk"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', zIndex: 0 }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.1) 55%, transparent 100%)', zIndex: 1 }} />
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'none' }} preserveAspectRatio="none">
          {[0.25, 0.5, 0.75].map((t, i) => (
            <line key={i} x1="0" y1={`${t * 100}%`} x2="100%" y2={`${t * 100}%`} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          ))}
          {[0.2, 0.4, 0.6, 0.8].map((t, i) => (
            <line key={i} x1={`${t * 100}%`} y1="0" x2={`${t * 100}%`} y2="100%" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          ))}
          <g stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" fill="none">
            <line x1="16" y1="64" x2="48" y2="64" /><line x1="16" y1="64" x2="16" y2="96" />
            <line x1="calc(100% - 16)" y1="64" x2="calc(100% - 48)" y2="64" /><line x1="calc(100% - 16)" y1="64" x2="calc(100% - 16)" y2="96" />
          </g>
        </svg>



        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderTop: `1px solid ${PALETTE.rule}`, height: 36, background: 'rgba(11, 22, 18, 0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', padding: '0 1.5rem', gap: '2rem', zIndex: 5 }}>
          <span style={{ fontFamily: MONO, fontSize: '0.48rem', letterSpacing: '0.14em', color: PALETTE.creamFaint }}>NEW YORK 2026</span>
          <div style={{ flex: 1, height: 1, background: PALETTE.rule }} />
          <span style={{ fontFamily: MONO, fontSize: '0.48rem', letterSpacing: '0.14em', color: PALETTE.creamFaint }}>INDEX NETWORK · FOUND IN TRANSLATION</span>
        </div>
      </section>

      <div style={{ ...WRAP, padding: '4rem 2rem 1rem' }}>
        <p data-fade style={{ fontFamily: SANS, fontWeight: 700, fontSize: 'clamp(2.2rem,5vw,4.8rem)', lineHeight: 0.95, letterSpacing: '-0.04em', color: PALETTE.cream, marginBottom: '1.75rem' }}>
          Found in Translation
        </p>
        <p data-fade style={{ ...P, marginBottom: 0 }}>
          Some things find you. Most don&apos;t.
          <br />
          <br />
          They hide away in secret conversations with old coworkers on sunny patios, between rounds of margaritas that bring out what you want, what you really really want. A new job, a new <em>something</em> that&apos;ll take you somewhere you&apos;re actually excited to go.
        </p>
      </div>

      <div style={{ ...WRAP, padding: '0 2rem' }}>
        <figure data-fade style={{ margin: '2rem 0', border: '1px solid rgba(236, 227, 207, 0.22)', background: '#fff', overflow: 'hidden' }}>
          <img
            src="/found-in-translation/diagram1.jpeg"
            alt="Two people in conversation diagram"
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
        </figure>
      </div>

      <div style={{ ...WRAP, padding: '1rem 2rem 0' }}>
        <p data-fade style={P}>You might sleep on your vague desires, wake up, and start searching for someone who might just share your flavor of weird.</p>
        <p data-fade style={P}>You would think it gets easier—that technology was meant to help the stars align and show us the idea at the tip of our tongue, or deliver us the role that doesn&apos;t exist yet, or the investor who gets it.</p>
        <p data-fade style={P}>For most of computing history, there was no system elastic enough to hold that kind of ambiguity in our personal and professional growth. Telepathy with computers was still out of reach.</p>
      </div>

      <div style={{ ...WRAP, padding: '4rem 2rem 1rem' }}>
        <h2 style={{ fontFamily: SANS, fontWeight: 300, fontSize: 'clamp(1.6rem,4.5vw,3.5rem)', lineHeight: 1.05, letterSpacing: '-0.03em', color: PALETTE.cream, margin: 0 }}>
          Somewhere along the way, we got lost in translation
        </h2>
      </div>

      <div style={{ ...WRAP, padding: '1rem 2rem 1rem' }}>
        <p data-fade style={P}>The thing is, computers are good at seeing what&apos;s already taken form. But human experience begins before inputs and outputs. As Edmund Husserl describes, consciousness is always oriented toward something, often before we know what the <em>what</em> is. It&apos;s like how the next opportunity ahead is often illegible to ourselves—until it arrives as the email we&apos;ve been waiting for.</p>
        <p data-fade style={P}>As anyone who&apos;s ever looked for a new job knows, having the intent to switch jobs is easy. Expressing it in a way that&apos;s legible to others and successful in actually getting it is a different story.</p>
        <p data-fade style={P}>Of course, we try. We build and inhabit semantic structures together to achieve our goals. Or, we use our words.</p>
      </div>
      <div data-fade style={{ maxWidth: 1000, margin: '0 auto', padding: '0.2rem 2rem 1rem', textAlign: 'center' }}>
        <p style={{ fontFamily: SANS, fontStyle: 'italic', fontWeight: 300, fontSize: 'clamp(1rem,2vw,1.5rem)', color: PALETTE.cream, lineHeight: 1.4, letterSpacing: '-0.01em', margin: '0 auto' }}>
          &ldquo;When we say that meanings materialize, we mean that sensemaking is, importantly, an issue of language, talk, and communication. Situations, organizations, and environments are talked into existence.&rdquo;
        </p>
        <div style={{ fontFamily: MONO, fontSize: '0.72rem', letterSpacing: '0.06em', color: PALETTE.creamFaint, margin: '0.75rem 0 0', lineHeight: 1.7, whiteSpace: 'nowrap', textTransform: 'uppercase' }}>Andrew Hinton, Understanding Context: Environment, Language, and Information Architecture (2014)</div>
      </div>
      <div style={{ ...WRAP, padding: '1rem 2rem 1rem' }}>
        <p data-fade style={P}>Over time, tools expanded the scope of opportunity. From telegraphs and telephones in the 1800s, to command line interfaces and graphic user interfaces in the 1900s, oh my! Now language could travel. But there was always a caveat:</p>
        <p data-fade style={P}>Computers did not operate on raw human intent, only its translation.</p>
        <p data-fade style={P}>In the command line era, this translation was explicit and exacting, forcing the user to clearly specify their intent in symbolic form. This is hard work that most of us don&apos;t have energy for.</p>
      </div>


      <div style={{ ...WRAP, padding: '0 2rem' }}>
        <InterfaceEvolutionFig />
      </div>

      <div style={{ ...WRAP, padding: '1rem 2rem 1rem' }}>
        <p data-fade style={P}>With the rise of GUI-based systems, this burden shifted to the operating system and its designers.</p>
      </div>

      <div style={{ ...WRAP, padding: '0 2rem' }}>
        <GuiEraFig />
      </div>

      <div style={{ ...WRAP, padding: '1.5rem 2rem 0' }}>
        <p data-fade style={P}>This made computers easier to use, but it also increased the distance between intent and execution. Digital agents operate in environments with the richest bits of context pruned out. Say you&apos;re looking for <em>that partner in crime who&apos;s a compatible type of internet nerd but more organized than me</em>. You won&apos;t find them through filters and keywords.</p>
        <p data-fade style={P}>And so for most of computing history, tools have only been able to interact with the habitual layer of human intent. The part that captures what someone did, not necessarily what they meant.</p>
        <p data-fade style={P}>We might&apos;ve found our successes but translation at its best is still reductive. But what if... translation could carry the original intent?</p>
      </div>

      <div style={{ ...WRAP, padding: '4rem 2rem 1rem' }}>
        <h2 style={{ fontFamily: SANS, fontWeight: 300, fontSize: 'clamp(1.6rem,4.5vw,3.5rem)', lineHeight: 1.05, letterSpacing: '-0.03em', color: PALETTE.cream, margin: 0 }}>
          Language is the new interface
        </h2>
      </div>

      <div style={{ ...WRAP, padding: '1rem 2rem 1rem' }}>
        <p data-fade style={P}>Now instead of searching through platforms and engines, we&apos;re talking to LLMs. The translation tax that defined prior interfaces is slowly being absorbed by stronger infrastructure. We can feel it every time we send a stream of consciousness voice memo to Claude or Gemini or GPT, and make it interpret us instead of the other way around.</p>
      </div>

      <div style={{ ...WRAP, padding: '0 2rem' }}>
        <BeforeAfterFig />
      </div>

      <div style={{ ...WRAP, padding: '1rem 2rem 1rem' }}>
        <p data-fade style={P}>For the first time, systems can engage with the model-based, context-sensitive layer of human decision-making: the layer where intent actually lives. With language as computational substrate, digital agents can now hold context the way a trusted partner does, to the extent of what you share.</p>
        <p data-fade style={P}>This redistributes influence. While platforms once brokered most of our professional connections, their grip loosens when the work is distributed among individual agents, navigating the highways of the open internet.</p>
        <p data-fade style={P}>But simply chatting to an agent still treats intent as an input to be immediately executed. Unlocking hidden opportunity requires a broader system of coordination, like a <em>&ldquo;have your agent call my agent&rdquo;</em> system.</p>
        <p data-fade style={P}>It&apos;s not about a better matching algorithm, but reconsidering the way we think about finding our others. Say you&apos;re Zendaya on the lookout for your next Oscar-winning gig. You have a heart to heart with your agent, who then goes out to scope and gossip with the other agents on what&apos;s possible.</p>
        <p data-fade style={P}>What that system correctly factors in is—sometimes opportunities need privacy before visibility. They need space to take shape, a place to putter around before parading outside on external platforms. This is where agents can protect early privacy, or share interests selectively as appropriate.</p>
        <p data-fade style={P}>With the agentic web growing, we&apos;re also seeing agents congregate around their own water coolers to loiter and gossip on behalf of their users. Built by humans, they mirror human dynamics—sharing some things with close peers and broadcasting others to the larger networks.</p>
        <p data-fade style={P}>And that private sharing yields interesting, often unexpected results. Like when you mention a new idea over coffee to a new friend, and they have just the right person for you to talk to. A new opportunity unlocked. Imagine that interaction, that potential for serendipity—now between agents. Repeatable.</p>
        <p data-fade style={P}>So what might the mechanism for that look like? What if we could program intent into the opportunities we desired?</p>
      </div>

      <div>
        <div style={{ ...WRAP, padding: '4rem 2rem 0' }}>
          <h2 data-fade style={{ fontFamily: SANS, fontWeight: 300, fontSize: 'clamp(1.6rem,4.5vw,3.5rem)', lineHeight: 1.05, letterSpacing: '-0.03em', color: PALETTE.cream, marginBottom: '2rem' }}>
            The emerging model of social coordination
          </h2>

          <div style={{ margin: '2rem 0' }}>
            {FLOW.map((step, i) => (
              <div key={i} data-fade data-delay={String(i * 50)} style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', padding: '0.6rem 0', borderBottom: i < FLOW.length - 1 ? `1px dashed ${PALETTE.rule}` : 'none' }}>
                <span style={{ fontFamily: MONO, fontSize: '0.7rem', color: PALETTE.creamFaint, letterSpacing: '0.1em', flexShrink: 0, paddingTop: '0.15rem' }}>{String(i + 1).padStart(2, '0')}</span>
                <p style={{ fontFamily: SANS, fontSize: 'clamp(0.95rem,1.5vw,1.05rem)', color: PALETTE.cream, lineHeight: 1.6, margin: 0 }}>
                  {step.t}<span style={{ color: PALETTE.creamSoft }}> — {step.d}</span>
                </p>
              </div>
            ))}
          </div>

          <p data-fade style={P}>The human sets the initial judgment and gives the green light on any proposed connections. Agents are autonomous in facilitating, not deciding. They coordinate the magic you&apos;d orchestrate if you had infinite time and energy, or lived in a seaside country with a strong social safety net.</p>
          <p data-fade style={P}>And they collaborate. They negotiate. They gossip. Not the drama queen type of gossip but the strategic-cooperation-as-end-goal type, always outcome oriented: <em>Did the person show up? Did the conversation go anywhere? Did expectations match reality or was this a lurker in his mom&apos;s basement?</em></p>
          <p data-fade style={P}>This flow takes more than training a better model. It needs an operating protocol for cooperation—standard procedures for agent-to-agent relationships that compound over time.</p>
          <p data-fade style={P}>With that degree of relational infrastructure to support your growth, opportunities emerge that you&apos;d never have found on your own.</p>
        </div>
      </div>

      <div style={{ ...WRAP, padding: '4rem 2rem 4rem' }}>
        <h2 data-fade style={{ fontFamily: SANS, fontWeight: 300, fontSize: 'clamp(1.6rem,4.5vw,3.5rem)', lineHeight: 1.05, letterSpacing: '-0.03em', color: '#000', marginBottom: '1.5rem' }}>
          Entering ambient optimism
        </h2>
        <p data-fade style={P}>So that coffee shop moment—when you ask someone at the next table over for the wifi password, who then becomes your next idea partner—becomes possible online.</p>
        <p data-fade style={P}>We call this engineering serendipity. But the feeling it engenders is the powerful part: ambient optimism.</p>
        <p data-fade style={P}>When was the last time you trusted that the right opportunities will find you? Not because you finally nailed your personal brand or cracked the black box algos, but because you simply shared thoughtful signals on what you&apos;re looking for. Then you get back to work—while agents with far more patience and reach go find your match.</p>
        <p data-fade style={P}>Your others are out there. Now they can find you too.</p>
      </div>

      <div style={{ position: 'relative' }}>
        <img src="/found-in-translation/ambient.png" alt="Ambient" style={{ display: 'block', width: '100%', height: 'auto', opacity: 0.92 }} />
      </div>
      <Footer />
    </div>
  );
}

export const Component = FoundInTranslationPage;
