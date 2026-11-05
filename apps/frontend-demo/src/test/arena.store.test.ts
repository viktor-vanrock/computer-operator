import { beforeEach, describe, expect, it } from 'vitest';

import { useArenaStore } from '@/stores/arena.store';

describe('arenaStore', () => {
  beforeEach(() => {
    useArenaStore.getState().reset();
  });

  it('начальное состояние корректно', () => {
    const state = useArenaStore.getState();
    expect(state.status).toBe('PENDING');
    expect(state.elapsedSeconds).toBe(0);
    expect(state.connectArgs).toBeNull();
    expect(state.metrics).toBeNull();
  });

  it('setStatus обновляет статус', () => {
    useArenaStore.getState().setStatus('RUNNING');
    expect(useArenaStore.getState().status).toBe('RUNNING');
  });

  it('updateMetrics сохраняет метрики', () => {
    const metrics = { participant: 'HUMAN' as const, time: 1000, steps: 3, clicks: 5, errors: 0, retries: 0 };
    useArenaStore.getState().updateMetrics(metrics);
    expect(useArenaStore.getState().metrics).toEqual(metrics);
  });

  it('reset возвращает начальное состояние', () => {
    useArenaStore.getState().setStatus('RUNNING');
    useArenaStore.getState().setElapsedSeconds(5000);
    useArenaStore.getState().reset();

    const state = useArenaStore.getState();
    expect(state.status).toBe('PENDING');
    expect(state.elapsedSeconds).toBe(0);
  });
});
