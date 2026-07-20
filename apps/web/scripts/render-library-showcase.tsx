/**
 * Renders the component-library showcase to a standalone HTML file that can
 * be opened directly in a browser (no dev server needed):
 *
 *   bun run library:showcase        # writes apps/web/library-showcase.html
 *
 * Styling: Tailwind Play CDN (JIT-scans the static markup at load) plus the
 * app's Google fonts. Interactive states render in their initial state only.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ShowcasePage from '../src/components/library/ShowcasePage';

const body = renderToStaticMarkup(<ShowcasePage />);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Index · Entity Component Library</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    theme: {
      extend: {
        fontFamily: {
          sans: ['Public Sans', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        },
      },
    },
  };
</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Public+Sans:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
<style>
  body { font-family: 'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif; background: #fafafa; }
  .font-ibm-plex-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
</style>
</head>
<body>
${body}
</body>
</html>
`;

const outPath = fileURLToPath(new URL('../library-showcase.html', import.meta.url));
writeFileSync(outPath, html);
console.log(`Wrote ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);
