import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const get = vi.fn(async () => ({ memories: [] }));

vi.mock('@/lib/api', () => ({
  useAuthenticatedAPI: () => ({ get }),
}));

import IntentMemoryStrip from '../IntentMemoryStrip';

describe('IntentMemoryStrip', () => {
  it('re-fetches intent memory when its live intent invalidation changes', async () => {
    const { rerender } = render(
      <IntentMemoryStrip intentId="intent-1" userId="user-1" liveInvalidation={0} />,
    );
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    rerender(<IntentMemoryStrip intentId="intent-1" userId="user-1" liveInvalidation={1} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenLastCalledWith('/users/user-1/negotiator/memories?intentId=intent-1');
  });
});
