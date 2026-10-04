import { useEffect } from "react";

/**
 * Publishes the visible viewport as `--vv-h` / `--vv-top` on <html> for
 * `.wb-viewport` (workbench.css).
 *
 * iOS Safari keeps the layout viewport at full height when the keyboard opens
 * and pans the page instead, and `100vh` / `100dvh` never shrink for it. Pinning
 * the shell to visualViewport keeps the composer on the keyboard and the title
 * bar on screen.
 */
export function useVisualViewport(enabled = true) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!enabled || !vv) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--vv-h", `${vv.height}px`);
      root.style.setProperty("--vv-top", `${vv.offsetTop}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    // Backup for rotations and browsers that skip visualViewport resize.
    window.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.style.removeProperty("--vv-h");
      root.style.removeProperty("--vv-top");
    };
  }, [enabled]);
}
