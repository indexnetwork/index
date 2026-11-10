import { useEffect, useState } from "react";

/** How long each line stays up, and how long it takes to fade between lines. */
const HOLD_MS = 4500;
const FADE_MS = 300;

/** Which line the clock is on. Reading the clock, not a counter, keeps the
 *  rotation going when the page re-mounts the line (as Home does on refresh). */
const lineAt = (now: number, count: number) => Math.floor(now / HOLD_MS) % count;

/**
 * Shows one line at a time, fading to the next every few seconds.
 * With reduced motion the lines still change, without the fade.
 */
export default function RotatingLine({ lines }: { lines: readonly string[] }) {
  const count = Math.max(lines.length, 1);
  const [index, setIndex] = useState(() => lineAt(Date.now(), count));
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (lines.length < 2) return;
    let timer: number;
    const schedule = () => {
      const now = Date.now();
      const next = (Math.floor(now / HOLD_MS) + 1) * HOLD_MS;
      // Fade out just before the switch, then show the clock's line.
      timer = window.setTimeout(() => {
        setVisible(false);
        timer = window.setTimeout(() => {
          setIndex(lineAt(Date.now() + 1, count));
          setVisible(true);
          schedule();
        }, FADE_MS);
      }, Math.max(next - FADE_MS - now, 0));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [lines.length, count]);

  return (
    <span className="ih-rotating-line" data-visible={visible} style={{ transitionDuration: `${FADE_MS}ms` }}>
      {lines[index % count]}
    </span>
  );
}
