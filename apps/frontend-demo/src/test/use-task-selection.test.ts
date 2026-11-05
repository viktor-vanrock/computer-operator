import type { Task } from '@arena/ui/types/task.types';
import { act,renderHook } from '@testing-library/react';
import { beforeEach,describe, expect, it, vi } from 'vitest';

import { useTaskSelection } from '@/features/task-selection/use-task-selection';

/* ── Mocks ─────────────────────────────────────────────────────────── */

const mockNavigate = vi.fn();
let modeQuery = '';
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(modeQuery)],
  useNavigate: () => mockNavigate,
}));

const mockCreateTaskMutateAsync = vi.fn();
vi.mock('@arena/ui/api/tasks.api', () => ({
  useCreateTask: () => ({
    mutateAsync: mockCreateTaskMutateAsync,
    isPending: false,
    error: null,
  }),
}));

const mockValidateTaskMutateAsync = vi.fn();
vi.mock('@arena/ui/api/moderation.api', () => ({
  useValidateTask: () => ({
    mutateAsync: mockValidateTaskMutateAsync,
    isPending: false,
    error: null,
  }),
}));

const mockRaceSession = vi.fn();
vi.mock('@arena/ui/lib/api-client', () => ({ apiClient: { post: (...args: unknown[]) => mockRaceSession(...args) }, ApiError: class extends Error {} }));
const mockCreateSessionMutateAsync = vi.fn();
vi.mock('@arena/ui/api/sessions.api', () => ({
  useCreateSession: () => ({
    mutateAsync: mockCreateSessionMutateAsync,
    isPending: false,
    error: null,
  }),
}));

/* ── Fixtures ───────────────────────────────────────────────────────── */

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Сортировка массива',
  prompt: 'Откройте редактор и отсортируйте массив',
  imageId: null,
  difficulty: 2,
  isVisible: true,
  isPreset: true,
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const LONG_ENOUGH_DRAFT = 'Описание задачи длиннее 10 символов';

/* ── Tests ─────────────────────────────────────────────────────────── */

describe('useTaskSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    modeQuery = '';
    mockValidateTaskMutateAsync.mockResolvedValue({ allowed: true, validationToken: 'valid-token' });
  });

  /* ── Initial state ── */
  describe('начальное состояние', () => {
    it('selectedTask = null, canStart = false', () => {
      const { result } = renderHook(() => useTaskSelection());
      expect(result.current.selectedTask).toBeNull();
      expect(result.current.canStart).toBe(false);
    });
  });

  /* ── selectPreset ── */
  describe('selectPreset', () => {
    it('выставляет selectedTask с source=preset и difficulty по задаче', () => {
      const { result } = renderHook(() => useTaskSelection());
      const task = makeTask({ difficulty: 4 });
      act(() => { result.current.selectPreset(task); });

      expect(result.current.customDraft).toBe(task.prompt);
      expect(result.current.selectedTask).toEqual({
        id: 'task-1',
        title: 'Сортировка массива',
        prompt: 'Откройте редактор и отсортируйте массив',
        imageId: null,
        difficulty: 4,
        source: 'preset',
      });
    });
  });

  /* ── setCustomDraft ── */
  describe('setCustomDraft', () => {
    it('сохраняет черновик и не меняет selectedTask', () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => { result.current.setCustomDraft(LONG_ENOUGH_DRAFT); });

      expect(result.current.customDraft).toBe(LONG_ENOUGH_DRAFT);
      expect(result.current.selectedTask).toBeNull();
    });

    it('canStart = true для пользовательской задачи: образ и модель заданы системой', () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => { result.current.setCustomDraft(LONG_ENOUGH_DRAFT); });
      expect(result.current.canStart).toBe(true);
    });
  });

  describe('startCustomTask', () => {
    it('снимает выбор пресета и очищает поле', () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => { result.current.selectPreset(makeTask()); });
      act(() => { result.current.startCustomTask(); });

      expect(result.current.selectedTask).toBeNull();
      expect(result.current.customDraft).toBe('');
      expect(result.current.canStart).toBe(false);
    });
  });

  it('после перехода от пресета к своей задаче создаёт сессию с difficulty 1', async () => {
    mockCreateTaskMutateAsync.mockResolvedValueOnce(makeTask({ id: 'custom-after-preset' }));
    mockCreateSessionMutateAsync.mockResolvedValueOnce({ id: 'session-custom-after-preset' });
    const { result } = renderHook(() => useTaskSelection());

    act(() => { result.current.selectPreset(makeTask({ difficulty: 5 })); });
    act(() => { result.current.startCustomTask(); });
    act(() => { result.current.setCustomDraft(LONG_ENOUGH_DRAFT); });
    await act(async () => { await result.current.handleStart(); });

    expect(mockCreateSessionMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ difficulty: 1 }));
  });

  /* ── clearSelection ── */
  describe('clearSelection', () => {
    it('сбрасывает selectedTask', () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => { result.current.selectPreset(makeTask({ difficulty: 5 })); });

      act(() => { result.current.clearSelection(); });
      expect(result.current.selectedTask).toBeNull();
      expect(result.current.canStart).toBe(false);
    });
  });

  /* ── handleStart ── */
  describe('handleStart', () => {
    it('не вызывает createSession если задача не выбрана и черновик пустой', async () => {
      const { result } = renderHook(() => useTaskSelection());
      await act(async () => { await result.current.handleStart(); });
      expect(mockCreateSessionMutateAsync).not.toHaveBeenCalled();
    });

    it('передаёт ОС по умолчанию и computer-operator для preset без imageId', async () => {
      const session = { id: 'session-99' };
      mockCreateSessionMutateAsync.mockResolvedValueOnce(session);

      const { result } = renderHook(() => useTaskSelection());
      act(() => { result.current.selectPreset(makeTask({ difficulty: 3 })); });

      await act(async () => { await result.current.handleStart(); });

      expect(mockCreateSessionMutateAsync).toHaveBeenCalledWith({
        taskId: 'task-1',
        mode: 'SOLO',
        difficulty: 3,
        arenaOs: 'ubuntu2204',
        agentLeftModel: 'computer-operator',
      });
      expect(mockNavigate).toHaveBeenCalledWith('/arena/session-99');
    });

    it('для custom-черновика создаёт задачу перед сессией', async () => {
      const createdTask = makeTask({ id: 'c-created', title: LONG_ENOUGH_DRAFT });
      mockCreateTaskMutateAsync.mockResolvedValueOnce(createdTask);
      const session = { id: 'session-custom' };
      mockCreateSessionMutateAsync.mockResolvedValueOnce(session);

      const { result } = renderHook(() => useTaskSelection());
      act(() => { result.current.setCustomDraft(LONG_ENOUGH_DRAFT); });

      await act(async () => { await result.current.handleStart(); });

      expect(mockCreateTaskMutateAsync).toHaveBeenCalledWith({
        title: LONG_ENOUGH_DRAFT,
        difficulty: 3,
        prompt: LONG_ENOUGH_DRAFT,
        imageId: null,
        validationToken: 'valid-token',
      });
      expect(mockCreateSessionMutateAsync).toHaveBeenCalledWith({
        taskId: 'c-created',
        mode: 'SOLO',
        difficulty: 1,
        arenaOs: 'ubuntu2204',
        agentLeftModel: 'computer-operator',
      });
      expect(mockNavigate).toHaveBeenCalledWith('/arena/session-custom');
    });

    it('не создаёт пользовательскую задачу при отказе модерации', async () => {
      mockValidateTaskMutateAsync.mockRejectedValueOnce(new Error('rejected'));
      const { result } = renderHook(() => useTaskSelection());
      act(() => { result.current.setCustomDraft(LONG_ENOUGH_DRAFT); });

      await expect(act(async () => { await result.current.handleStart(); })).rejects.toThrow('rejected');

      expect(mockCreateTaskMutateAsync).not.toHaveBeenCalled();
      expect(mockCreateSessionMutateAsync).not.toHaveBeenCalled();
      expect(result.current.customDraft).toBe(LONG_ENOUGH_DRAFT);
    });

    it('передаёт выбор образа задаче на бэкенде', async () => {
      mockCreateSessionMutateAsync.mockResolvedValueOnce({ id: 'session-image' });
      const { result } = renderHook(() => useTaskSelection());
      act(() => { result.current.selectPreset(makeTask({ imageId: 'case-image-v1', difficulty: 2 })); });

      await act(async () => { await result.current.handleStart(); });

      expect(mockCreateSessionMutateAsync).toHaveBeenCalledWith({
        taskId: 'task-1',
        mode: 'SOLO',
        difficulty: 2,
        arenaOs: 'ubuntu2204',
        agentLeftModel: 'computer-operator',
      });
    });
  });

  it('editing a preset prompt creates a moderated custom task instead of launching the original', async () => {
    mockCreateTaskMutateAsync.mockResolvedValueOnce(makeTask({ id: 'edited' }));
    mockCreateSessionMutateAsync.mockResolvedValueOnce({ id: 'edited-session' });
    const { result } = renderHook(() => useTaskSelection());
    act(() => result.current.selectPreset(makeTask()));
    act(() => result.current.setCustomDraft('Изменённый промпт задания'));
    await act(async () => { await result.current.handleStart(); });
    expect(mockValidateTaskMutateAsync).toHaveBeenCalledWith('Изменённый промпт задания');
    expect(mockCreateSessionMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'edited' }));
  });
  /* ── canStart ── */
  describe('canStart', () => {
    it('false когда задача не выбрана и черновик пустой', () => {
      const { result } = renderHook(() => useTaskSelection());
      expect(result.current.canStart).toBe(false);
    });

    it('true после выбора preset без ручной настройки OS и модели', () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => { result.current.selectPreset(makeTask()); });
      expect(result.current.canStart).toBe(true);
    });

    it('true после достаточного customDraft', () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => { result.current.setCustomDraft(LONG_ENOUGH_DRAFT); });
      expect(result.current.canStart).toBe(true);
    });

    it('false после clearSelection', () => {
      const { result } = renderHook(() => useTaskSelection());
      act(() => { result.current.selectPreset(makeTask()); });
      act(() => { result.current.clearSelection(); });
      expect(result.current.canStart).toBe(false);
    });
  });
});

describe('demo SOLO restriction', () => {
  beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });
  it.each(['full-duplex', 'human-vs-agent', 'split', 'coop'])('launches only SOLO even with mode=%s and a saved race launch', async (mode) => {
    modeQuery = `mode=${mode}`;
    sessionStorage.setItem('arena-demo-launch', JSON.stringify({ body: { mode: 'HUMAN_VS_AGENT', taskId: 'old-task' } }));
    mockCreateSessionMutateAsync.mockResolvedValue({ id: 'solo-session' });
    const { result } = renderHook(() => useTaskSelection());
    expect(result.current.canStart).toBe(false);
    await act(async () => { await result.current.handleStart(); });
    expect(mockCreateSessionMutateAsync).not.toHaveBeenCalled();
    act(() => result.current.selectPreset(makeTask()));
    await act(async () => { await result.current.handleStart(); });
    expect(mockCreateSessionMutateAsync).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mode: 'SOLO', taskId: 'task-1' }));
    expect(mockRaceSession).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenLastCalledWith('/arena/solo-session');
  });
});
