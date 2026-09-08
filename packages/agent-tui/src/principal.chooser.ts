import { BoxRenderable, ScrollBoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';

import { COLORS, type TuiPrincipal } from './negotiation.tui';

/** @param renderer - Shared terminal. @param principals - Existing principal/intent choices supplied by the host. @returns The explicitly selected sessions, or null on exit. */
export async function choosePrincipals(renderer: CliRenderer, principals: readonly TuiPrincipal[]): Promise<TuiPrincipal[] | null> {
  const root = new BoxRenderable(renderer, { width: '100%', height: '100%', flexDirection: 'column', border: true, borderColor: COLORS.focus, padding: 1, backgroundColor: COLORS.background });
  root.add(new TextRenderable(renderer, { content: 'Choose principal / intent sessions', fg: COLORS.focus, height: 1 }));
  const hint = new TextRenderable(renderer, { content: 'Space/click toggles · ↑↓ moves · Enter starts selected agents · Esc quits', fg: COLORS.muted, height: 2 });
  root.add(hint);
  const list = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 0, scrollX: false, scrollY: true, contentOptions: { flexDirection: 'column' } });
  root.add(list);
  let finish!: (value: TuiPrincipal[] | null) => void;
  const result = new Promise<TuiPrincipal[] | null>((resolve) => { finish = resolve; });
  const chosen = new Set<string>();
  let index = 0;
  const rows = principals.map((principal, rowIndex) => {
    const row = new TextRenderable(renderer, { id: `principal-${rowIndex}`, height: 2, flexShrink: 0, wrapMode: 'word',
      onMouseDown: () => { index = rowIndex; toggle(); } });
    list.add(row);
    return row;
  });
  function render(): void {
    rows.forEach((row, rowIndex) => {
      const principal = principals[rowIndex];
      row.content = `${rowIndex === index ? '›' : ' '} [${chosen.has(principal.id) ? 'x' : ' '}] ${principal.name} · ${principal.intent}\n      ${principal.userId} / ${principal.intentId}`;
      row.fg = rowIndex === index ? COLORS.focus : COLORS.text;
    });
    list.scrollChildIntoView(`principal-${index}`);
  }
  function toggle(): void {
    const id = principals[index].id;
    if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
    render();
  }
  const onKey = (key: KeyEvent): void => {
    if (key.name === 'up' || key.name === 'down') {
      key.preventDefault(); index = Math.max(0, Math.min(principals.length - 1, index + (key.name === 'up' ? -1 : 1))); render();
    } else if (key.name === 'space') { key.preventDefault(); toggle(); }
    else if (key.name === 'return') {
      key.preventDefault();
      const selected = principals.filter(({ id }) => chosen.has(id));
      if (new Set(selected.map(({ userId }) => userId)).size < 2) hint.content = 'Select intents belonging to at least two users. Space toggles; Enter starts.';
      else finish(selected);
    } else if (key.name === 'escape') { key.preventDefault(); finish(null); }
  };
  const onDestroy = () => finish(null);
  renderer.root.add(root);
  renderer.keyInput.on('keypress', onKey);
  renderer.once('destroy', onDestroy);
  list.focus(); render();
  try { return await result; }
  finally {
    renderer.keyInput.off('keypress', onKey); renderer.off('destroy', onDestroy);
    if (!root.isDestroyed) { renderer.root.remove(root); root.destroyRecursively(); }
  }
}
