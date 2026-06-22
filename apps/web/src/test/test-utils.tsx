import { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * Renders a component wrapped in a MemoryRouter for route-aware testing.
 * @param ui - React element to render
 * @param options - Optional route and render options
 */
export function renderWithRouter(
  ui: ReactElement,
  {
    route = '/',
    ...renderOptions
  }: { route?: string } & Omit<RenderOptions, 'wrapper'> = {}
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    ),
    ...renderOptions,
  });
}

export { render } from '@testing-library/react';
export { screen } from '@testing-library/react';
