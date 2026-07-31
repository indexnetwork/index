import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { App } from '../src/App';

afterEach(() => cleanup());

describe('App', () => {
  it('renders the terminal title bar', () => {
    render(<App />);
    expect(screen.getByText(/index eval ops/i)).toBeInTheDocument();
  });

  it('links to every route an operator needs', () => {
    render(<App />);
    const expected: ReadonlyArray<[string, string]> = [
      ['overview', '/'],
      ['launch', '/launch'],
      ['compare', '/compare'],
      ['profiles', '/profiles'],
    ];
    for (const [name, href] of expected) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });
});
