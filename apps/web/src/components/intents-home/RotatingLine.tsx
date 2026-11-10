import { useEffect, useState } from "react";

/** How long each line stays up, and how long it takes to fade between lines. */
const HOLD_MS = 4500;
const FADE_MS = 300;

/**
 * Shows one line at a time, fading to the next every few seconds.
 * With reduced motion the lines still change, without the fade.
 */
export default function RotatingLine({ lines }: { lines: readonly string[] }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (lines.length < 2) return;
    let swap: number | undefined;
    const timer = window.setInterval(() => {
      setVisible(false);
      swap = window.setTimeout(() => {
        setIndex((i) => (i + 1) % lines.length);
        setVisible(true);
      }, FADE_MS);
    }, HOLD_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(swap);
    };
  }, [lines.length]);

  return (
    <span className="ih-rotating-line" data-visible={visible} style={{ transitionDuration: `${FADE_MS}ms` }}>
      {lines[index % lines.length]}
    </span>
  );
}
