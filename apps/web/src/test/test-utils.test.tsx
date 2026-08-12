import { screen } from '@testing-library/react';
import { useParams } from 'react-router';
import { expect, test } from 'vitest';

import { renderWithRouter } from './test-utils';

function RouteParamProbe() {
  const { id } = useParams<{ id: string }>();
  return <span>{id ?? 'missing'}</span>;
}

test('renderWithRouter supplies params from a matching route pattern', () => {
  renderWithRouter(<RouteParamProbe />, {
    route: '/d/session-42',
    routePattern: '/d/:id',
  });

  expect(screen.getByText('session-42')).toBeInTheDocument();
});
