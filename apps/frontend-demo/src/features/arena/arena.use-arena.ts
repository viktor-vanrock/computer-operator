import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useValidateTask } from '@arena/ui/api/moderation.api';
import { sessionKeys, useFailGuacamoleConnection, useNextTask, useRestartSession, useSession, useStartSession, useStopSession, useStopTask } from '@arena/ui/api/sessions.api';
import { useTask } from '@arena/ui/api/tasks.api';
import type { GuacamoleConnectionError } from '@arena/ui/arena-player/use-guacamole-client';
import { useAgentThoughts } from '@arena/ui/hooks/use-agent-thoughts';
import { useSessionIdleTimeout } from '@arena/ui/hooks/use-session-idle-timeout';
import { apiClient, ApiError, BASE_URL } from '@arena/ui/lib/api-client';
import { useArenaSocket } from '@arena/ui/lib/use-arena-socket';
import type { Session } from '@arena/ui/types/session.types';
import type { WsEvent } from '@arena/ui/types/websocket.types';
import { useQueryClient } from '@tanstack/react-query';

import { ROUTES } from '@/constants/routes';
import { useArenaStore } from '@/stores/arena.store';

import { SESSION_STATUSES } from './arena.constants';

export function useArena(sessionId: string) {
  const navigate = useNavigate();

  const {
    status, connectArgs, elapsedSeconds,
    setStatus, setConnectArgs, setElapsedSeconds, reset,
  } = useArenaStore();

  const {
    messages, isTaskDone, addUserMessage, addSystemMessage,
    markTaskDone, handleWsEvent: handleAgentThought,
  } = useAgentThoughts();

  const [startError, setStartError] = useState<{ code: string; message: string } | null>(null);
  const [nextTaskError, setNextTaskError] = useState<string | null>(null);
  const [restartError, setRestartError] = useState<string | null>(null);

  const { data: sessionData } = useSession(sessionId);
  const { data: taskData } = useTask(sessionData?.taskId ?? '');

  const startSession = useStartSession();
  const stopSession = useStopSession();
  const failGuacamoleConnection = useFailGuacamoleConnection();
  const stopTaskMutation = useStopTask();
  const nextTaskMutation = useNextTask();
  const validateTaskMutation = useValidateTask();
  const restartSession = useRestartSession();
  const queryClient = useQueryClient();

  // При SESSION_ALREADY_STARTED — восстанавливаем состояние из API, не падаем в FAILED.
  const restoreRunningSession = useCallback(async (): Promise<boolean> => {
    try {
      const session = await apiClient.get<Session>(`/sessions/${sessionId}`);
      if (session.status === SESSION_STATUSES.RUNNING || session.status === SESSION_STATUSES.PREPARING) {
        if (session.connectArgs) setConnectArgs(session.connectArgs);
        setStatus(session.status);
        queryClient.setQueryData(sessionKeys.detail(sessionId), session);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [sessionId, setConnectArgs, setStatus, queryClient]);

  const startedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const initialTaskAddedRef = useRef(false);
  // true если stop уже был инициирован явно (handleStop/handleRetry) — cleanup-эффект
  // при размонтировании не должен слать второй /stop, статус в сторе ещё не успел
  // обновиться на COMPLETED к моменту navigate().
  const stopSentRef = useRef(false);

  // ── Timer ─────────────────────────────────────────────
  useEffect(() => {
    if (SESSION_STATUSES.RUNNING === status) {
      startTimeRef.current = Date.now() - elapsedSeconds * 1000;
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  // Добавляем первое задание как сообщение пользователя при переходе в RUNNING.
  useEffect(() => {
    if (
      status === SESSION_STATUSES.RUNNING &&
      taskData?.prompt &&
      !initialTaskAddedRef.current
    ) {
      initialTaskAddedRef.current = true;
      addUserMessage(taskData.prompt);
    }
  }, [status, taskData?.prompt, addUserMessage]);

  // ── WS events ─────────────────────────────────────────
  const handleWsEvent = useCallback((event: WsEvent) => {
    if ('STATUS_CHANGE' === event.type) {
      setStatus(event.payload.status);
      if (event.payload.connectArgs) setConnectArgs(event.payload.connectArgs);
      return;
    }
    handleAgentThought(event);
  }, [handleAgentThought, setConnectArgs, setStatus]);

  const synchronizeSession = useCallback(async () => {
    const session = await apiClient.get<Session>(`/sessions/${sessionId}`);
    setStatus(session.status);
    if (session.connectArgs) setConnectArgs(session.connectArgs);
    queryClient.setQueryData(sessionKeys.detail(sessionId), session);
  }, [queryClient, sessionId, setConnectArgs, setStatus]);

  useArenaSocket(sessionId, { onEvent: handleWsEvent, onReconnect: synchronizeSession, enabled: !!sessionId });

  // tunnelId берётся напрямую от клиентского Guacamole-туннеля (tunnel.uuid) и передаётся
  // бэкенду — так он не должен опрашивать /activeConnections и гадать, готово ли соединение.
  const guacReadySentRef = useRef(false);

  const notifyGuacamoleReady = useCallback((body: { tunnelId?: string }) => {
    if (guacReadySentRef.current) return;
    guacReadySentRef.current = true;
    apiClient.post(`/sessions/${sessionId}/guacamole-ready`, body).catch(() => {/* логируется на бэкенде */});
  }, [sessionId]);

  const handleGuacamoleConnected = useCallback((tunnelId?: string) => {
    notifyGuacamoleReady(tunnelId ? { tunnelId } : {});
  }, [notifyGuacamoleReady]);

  // Рабочий стол не отрисовался за отведённое время (чёрный экран/зависшая ВМ) —
  // не ждём серверный PREPARING-таймаут, сразу показываем ошибку и
  // останавливаем сессию, чтобы освободить ВМ.
  const guacErrorHandledRef = useRef(false);
  const handleGuacamoleError = useCallback((error: GuacamoleConnectionError) => {
    if (guacErrorHandledRef.current) return;
    guacErrorHandledRef.current = true;
    const isScreenTimeout = 'GUACAMOLE_SCREEN_TIMEOUT' === error.code;
    setStartError({
      code: error.code,
      message: isScreenTimeout
        ? 'ОС не успела отрисовать рабочий стол за 1 минуту'
        : 'Соединение с виртуальной машиной было потеряно',
    });
    setStatus(SESSION_STATUSES.FAILED);
    stopSentRef.current = true;
    failGuacamoleConnection.mutate(sessionId);
  }, [failGuacamoleConnection, sessionId, setStatus]);

  // ── Start on mount ────────────────────────────────────
  useEffect(() => {
    if (!sessionId || startedRef.current) return;
    startedRef.current = true;

    startSession.mutateAsync(sessionId).then((session) => {
      if (session.connectArgs) {
        setConnectArgs(session.connectArgs);
      }
      setStatus(session.status);
    }).catch(async (err: unknown) => {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';
      if ('SESSION_ALREADY_STARTED' === code && await restoreRunningSession()) {
        return;
      }
      const message = err instanceof ApiError ? err.message : 'Неизвестная ошибка';
      setStartError({ code, message });
      setStatus(SESSION_STATUSES.FAILED);
    });

  }, [sessionId]);

  // ── Stop on browser close / refresh ──────────────────
  // sendBeacon доставляется браузером даже при выгрузке страницы.
  // Эндпоинт /stop не требует body, поэтому sendBeacon без данных работает корректно.
  useEffect(() => {
    const handleUnload = () => {
      const { status } = useArenaStore.getState();
      if (status === SESSION_STATUSES.RUNNING || status === SESSION_STATUSES.PREPARING) {
        navigator.sendBeacon(`${BASE_URL}/sessions/${sessionId}/stop`);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [sessionId]);

  // ── Cleanup on unmount ────────────────────────────────
  // Останавливаем сессию при уходе со страницы (навигация назад, закрытие вкладки и т.д.).
  // stopSentRef защищает от дублирующего /stop: если пользователь уже нажал «Завершить»
  // (handleStop/handleRetry), navigate() размонтирует страницу раньше, чем локальный
  // статус в сторе успеет обновиться на COMPLETED через WS — без этого флага cleanup
  // всё ещё видел бы RUNNING/PREPARING и слал бы второй запрос.
  useEffect(() => {
    return () => {
      const { status } = useArenaStore.getState();
      if (
        !stopSentRef.current &&
        (status === SESSION_STATUSES.RUNNING || status === SESSION_STATUSES.PREPARING)
      ) {
        apiClient.post(`/sessions/${sessionId}/stop`, {}).catch(() => {});
      }
      reset();
    };
  }, [reset, sessionId]);

  // ── Actions ───────────────────────────────────────────
  const handleNextTask = useCallback(async (taskDescription: string) => {
    setNextTaskError(null);
    try {
      const validation = await validateTaskMutation.mutateAsync(taskDescription);
      await nextTaskMutation.mutateAsync({
        sessionId,
        taskDescription,
        validationToken: validation.validationToken,
      });
      addUserMessage(taskDescription);
      markTaskDone(false);
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Неизвестная ошибка';
      setNextTaskError(message);
      markTaskDone(true);
      return false;
    }
  }, [sessionId, validateTaskMutation, nextTaskMutation, addUserMessage, markTaskDone]);

  const handleStopTask = useCallback(async () => {
    try {
      await stopTaskMutation.mutateAsync(sessionId);
      addSystemMessage('Задача остановлена');
      markTaskDone(true);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Неизвестная ошибка';
      setNextTaskError(message);
    }
  }, [sessionId, stopTaskMutation, addSystemMessage, markTaskDone]);

  const handleStop = useCallback(() => {
    if (!sessionId) return;
    stopSentRef.current = true;
    stopSession.mutate(sessionId);

    navigate(ROUTES.TASK_SELECTION);
  }, [sessionId, stopSession, navigate]);

  const handleHome = useCallback(() => {
    navigate(ROUTES.TASK_SELECTION);
  }, [navigate]);

  const handleRetry = useCallback(() => {
    // Останавливаем текущую сессию неблокирующе и переходим к выбору новой задачи
    stopSentRef.current = true;
    stopSession.mutate(sessionId);
    navigate(ROUTES.TASK_SELECTION);
  }, [sessionId, stopSession, navigate]);

  const handleRestart = useCallback(async () => {
    if (!sessionId || restartSession.isPending) return;
    stopSentRef.current = true;
    setRestartError(null);
    try {
      const replacement = await restartSession.mutateAsync(sessionId);
      reset();
      navigate(`/arena/${replacement.id}`, { replace: true, state: { mode: replacement.mode } });
    } catch (err) {
      stopSentRef.current = false;
      setRestartError(err instanceof ApiError ? err.message : 'Не удалось перезапустить сессию');
    }
  }, [navigate, reset, restartSession, sessionId]);

  const idleTimeout = useSessionIdleTimeout({
    enabled: status === SESSION_STATUSES.RUNNING && isTaskDone,
    onTimeout: handleStop,
  });

  return {
    status,
    connectArgs,
    messages,
    startError,
    elapsedSeconds,
    isTaskDone,
    taskTitle: taskData?.title ?? '—',
    isPresetTask: taskData?.isPreset ?? true,
    difficulty: sessionData?.difficulty ?? 1,
    agentLeftModel: sessionData?.agentLeftModel ?? null,
    handleStop,
    handleStopTask,
    handleNextTask,
    handleRetry,
    handleRestart,
    handleHome,
    handleGuacamoleConnected,
    handleGuacamoleError,
    handleInputActivity: idleTimeout.reportActivity,
    handleIdleContinue: idleTimeout.continueSession,
    handleIdleEnd: idleTimeout.endSession,
    isIdleWarningOpen: idleTimeout.isWarningOpen,
    idleSecondsRemaining: idleTimeout.secondsRemaining,
    isStopping: stopSession.isPending,
    isRestarting: restartSession.isPending,
    restartError,
    isStoppingTask: stopTaskMutation.isPending,
    isStarting: startSession.isPending,
    nextTaskError,
    isNextTaskPending: validateTaskMutation.isPending || nextTaskMutation.isPending,
    isRunning: status === SESSION_STATUSES.RUNNING,
  };
}
