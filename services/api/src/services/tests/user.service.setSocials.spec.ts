import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { UserService, type UserServiceDeps } from '../user.service';

type SocialRow = { id: string; userId: string; label: string; value: string };

/** Build a `getSocials` mock that returns each stored snapshot in turn. */
function stubGetSocials(...snapshots: SocialRow[][]) {
  let call = 0;
  return mock(async () => snapshots[Math.min(call++, snapshots.length - 1)] ?? []);
}

const row = (id: string, label: string, value: string): SocialRow =>
  ({ id, userId: 'user-1', label, value });

describe('UserService.setSocials cascade', () => {
  let deps: Required<UserServiceDeps>;
  let mockDb: { setSocials: ReturnType<typeof mock>; getSocials: ReturnType<typeof mock>; [key: string]: unknown };

  beforeEach(() => {
    mockDb = {
      setSocials: mock(async () => {}),
      // Default: a change (empty → one row) so cascade-behavior tests fire.
      getSocials: stubGetSocials([], [row('s1', 'github', 'https://github.com/test')]),
    } as any;

    deps = {
      getPremisesBySource: mock(async () => []),
      retractPremise: mock(async () => {}),
      enqueueEnrichment: mock(async () => {}),
    };
  });

  it('persists socials via the db adapter', async () => {
    const svc = new UserService(mockDb as any, deps);
    const socials = [{ label: 'github', value: 'https://github.com/test' }];
    await svc.setSocials('user-1', socials);
    expect(mockDb.setSocials).toHaveBeenCalledWith('user-1', socials);
  });

  it('retracts all integration premises returned by getPremisesBySource', async () => {
    (deps.getPremisesBySource as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'premise-1' },
      { id: 'premise-2' },
    ]);
    const svc = new UserService(mockDb as any, deps);
    await svc.setSocials('user-1', []);

    expect(deps.getPremisesBySource).toHaveBeenCalledWith('user-1', 'integration');
    expect(deps.retractPremise).toHaveBeenCalledTimes(2);
    expect(deps.retractPremise).toHaveBeenCalledWith('premise-1');
    expect(deps.retractPremise).toHaveBeenCalledWith('premise-2');
  });

  it('retracts nothing when there are no integration premises', async () => {
    const svc = new UserService(mockDb as any, deps);
    await svc.setSocials('user-1', []);

    expect(deps.retractPremise).not.toHaveBeenCalled();
  });

  it('order: read → persist → read → query → retract → enqueue', async () => {
    const callOrder: string[] = [];
    let reads = 0;
    mockDb.getSocials = mock(async () => {
      callOrder.push('read');
      return reads++ === 0 ? [] : [row('s1', 'github', 'https://github.com/test')];
    });
    mockDb.setSocials = mock(async () => { callOrder.push('persist'); });
    deps.getPremisesBySource = mock(async () => { callOrder.push('query'); return [{ id: 'p1' }]; });
    deps.retractPremise = mock(async () => { callOrder.push('retract'); });
    deps.enqueueEnrichment = mock(async () => { callOrder.push('enqueue'); });

    const svc = new UserService(mockDb as any, deps);
    await svc.setSocials('user-1', []);

    expect(callOrder).toEqual(['read', 'persist', 'read', 'query', 'retract', 'enqueue']);
  });

  describe('re-enrichment', () => {
    it('enqueues enrichment after retracting so premises are rebuilt', async () => {
      (deps.getPremisesBySource as ReturnType<typeof mock>).mockResolvedValue([{ id: 'premise-1' }]);
      const svc = new UserService(mockDb as any, deps);
      await svc.setSocials('user-1', []);

      expect(deps.enqueueEnrichment).toHaveBeenCalledWith('user-1');
    });

    it('enqueues enrichment even when there was nothing to retract', async () => {
      const svc = new UserService(mockDb as any, deps);
      await svc.setSocials('user-1', []);

      expect(deps.retractPremise).not.toHaveBeenCalled();
      expect(deps.enqueueEnrichment).toHaveBeenCalledWith('user-1');
    });

    it('swallows enrichment failures so the save still succeeds', async () => {
      deps.enqueueEnrichment = mock(async () => { throw new Error('queue down'); });
      const svc = new UserService(mockDb as any, deps);

      await expect(svc.setSocials('user-1', [])).resolves.toBeUndefined();
    });
  });

  describe('unchanged socials', () => {
    it('does not retract or re-enrich when the stored set is identical', async () => {
      const stored = [row('s1', 'github', 'https://github.com/test')];
      mockDb.getSocials = stubGetSocials(stored, stored);
      (deps.getPremisesBySource as ReturnType<typeof mock>).mockResolvedValue([{ id: 'premise-1' }]);

      const svc = new UserService(mockDb as any, deps);
      await svc.setSocials('user-1', [{ label: 'github', value: 'https://github.com/test' }]);

      expect(mockDb.setSocials).toHaveBeenCalled();
      expect(deps.getPremisesBySource).not.toHaveBeenCalled();
      expect(deps.retractPremise).not.toHaveBeenCalled();
      expect(deps.enqueueEnrichment).not.toHaveBeenCalled();
    });

    it('ignores regenerated row ids — the adapter deletes and re-inserts every write', async () => {
      mockDb.getSocials = stubGetSocials(
        [row('old-id', 'github', 'https://github.com/test')],
        [row('new-id', 'github', 'https://github.com/test')],
      );
      (deps.getPremisesBySource as ReturnType<typeof mock>).mockResolvedValue([{ id: 'premise-1' }]);

      const svc = new UserService(mockDb as any, deps);
      await svc.setSocials('user-1', [{ label: 'github', value: 'https://github.com/test' }]);

      expect(deps.retractPremise).not.toHaveBeenCalled();
      expect(deps.enqueueEnrichment).not.toHaveBeenCalled();
    });

    it('ignores row order', async () => {
      mockDb.getSocials = stubGetSocials(
        [row('s1', 'github', 'https://github.com/a'), row('s2', 'twitter', 'https://x.com/b')],
        [row('s2', 'twitter', 'https://x.com/b'), row('s1', 'github', 'https://github.com/a')],
      );

      const svc = new UserService(mockDb as any, deps);
      await svc.setSocials('user-1', []);

      expect(deps.retractPremise).not.toHaveBeenCalled();
      expect(deps.enqueueEnrichment).not.toHaveBeenCalled();
    });

    it('treats a changed value on the same label as a change', async () => {
      mockDb.getSocials = stubGetSocials(
        [row('s1', 'github', 'https://github.com/old')],
        [row('s1', 'github', 'https://github.com/new')],
      );
      (deps.getPremisesBySource as ReturnType<typeof mock>).mockResolvedValue([{ id: 'premise-1' }]);

      const svc = new UserService(mockDb as any, deps);
      await svc.setSocials('user-1', [{ label: 'github', value: 'https://github.com/new' }]);

      expect(deps.retractPremise).toHaveBeenCalledWith('premise-1');
      expect(deps.enqueueEnrichment).toHaveBeenCalledWith('user-1');
    });

    it('treats a removed social as a change', async () => {
      mockDb.getSocials = stubGetSocials(
        [row('s1', 'github', 'https://github.com/a'), row('s2', 'twitter', 'https://x.com/b')],
        [row('s1', 'github', 'https://github.com/a')],
      );
      (deps.getPremisesBySource as ReturnType<typeof mock>).mockResolvedValue([{ id: 'premise-1' }]);

      const svc = new UserService(mockDb as any, deps);
      await svc.setSocials('user-1', [{ label: 'github', value: 'https://github.com/a' }]);

      expect(deps.retractPremise).toHaveBeenCalledWith('premise-1');
      expect(deps.enqueueEnrichment).toHaveBeenCalledWith('user-1');
    });

    it('does not let separator characters make distinct sets collide', async () => {
      mockDb.getSocials = stubGetSocials(
        [row('s1', 'custom', 'a'), row('s2', 'custom', 'b')],
        [row('s1', 'custom', 'a\u0000b')],
      );
      (deps.getPremisesBySource as ReturnType<typeof mock>).mockResolvedValue([{ id: 'premise-1' }]);

      const svc = new UserService(mockDb as any, deps);
      await svc.setSocials('user-1', []);

      expect(deps.enqueueEnrichment).toHaveBeenCalledWith('user-1');
    });
  });
});
