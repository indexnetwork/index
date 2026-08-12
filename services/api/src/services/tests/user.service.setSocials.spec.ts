import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { UserService, type UserServiceDeps } from '../user.service';

describe('UserService.setSocials cascade', () => {
  let deps: Required<UserServiceDeps>;
  let mockDb: { setSocials: ReturnType<typeof mock>; [key: string]: unknown };

  beforeEach(() => {
    mockDb = {
      setSocials: mock(async () => {}),
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

  it('retraction order: persist → query → retract loop', async () => {
    const callOrder: string[] = [];
    (mockDb as any).setSocials = mock(async () => { callOrder.push('persist'); });
    deps.getPremisesBySource = mock(async () => { callOrder.push('query'); return [{ id: 'p1' }]; });
    deps.retractPremise = mock(async () => { callOrder.push('retract'); });

    const svc = new UserService(mockDb as any, deps);
    await svc.setSocials('user-1', []);

    expect(callOrder).toEqual(['persist', 'query', 'retract']);
  });
});
