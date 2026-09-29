/**
 * JetBrains Mono + Public Sans for the app's auth and CLI screens (AuthForm,
 * /cli-auth, unlisted docs). The marketing site uses `ensureSiteFonts`.
 */
export function ensureLandingFonts() {
  if (typeof document === "undefined") return;
  const fontHref =
    "https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Public+Sans:wght@300;400;500;600&display=swap";
  if (document.querySelector(`link[href="${fontHref}"]`)) return;

  const preconnect1 = document.createElement("link");
  preconnect1.rel = "preconnect";
  preconnect1.href = "https://fonts.googleapis.com";
  const preconnect2 = document.createElement("link");
  preconnect2.rel = "preconnect";
  preconnect2.href = "https://fonts.gstatic.com";
  preconnect2.crossOrigin = "";
  const font = document.createElement("link");
  font.rel = "stylesheet";
  font.href = fontHref;
  document.head.append(preconnect1, preconnect2, font);
}
