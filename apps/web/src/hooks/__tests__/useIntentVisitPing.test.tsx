import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useIntentVisitPing } from '../useIntentVisitPing';

const mocks = vi.hoisted(() => ({
  visitIntent: vi.fn(async () => {}),
}));

vi.mock('@/contexts/APIContext', () => ({
  useIntents: () => mocks,
}));

function Probe({ intentId }: { intentId?: string }) {
  useIntentVisitPing(intentId);
  return <div>intent page</div>;
}

describe('useIntentVisitPing', () => {
  it('pings on mount and remains best-effort when the request fails', async () => {
    mocks.visitIntent.mockRejectedValueOnce(new Error('offline'));
    render(<Probe intentId="intent-1" />);
    await waitFor(() => expect(mocks.visitIntent).toHaveBeenCalledWith('intent-1'));
    expect(document.body).toHaveTextContent('intent page');
  });

  it('does not ping without an intent id', () => {
    mocks.visitIntent.mockClear();
    render(<Probe />);
    expect(mocks.visitIntent).not.toHaveBeenCalled();
  });
});
