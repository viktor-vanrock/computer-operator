import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recoverRaces } from '@/modules/sessions/race/race-recovery.js';

const recovery = vi.hoisted(() => ({ findMany: vi.fn(), finalize: vi.fn(), cleanup: vi.fn() }));
vi.mock('@/modules/sessions/race/race-state.repository.js', () => ({ raceStateRepository: {
  db: { session: { findMany: recovery.findMany } }, finalize: recovery.finalize,
} }));
vi.mock('@/modules/sessions/race/race-coordinator.js', () => ({ raceCoordinator: { cleanup: recovery.cleanup } }));

describe('race owner recovery', () => {
  it.each(['PENDING', 'PREPARING', 'RUNNING'])('finalizes stale %s then continues durable cleanup', async status => {
    recovery.findMany.mockResolvedValue([{ id: status, status, race: { finishedAt: null } }]);
    await recoverRaces();
    expect(recovery.finalize).toHaveBeenCalledWith(status, 'BACKEND_RESTART');
    expect(recovery.cleanup).toHaveBeenCalledWith(status);
    expect(recovery.finalize.mock.invocationCallOrder.at(-1)).toBeLessThan(recovery.cleanup.mock.invocationCallOrder.at(-1)!);
  });
  beforeEach(() => vi.clearAllMocks());
  it('finalizes unfinished races even after a stale flat FAILED status, preserving a committed winner', async () => {
    recovery.findMany.mockResolvedValue([
      { id: 'stale', status: 'FAILED', race: { finishedAt: null } },
      { id: 'winner', status: 'COMPLETED', race: { finishedAt: new Date() } },
    ]);
    await recoverRaces();
    expect(recovery.finalize).toHaveBeenCalledExactlyOnceWith('stale', 'BACKEND_RESTART');
    expect(recovery.cleanup).toHaveBeenCalledWith('stale');
    expect(recovery.cleanup).toHaveBeenCalledWith('winner');
  });
});
