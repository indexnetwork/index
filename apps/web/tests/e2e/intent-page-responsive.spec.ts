import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const intentPageSource = readFileSync(
  resolve(process.cwd(), 'src/app/i/[intentId]/page.tsx'),
  'utf8',
);

/**
 * Read the production sheet class list so the browser fixture exercises the
 * exact responsive/state selectors shipped by the intent page rather than a
 * test-only copy that could drift from the component.
 */
function getPersonalAgentSheetClasses(): string {
  const sheetMarker = 'data-testid="personal-agent-sheet"';
  const sheetOffset = intentPageSource.indexOf(sheetMarker);
  const classOffset = intentPageSource.indexOf('className={cn(', sheetOffset);
  const classEnd = intentPageSource.indexOf('\n                  )}', classOffset);

  if (sheetOffset < 0 || classOffset < 0 || classEnd < 0) {
    throw new Error('Unable to locate the Personal Agent sheet class list');
  }

  const classBlock = intentPageSource.slice(classOffset, classEnd);
  return [...classBlock.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .join(' ');
}

test('desktop closed state keeps Personal Agent visible beside equal-width Radar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const cssResponse = await fetch('http://127.0.0.1:3000/src/app/globals.css?direct');
  expect(cssResponse.ok).toBe(true);
  const generatedCss = (await cssResponse.text()).replace(/@import url\([^;]+;\s*/g, '');

  const sheetClasses = getPersonalAgentSheetClasses();
  await page.setContent('<body></body>');
  await page.addStyleTag({ content: generatedCss });
  await page.evaluate((classes) => {
    const fixture = document.createElement('main');
    fixture.id = 'intent-workspace-fixture';
    fixture.className = 'flex min-h-0 flex-1 flex-col gap-8 lg:flex-row';
    fixture.style.width = '1200px';
    fixture.style.height = '600px';
    fixture.innerHTML = `
      <section data-testid="personal-agent-sheet" data-state="closed">
        <div data-testid="intent-negotiator-chat-stub">Personal Agent</div>
      </section>
      <section
        data-testid="radar-column"
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:flex-1"
      >Radar</section>
    `;
    const sheet = fixture.querySelector<HTMLElement>('[data-testid="personal-agent-sheet"]');
    if (!sheet) throw new Error('Fixture sheet was not created');
    sheet.className = classes;
    document.body.replaceChildren(fixture);
  }, sheetClasses);

  const sheet = page.getByTestId('personal-agent-sheet');

  await expect(sheet).toHaveAttribute('data-state', 'closed');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS('display', 'flex');
  await expect(sheet).toHaveCSS('visibility', 'visible');
  await expect(sheet).toHaveCSS('pointer-events', 'auto');
  await expect(sheet).toHaveCSS('transform', 'none');

  const layout = await page.evaluate(() => {
    const sheetElement = document.querySelector<HTMLElement>('[data-testid="personal-agent-sheet"]');
    const radarElement = document.querySelector<HTMLElement>('[data-testid="radar-column"]');
    if (!sheetElement || !radarElement) throw new Error('Responsive fixture is incomplete');

    const sheetStyle = getComputedStyle(sheetElement);
    const sheetRect = sheetElement.getBoundingClientRect();
    const radarRect = radarElement.getBoundingClientRect();
    return {
      translate: sheetStyle.translate,
      sheet: { x: sheetRect.x, width: sheetRect.width },
      radar: { x: radarRect.x, width: radarRect.width },
      chatCount: document.querySelectorAll('[data-testid="intent-negotiator-chat-stub"]').length,
    };
  });

  expect(layout.translate).not.toBe('100%');
  expect(layout.sheet.x).toBeLessThan(layout.radar.x);
  expect(Math.abs(layout.sheet.width - layout.radar.width)).toBeLessThanOrEqual(1);
  expect(layout.chatCount).toBe(1);
});
