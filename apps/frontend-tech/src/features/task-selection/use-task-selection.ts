import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCreateSession } from '@arena/ui/api/sessions.api';
import { useCreateTask } from '@arena/ui/api/tasks.api';
import { usePendingLaunch } from '@arena/ui/hooks/use-pending-launch';
import { apiClient } from '@arena/ui/lib/api-client';
import type { CreateSessionInput, Session } from '@arena/ui/types/session.types';

import type { SessionModeValue } from '@/constants/session-config';
import { FULL_DUPLEX_DEFAULTS, SOLO_DEFAULTS } from '@/constants/session-config';

import type { ImageSelectionValue } from './image-options';
import { DEFAULT_IMAGE_SELECTION, imageSelectionAfterLoad, toSessionImageFields } from './image-options';

const DEFAULT_DIFFICULTY = 3;
export type NumberDraft = number | '';

export function isValidNonnegativeNumber(value: NumberDraft): value is number {
  return 'number' === typeof value && Number.isFinite(value) && value >= 0;
}

export function isValidNonnegativeInteger(value: NumberDraft): value is number {
  return isValidNonnegativeNumber(value) && Number.isInteger(value);
}

export function useTaskSelection(
  mode: SessionModeValue,
  availableImageIds: ReadonlySet<string> | null = null,
  availableProfileIds: ReadonlySet<string> | null = null
) {
  const navigate = useNavigate();
  const [launchBusy, setLaunchBusy] = useState(false);
  const [launchError, setLaunchError] = useState<Error | null>(null);
  const pendingLaunch = usePendingLaunch<CreateSessionInput>('arena-tech-launch');

  const [taskDraft, setTaskDraft] = useState('');
  const [imageSelection, setImageSelection] = useState<ImageSelectionValue>(DEFAULT_IMAGE_SELECTION);
  const [agentModel, setAgentModel] = useState<string | null>('default');
  const [historyMaxStepsCount, setHistoryMaxStepsCount] = useState<number>(FULL_DUPLEX_DEFAULTS.HISTORY_MAX_STEPS_COUNT);
  const [maxScreenshotsDelay, setMaxScreenshotsDelay] = useState<number>(FULL_DUPLEX_DEFAULTS.MAX_SCREENSHOTS_DELAY);
  const [maxIterations, setMaxIterations] = useState<NumberDraft>(SOLO_DEFAULTS.MAX_ITERATIONS);
  const [modelRetries, setModelRetries] = useState<NumberDraft>(SOLO_DEFAULTS.MODEL_RETRIES);
  const [mouseClickDelay, setMouseClickDelay] = useState<NumberDraft>(SOLO_DEFAULTS.MOUSE_CLICK_DELAY);
  const [minOperationDelay, setMinOperationDelay] = useState<NumberDraft>(SOLO_DEFAULTS.MIN_OPERATION_DELAY);

  const createTask = useCreateTask();
  const createSession = useCreateSession();

  const isFullDuplex = 'FULL_DUPLEX' === mode;
  const effectiveImageSelection = imageSelectionAfterLoad(imageSelection, availableImageIds);
  const isSoloConfigValid = isValidNonnegativeInteger(maxIterations)
    && isValidNonnegativeInteger(modelRetries)
    && isValidNonnegativeNumber(mouseClickDelay)
    && isValidNonnegativeNumber(minOperationDelay);
  const isProfileAvailable = agentModel !== null && (null === availableProfileIds || availableProfileIds.has(agentModel));
  const canStart = isFullDuplex || (taskDraft.trim().length > 0 && isProfileAvailable && isSoloConfigValid);

  const handleStart = useCallback(async () => {
    if (isFullDuplex) {
      const osFields = toSessionImageFields(effectiveImageSelection);
      // Модель для Full Duplex предопределена на стороне full-duplex-сервиса — не выбираем и не передаём.
      const session = await createSession.mutateAsync({
        mode: 'FULL_DUPLEX',
        difficulty: DEFAULT_DIFFICULTY,
        ...osFields,
        historyMaxStepsCount,
        maxScreenshotsDelay,
      });
      navigate(`/arena/${session.id}`, { state: { mode: session.mode } });
      return;
    }

    if (!canStart || !agentModel || !taskDraft.trim() || !isSoloConfigValid) return;

    if ('HUMAN_VS_AGENT' === mode) {
      setLaunchBusy(true); setLaunchError(null);
      try {
        const session = await pendingLaunch.run(JSON.stringify({ mode, taskDraft, effectiveImageSelection, agentModel, maxIterations,
          modelRetries, mouseClickDelay, minOperationDelay, autoFinishOnAgent: false }), async () => {
          const task = await createTask.mutateAsync({
            title: taskDraft.trim(), prompt: taskDraft.trim(), imageId: null, difficulty: DEFAULT_DIFFICULTY,
          });
          return task.id;
        }, (taskId) => ({
          taskId, mode, agentLeftModel: agentModel, difficulty: DEFAULT_DIFFICULTY, autoFinishOnAgent: false,
          ...toSessionImageFields(effectiveImageSelection),
          maxIterations, modelRetries, mouseClickDelay, minOperationDelay }),
        (body, key) => apiClient.post<Session>('/sessions', body, { 'Idempotency-Key': key }));
        navigate(`/arena/${session.id}`, { state: { mode } });
      } catch (error) {
        setLaunchError(error instanceof Error ? error : new Error('Не удалось создать сессию'));
      } finally { setLaunchBusy(false); }
      return;
    }
    const task = await createTask.mutateAsync({
      title: taskDraft.trim(),
      prompt: taskDraft.trim(),
      imageId: null,
      difficulty: DEFAULT_DIFFICULTY,
    });

    const session = await createSession.mutateAsync({
      taskId: task.id,
      mode: 'SOLO',
      difficulty: DEFAULT_DIFFICULTY,
      ...toSessionImageFields(effectiveImageSelection),
      agentLeftModel: agentModel,
      maxIterations,
      modelRetries,
      mouseClickDelay,
      minOperationDelay,
    });

    navigate(`/arena/${session.id}`, { state: { mode: session.mode } });
  }, [
    canStart, mode, pendingLaunch, isFullDuplex, taskDraft, effectiveImageSelection, agentModel,
    historyMaxStepsCount, maxScreenshotsDelay, maxIterations, modelRetries,
    mouseClickDelay, minOperationDelay, isSoloConfigValid, createTask, createSession, navigate,
  ]);

  return {
    taskDraft,
    setTaskDraft,
    imageSelection: effectiveImageSelection,
    agentModel,
    setImageSelection,
    setAgentModel,
    historyMaxStepsCount,
    setHistoryMaxStepsCount,
    maxScreenshotsDelay,
    setMaxScreenshotsDelay,
    maxIterations,
    setMaxIterations,
    modelRetries,
    setModelRetries,
    mouseClickDelay,
    setMouseClickDelay,
    minOperationDelay,
    setMinOperationDelay,
    canStart,
    isStarting: launchBusy || createTask.isPending || createSession.isPending,
    startError: launchError ?? createTask.error ?? createSession.error,
    handleStart,
  };
}
