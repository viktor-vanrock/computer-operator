import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useValidateTask } from '@arena/ui/api/moderation.api';
import { useCreateSession } from '@arena/ui/api/sessions.api';
import { useCreateTask } from '@arena/ui/api/tasks.api';
import { usePendingLaunch } from '@arena/ui/hooks/use-pending-launch';
import { apiClient,ApiError } from '@arena/ui/lib/api-client';
import type { CreateSessionInput, Session } from '@arena/ui/types/session.types';
import type { Task } from '@arena/ui/types/task.types';

import type { SelectedTask } from './task-selection.types';

export function useTaskSelection(mode: 'SOLO' | 'HUMAN_VS_AGENT' = 'SOLO') {
  const navigate = useNavigate();
  const submitting = useRef(false);

  const [selectedTask, setSelectedTask] = useState<SelectedTask | null>(null);
  const [customDraft, setCustomDraftRaw] = useState('');
  const [launchBusy, setLaunchBusy] = useState(false);
  const [launchError, setLaunchError] = useState<Error | null>(null);

  const setCustomDraft = useCallback((value: string) => {
    setCustomDraftRaw(value);
    setSelectedTask(null);
  }, []);

  const startCustomTask = useCallback(() => {
    setSelectedTask(null);
    setCustomDraftRaw('');
  }, []);

  const createTask = useCreateTask();
  const validateTask = useValidateTask();
  const createSession = useCreateSession();
  const pendingLaunch = usePendingLaunch<CreateSessionInput>('arena-demo-launch');
  const [recoveringLaunch, setRecoveringLaunch] = useState(() => {
    const saved = pendingLaunch.read();
    return Boolean(saved?.sessionRequest || saved?.sessionId);
  });

  const dismissValidationError = useCallback(() => {
    validateTask.reset();
    setLaunchError((error) => error instanceof ApiError && 'TASK_MODERATION_REJECTED' === error.code ? null : error);
  }, [validateTask]);

  const createTaskMutateRef = useRef(createTask.mutateAsync);
  createTaskMutateRef.current = createTask.mutateAsync;

  const validateTaskMutateRef = useRef(validateTask.mutateAsync);
  validateTaskMutateRef.current = validateTask.mutateAsync;

  const createSessionMutateRef = useRef(createSession.mutateAsync);
  createSessionMutateRef.current = createSession.mutateAsync;

  // Выбор пресета сбрасывает кастомную задачу.
  const selectPreset = useCallback((task: Task) => {
    setSelectedTask({ id: task.id, title: task.title, prompt: task.prompt, imageId: task.imageId, difficulty: task.difficulty, source: 'preset' });
    setCustomDraftRaw(task.prompt);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedTask(null);
    setCustomDraftRaw('');
  }, []);

  const startOnce = useCallback(async () => {
    if ('HUMAN_VS_AGENT' === mode) {
      const draft = customDraft.trim();
      const session = await pendingLaunch.run(
        JSON.stringify({ mode, selectedTaskId: selectedTask?.id, draft, difficulty: selectedTask?.difficulty ?? 3 }),
        async () => {
          if (selectedTask?.id && selectedTask.prompt.trim() === draft) return selectedTask.id;
          const validation = await validateTaskMutateRef.current(draft);
          const task = await createTaskMutateRef.current({
            title: draft, prompt: draft, imageId: null, difficulty: 3,
            validationToken: validation.validationToken,
          });
          return task.id;
        },
        (taskId) => ({ taskId, mode, difficulty: selectedTask?.difficulty ?? 3,
          arenaOs: 'ubuntu2204', agentLeftModel: 'computer-operator', autoFinishOnAgent: false }),
        (body, key) => apiClient.post<Session>('/sessions', body, { 'Idempotency-Key': key })
      );
      pendingLaunch.clear();
      setRecoveringLaunch(false);
      navigate(`/arena/${session.id}`);
      return;
    }

    let taskId: string | null = null;

    if (selectedTask?.id && selectedTask.prompt.trim() === customDraft.trim()) {
      taskId = selectedTask.id;
    } else if (customDraft.trim().length > 0) {
      const normalized = customDraft.trim();
      const validation = await validateTaskMutateRef.current(normalized);
      const task = await createTaskMutateRef.current({
        title: normalized,
        prompt: normalized,
        imageId: null,
        difficulty: 3,
        validationToken: validation.validationToken,
      });
      taskId = task.id;
    } else {
      if (!selectedTask?.id) return;
      taskId = selectedTask.id;
    }

    if (!taskId) return;

    const session = await createSessionMutateRef.current({
      taskId,
      mode: 'SOLO',
      difficulty: selectedTask?.difficulty ?? 1,
      arenaOs: 'ubuntu2204',
      agentLeftModel: 'computer-operator',
    });

    navigate(`/arena/${session.id}`);
  }, [selectedTask, customDraft, navigate, mode, pendingLaunch]);

  const handleStart = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    setLaunchBusy(true);
    setLaunchError(null);
    try { await startOnce(); }
    catch (error) {
      if ('HUMAN_VS_AGENT' === mode) {
        const definiteRejection = error instanceof ApiError && [400, 401, 403, 404, 422].includes(error.status);
        const saved = pendingLaunch.read();
        if (definiteRejection && !recoveringLaunch) pendingLaunch.clear();
        setRecoveringLaunch((!definiteRejection || recoveringLaunch) && Boolean(saved?.sessionRequest || saved?.sessionId));
      }
      setLaunchError(error instanceof Error ? error : new Error('Не удалось запустить соревнование'));
      throw error;
    }
    finally { submitting.current = false; setLaunchBusy(false); }
  }, [mode, pendingLaunch, recoveringLaunch, startOnce]);

  const hasTask = Boolean(selectedTask?.id && selectedTask.prompt.trim() === customDraft.trim()) || customDraft.trim().length > 0;
  const canStart = hasTask;

  return {
    selectedTask,
    customDraft,
    setCustomDraft,
    startCustomTask,
    selectPreset,
    clearSelection,
    handleStart,
    canStart,
    recoveringLaunch: 'HUMAN_VS_AGENT' === mode && recoveringLaunch,
    isStarting: launchBusy || validateTask.isPending || createSession.isPending || createTask.isPending,
    startError: launchError ?? validateTask.error ?? createSession.error ?? createTask.error,
    validationError: validateTask.error instanceof ApiError && 'TASK_MODERATION_REJECTED' === validateTask.error.code,
    dismissValidationError,
  };
}
