import { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

/**
 * Renders a component wrapped in a MemoryRouter for route-aware testing.
 * @param ui - React element to render
 * @param options - Optional route and render options
 */
export function renderWithRouter(
  ui: ReactElement,
  {
    route = '/',
    routePattern,
    ...renderOptions
  }: { route?: string; routePattern?: string } & Omit<RenderOptions, 'wrapper'> = {}
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[route]}>
        {routePattern ? (
          <Routes>
            <Route path={routePattern} element={children} />
          </Routes>
        ) : children}
      </MemoryRouter>
    ),
    ...renderOptions,
  });
}

export { render } from '@testing-library/react';
export { screen } from '@testing-library/react';
