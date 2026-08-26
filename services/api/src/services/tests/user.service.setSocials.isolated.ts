import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { UserServiceDeps } from '../user.service';

const addDecomposeProfileJob = mock(async () => ({ id: 'decompose-job' }));

mock.module('../../lib/premise/cascade', () => ({
  premiseCascade: { addDecomposeProfileJob },
}));

const { UserService } = await import('../user.service');

type SocialRow = { id: string; userId: string; label: string; value: string };

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
    addDecomposeProfileJob.mockClear();

    mockDb = {
      setSocials: mock(async () => {}),
      getSocials: stubGetSocials([], [row('s1', 'github', 'https://github.com/test')]),
    } as any;

    deps = {
      getPremisesBySource: mock(async () => []),
      retractPremise: mock(async () => {}),
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

  it('order: read → persist → read → query → retract → enqueue rebuild', async () => {
    const callOrder: string[] = [];
    let reads = 0;
    mockDb.getSocials = mock(async () => {
      callOrder.push('read');
      return reads++ === 0 ? [] : [row('s1', 'github', 'https://github.com/test')];
    });
    mockDb.setSocials = mock(async () => { callOrder.push('persist'); });
    deps.getPremisesBySource = mock(async () => { callOrder.push('query'); return [{ id: 'p1' }]; });
    deps.retractPremise = mock(async () => { callOrder.push('retract'); });
    addDecomposeProfileJob.mockImplementation(async () => { callOrder.push('rebuild'); return { id: 'job' } as any; });

    const svc = new UserService(mockDb as any, deps);
    await svc.setSocials('user-1', []);

    expect(callOrder).toEqual(['read', 'persist', 'read', 'query', 'retract', 'rebuild']);
  });

  describe('premise rebuild', () => {
    it('enqueues a decompose job after retracting integration premises', async () => {
      (deps.getPremisesBySource as ReturnType<typeof mock>).mockResolvedValue([{ id: 'premise-1' }]);
      const svc = new UserService(mockDb as any, deps);
      await svc.setSocials('user-1', []);

      expect(addDecomposeProfileJob).toHaveBeenCalledWith('user-1');
    });

    it('enqueues a decompose job even when there was nothing to retract', async () => {
      const svc = new UserService(mockDb as any, deps);
      await svc.setSocials('user-1', []);

      expect(deps.retractPremise).not.toHaveBeenCalled();
      expect(addDecomposeProfileJob).toHaveBeenCalledWith('user-1');
    });

    it('swallows enqueue failures so the save still succeeds', async () => {
      addDecomposeProfileJob.mockImplementation(async () => { throw new Error('queue down'); });
      const svc = new UserService(mockDb as any, deps);

      await expect(svc.setSocials('user-1', [])).resolves.toBeUndefined();
    });
  });

  describe('unchanged socials', () => {
    it('does not retract or enqueue a rebuild when the stored set is identical', async () => {
      const stored = [row('s1', 'github', 'https://github.com/test')];
      mockDb.getSocials = stubGetSocials(stored, stored);
      (deps.getPremisesBySource as ReturnType<typeof mock>).mockResolvedValue([{ id: 'premise-1' }]);

      const svc = new UserService(mockDb as any, deps);
      await svc.setSocials('user-1', [{ label: 'github', value: 'https://github.com/test' }]);

      expect(mockDb.setSocials).toHaveBeenCalled();
      expect(deps.getPremisesBySource).not.toHaveBeenCalled();
      expect(deps.retractPremise).not.toHaveBeenCalled();
      expect(addDecomposeProfileJob).not.toHaveBeenCalled();
    });

    it('ignores regenerated row ids', async () => {
      mockDb.getSocials = stubGetSocials(
        [row('old-id', 'github', 'https://github.com/test')],
        [row('new-id', 'github', 'https://github.com/test')],
      );
      (deps.getPremisesBySource as ReturnType<typeof mock>).mockResolvedValue([{ id: 'premise-1' }]);

      const svc = new UserService(mockDb as any, deps);
      await svc.setSocials('user-1', [{ label: 'github', value: 'https://github.com/test' }]);

      expect(deps.retractPremise).not.toHaveBeenCalled();
      expect(addDecomposeProfileJob).not.toHaveBeenCalled();
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
      expect(addDecomposeProfileJob).toHaveBeenCalledWith('user-1');
    });
  });
});
