import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { App } from '../src/App';

describe('App', () => {
  it('renders the terminal title bar', () => {
    render(<App />);
    expect(screen.getByText(/index eval ops/i)).toBeInTheDocument();
  });
});
