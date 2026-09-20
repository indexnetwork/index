import { BoxRenderable, ScrollBoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from '@opentui/core';

import { COLORS } from './negotiation.tui';

/**
 * Choose a bundled scenario before starting any agents.
 * @param renderer - The terminal shared with the negotiation view.
 * @param filenames - Available scenario filenames, in display order.
 * @returns The selected filename, or null when the user exits.
 */
export async function chooseScenario(renderer: CliRenderer, filenames: string[]): Promise<string | null> {
  const root = new BoxRenderable(renderer, {
    id: 'scenario-chooser', width: '100%', height: '100%', flexDirection: 'column',
    border: true, borderStyle: 'rounded', borderColor: COLORS.focus, padding: 1, gap: 1,
    backgroundColor: COLORS.background,
  });
  root.add(new TextRenderable(renderer, { content: 'Choose a scenario', fg: COLORS.focus, height: 1, flexShrink: 0 }));
  root.add(new TextRenderable(renderer, { content: 'Select a scenario to start its agents.', fg: COLORS.muted, height: 1, flexShrink: 0 }));
  const list = new ScrollBoxRenderable(renderer, {
    flexGrow: 1, minHeight: 0, scrollX: false, scrollY: true,
    contentOptions: { flexDirection: 'column' },
  });
  root.add(list);
  root.add(new TextRenderable(renderer, {
    content: '↑↓: select · Enter/click: start · Esc/Ctrl+C: quit',
    fg: COLORS.muted, height: 1, flexShrink: 0,
  }));

  let select!: (filename: string | null) => void;
  const selection = new Promise<string | null>((resolve) => { select = resolve; });
  let selected = 0;
  const rows = filenames.map((filename, index) => {
    const row = new TextRenderable(renderer, {
      id: `scenario-${index}`, height: 1, flexShrink: 0,
      onMouseDown: (event) => { event.stopPropagation(); select(filename); },
    });
    list.add(row);
    return row;
  });
  const highlight = (): void => {
    rows.forEach((row, index) => {
      row.content = `${index === selected ? '›' : ' '} ${filenames[index]}`;
      row.fg = index === selected ? COLORS.focus : COLORS.text;
      row.bg = index === selected ? '#202e40' : COLORS.background;
    });
    list.scrollChildIntoView(`scenario-${selected}`);
  };
  const onKey = (key: KeyEvent): void => {
    if (key.name === 'up' || key.name === 'down') {
      key.preventDefault();
      selected = Math.max(0, Math.min(filenames.length - 1, selected + (key.name === 'up' ? -1 : 1)));
      highlight();
    } else if (key.name === 'return') {
      key.preventDefault();
      select(filenames[selected]);
    } else if (key.name === 'escape') {
      key.preventDefault();
      select(null);
    }
  };
  const onDestroy = (): void => select(null);
  renderer.root.add(root);
  renderer.keyInput.on('keypress', onKey);
  renderer.once('destroy', onDestroy);
  list.focus();
  highlight();
  try {
    return await selection;
  } finally {
    renderer.keyInput.off('keypress', onKey);
    renderer.off('destroy', onDestroy);
    if (!root.isDestroyed) {
      renderer.root.remove(root);
      root.destroyRecursively();
    }
  }
}
