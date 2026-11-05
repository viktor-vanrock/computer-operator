import type { WsEvent } from '@arena/ui/types/websocket.types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useArena } from '@/features/arena/arena.use-arena';
import { useArenaStore } from '@/stores/arena.store';

const mocks = vi.hoisted(() => ({
  onWsEvent: null as ((event: WsEvent) => void) | null,
  navigate: vi.fn(),
  startSession: {
    mutateAsync: vi.fn(() => new Promise<never>(() => {})),
    isPending: false,
  },
  stopSession: { mutate: vi.fn(), isPending: false },
  failGuacamoleConnection: { mutate: vi.fn(), isPending: false },
  stopTask: { mutateAsync: vi.fn(), isPending: false },
  nextTask: { mutateAsync: vi.fn(), isPending: false },
  validateTask: { mutateAsync: vi.fn(), isPending: false },
  restartSession: { mutateAsync: vi.fn(), isPending: false },
  sessionData: undefined as { taskId: string; difficulty: 2 } | undefined,
  taskData: undefined as { title: string; prompt: string; isPreset: boolean } | undefined,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}));

vi.mock('@arena/ui/api/sessions.api', () => ({
  sessionKeys: { detail: (id: string) => ['sessions', id] },
  useSession: () => ({ data: mocks.sessionData }),
  useStartSession: () => mocks.startSession,
  useStopSession: () => mocks.stopSession,
  useFailGuacamoleConnection: () => mocks.failGuacamoleConnection,
  useStopTask: () => mocks.stopTask,
  useNextTask: () => mocks.nextTask,
  useRestartSession: () => mocks.restartSession,
}));

vi.mock('@arena/ui/api/tasks.api', () => ({
  useTask: () => ({ data: mocks.taskData }),
}));

vi.mock('@arena/ui/api/moderation.api', () => ({
  useValidateTask: () => mocks.validateTask,
}));

vi.mock('@arena/ui/lib/use-arena-socket', () => ({
  useArenaSocket: (_sessionId: string, options: { onEvent: (event: WsEvent) => void }) => {
    mocks.onWsEvent = options.onEvent;
  },
}));

describe('useArena', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onWsEvent = null;
    mocks.sessionData = undefined;
    mocks.taskData = undefined;
    mocks.validateTask.mutateAsync.mockResolvedValue({ allowed: true, validationToken: 'valid-token' });
    useArenaStore.getState().reset();
  });

  it('сохраняет полученный AGENT_THOUGHT в сообщениях арены после очистки Zustand', () => {
    const { result } = renderHook(() => useArena('session-1'));

    act(() => {
      mocks.onWsEvent?.({
        type: 'AGENT_THOUGHT',
        payload: { step: 1, ts: 1, text: 'Открываю браузер', status: 'INCOMPLETE' },
      });
    });

    expect(result.current.messages).toEqual([
      expect.objectContaining({ kind: 'agent', thought: 'Открываю браузер' }),
    ]);

    act(() => {
      useArenaStore.getState().reset();
    });

    expect(result.current.messages).toEqual([
      expect.objectContaining({ kind: 'agent', thought: 'Открываю браузер' }),
    ]);
  });

  it('показывает в чате prompt и не меняет заголовок после next-task', async () => {
    mocks.sessionData = { taskId: 'task-1', difficulty: 2 };
    mocks.taskData = { title: 'Короткий заголовок', prompt: 'Полная инструкция агенту', isPreset: true };
    mocks.nextTask.mutateAsync.mockResolvedValueOnce({});
    const { result } = renderHook(() => useArena('session-1'));

    act(() => {
      mocks.onWsEvent?.({ type: 'STATUS_CHANGE', payload: { status: 'RUNNING' } });
    });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ kind: 'user', text: 'Полная инструкция агенту' }),
    ]);

    await act(async () => { await result.current.handleNextTask('Следующая задача'); });
    expect(mocks.nextTask.mutateAsync).toHaveBeenCalledWith({
      sessionId: 'session-1',
      taskDescription: 'Следующая задача',
      validationToken: 'valid-token',
    });
    expect(result.current.taskTitle).toBe('Короткий заголовок');
    expect(result.current.isPresetTask).toBe(true);
  });

  it('не добавляет отклонённую следующую задачу в историю', async () => {
    mocks.validateTask.mutateAsync.mockRejectedValueOnce(new Error('rejected'));
    const { result } = renderHook(() => useArena('session-1'));

    await act(async () => {
      await result.current.handleNextTask('Отклонённая задача');
    });

    expect(mocks.nextTask.mutateAsync).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
    expect(result.current.nextTaskError).toBe('Неизвестная ошибка');
  });

  it('при обрыве Guacamole показывает ошибку и сообщает серверу, не вызывая штатный stop', async () => {
    const { result } = renderHook(() => useArena('session-1'));

    act(() => {
      result.current.handleGuacamoleError({ code: 'GUACAMOLE_CONNECTION_LOST' });
    });

    expect(result.current.status).toBe('FAILED');
    expect(result.current.startError).toEqual({
      code: 'GUACAMOLE_CONNECTION_LOST',
      message: 'Соединение с виртуальной машиной было потеряно',
    });
    expect(mocks.failGuacamoleConnection.mutate).toHaveBeenCalledWith('session-1');
    expect(mocks.stopSession.mutate).not.toHaveBeenCalled();
  });

  it('restart переходит на новую сессию с mode и не запускает cleanup старой страницы', async () => {
    mocks.restartSession.mutateAsync.mockResolvedValueOnce({ id: 'session-2', mode: 'SOLO' });
    const { result } = renderHook(() => useArena('session-1'));

    await act(async () => {
      await result.current.handleRestart();
    });

    expect(mocks.navigate).toHaveBeenCalledWith('/arena/session-2', {
      replace: true,
      state: { mode: 'SOLO' },
    });
  });

  it('после ошибки restart текущую сессию можно завершить обычной навигацией', async () => {
    mocks.restartSession.mutateAsync.mockRejectedValueOnce(new Error('restart failed'));
    const { result } = renderHook(() => useArena('session-1'));

    act(() => {
      mocks.onWsEvent?.({ type: 'STATUS_CHANGE', payload: { status: 'RUNNING' } });
    });

    await act(async () => {
      await result.current.handleRestart();
    });
    act(() => {
      result.current.handleRetry();
    });

    expect(result.current.restartError).toBe('Не удалось перезапустить сессию');
    expect(mocks.stopSession.mutate).toHaveBeenCalledWith('session-1');
  });
});
