import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useValidateTask } from '@arena/ui/api/moderation.api';
import { useCreateSession } from '@arena/ui/api/sessions.api';
import { useCreateTask } from '@arena/ui/api/tasks.api';
import { ApiError } from '@arena/ui/lib/api-client';
import type { Task } from '@arena/ui/types/task.types';

import type { SelectedTask } from './task-selection.types';

export function useTaskSelection() {
  const navigate = useNavigate();
  const submitting = useRef(false);

  const [selectedTask, setSelectedTask] = useState<SelectedTask | null>(null);
  const [customDraft, setCustomDraftRaw] = useState('');

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

  const dismissValidationError = useCallback(() => {
    validateTask.reset();
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
    let taskId: string | null = null;

    if (selectedTask?.id) {
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

    const session = await createSessionMutateRef.current({
      taskId,
      mode: 'SOLO',
      difficulty: selectedTask?.difficulty ?? 1,
      arenaOs: 'ubuntu2204',
      agentLeftModel: 'computer-operator',
    });

    navigate(`/arena/${session.id}`);
  }, [selectedTask, customDraft, navigate]);

  const handleStart = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    try { await startOnce(); } finally { submitting.current = false; }
  }, [startOnce]);

  const hasTask = Boolean(selectedTask?.id) || customDraft.length > 0;
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
    isStarting: validateTask.isPending || createSession.isPending || createTask.isPending,
    startError: validateTask.error ?? createSession.error ?? createTask.error,
    validationError: validateTask.error instanceof ApiError && 'TASK_MODERATION_REJECTED' === validateTask.error.code,
    dismissValidationError,
  };
}
