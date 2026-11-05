import { useCallback, useEffect, useRef, useState } from 'react';
import { generatePath, useNavigate } from 'react-router-dom';

import { sessionKeys, useFailGuacamoleConnection, useNextTask, useRestartSession, useSession, useStartSession, useStopSession, useStopTask } from '@arena/ui/api/sessions.api';
import { useTask } from '@arena/ui/api/tasks.api';
import type { GuacamoleConnectionError } from '@arena/ui/arena-player/use-guacamole-client';
import { SESSION_STATUSES } from '@arena/ui/constants/session';
import { useAgentThoughts } from '@arena/ui/hooks/use-agent-thoughts';
import { useSessionIdleTimeout } from '@arena/ui/hooks/use-session-idle-timeout';
import { apiClient, ApiError, BASE_URL } from '@arena/ui/lib/api-client';
import { useArenaSocket } from '@arena/ui/lib/use-arena-socket';
import type { Session, SessionStatus } from '@arena/ui/types/session.types';
import type { WsEvent } from '@arena/ui/types/websocket.types';
import { useQueryClient } from '@tanstack/react-query';

import { ROUTES } from '@/constants/routes';

export function useArena(sessionId: string) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [status, setStatusState] = useState<SessionStatus>('PENDING');
  const [connectArgs, setConnectArgs] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
  const restartSession = useRestartSession();

  const { messages, isTaskDone, addUserMessage, addSystemMessage, markTaskDone, handleWsEvent: handleAgentThought } = useAgentThoughts();

  const startedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const stopSentRef = useRef(false);
  const initialTaskAddedRef = useRef(false);
  // statusRef обновляется синхронно внутри setStatus (см. ниже), а не отдельным
  // useEffect — иначе между setStatusState() и обновлением рефа есть лаг в один
  // цикл рендера, из-за которого beforeunload/cleanup может прочитать устаревший статус.
  const statusRef = useRef(status);
  const setStatus = useCallback((next: SessionStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  useEffect(() => {
    if (SESSION_STATUSES.RUNNING === status) {
      startTimeRef.current = Date.now() - elapsedSeconds * 1000;
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  // Добавляем первое задание как сообщение пользователя при переходе в RUNNING
  useEffect(() => {
    if (SESSION_STATUSES.RUNNING === status && taskData?.prompt && !initialTaskAddedRef.current) {
      initialTaskAddedRef.current = true;
      addUserMessage(taskData.prompt);
    }
  }, [status, taskData?.prompt, addUserMessage]);

  const handleWsEvent = useCallback((event: WsEvent) => {
    if ('STATUS_CHANGE' === event.type) {
      setStatus(event.payload.status);
      if (event.payload.connectArgs) setConnectArgs(event.payload.connectArgs);
      return;
    }
    handleAgentThought(event);
  }, [handleAgentThought]);

  const synchronizeSession = useCallback(async () => {
    const session = await apiClient.get<Session>(`/sessions/${sessionId}`);
    setStatus(session.status);
    if (session.connectArgs) setConnectArgs(session.connectArgs);
    queryClient.setQueryData(sessionKeys.detail(sessionId), session);
  }, [queryClient, sessionId, setStatus]);

  useArenaSocket(sessionId, { onEvent: handleWsEvent, onReconnect: synchronizeSession, enabled: !!sessionId });

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
  }, [sessionId, setStatus, queryClient]);

  useEffect(() => {
    if (!sessionId || startedRef.current) return;
    startedRef.current = true;

    startSession.mutateAsync(sessionId).then((session) => {
      if (session.connectArgs) setConnectArgs(session.connectArgs);
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

  useEffect(() => {
    const handleUnload = () => {
      if (SESSION_STATUSES.RUNNING === statusRef.current || SESSION_STATUSES.PREPARING === statusRef.current) {
        navigator.sendBeacon(`${BASE_URL}/sessions/${sessionId}/stop`);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (!stopSentRef.current && (SESSION_STATUSES.RUNNING === statusRef.current || SESSION_STATUSES.PREPARING === statusRef.current)) {
        apiClient.post(`/sessions/${sessionId}/stop`, {}).catch(() => {});
      }
    };
  }, [sessionId]);

  const handleGuacamoleConnected = useCallback((tunnelId?: string) => {
    apiClient.post(`/sessions/${sessionId}/guacamole-ready`, tunnelId ? { tunnelId } : {}).catch(() => {});
  }, [sessionId]);

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

  const handleStop = useCallback(() => {
    if (!sessionId) return;
    stopSentRef.current = true;
    stopSession.mutate(sessionId);
    navigate(generatePath(ROUTES.RESULTS, { sessionId }), { state: { mode: 'SOLO' } });
  }, [sessionId, stopSession, navigate]);

  const handleRetry = useCallback(() => {
    stopSentRef.current = true;
    stopSession.mutate(sessionId);
    navigate(ROUTES.TASKS_SOLO);
  }, [sessionId, stopSession, navigate]);

  const handleRestart = useCallback(async () => {
    if (!sessionId || restartSession.isPending) return;
    stopSentRef.current = true;
    setRestartError(null);
    try {
      const replacement = await restartSession.mutateAsync(sessionId);
      navigate(generatePath(ROUTES.ARENA, { sessionId: replacement.id }), {
        replace: true,
        state: { mode: replacement.mode },
      });
    } catch (err) {
      stopSentRef.current = false;
      setRestartError(err instanceof ApiError ? err.message : 'Не удалось перезапустить сессию');
    }
  }, [navigate, restartSession, sessionId]);

  const handleNextTask = useCallback(async (taskDescription: string) => {
    addUserMessage(taskDescription);
    markTaskDone(false);
    setNextTaskError(null);
    try {
      await nextTaskMutation.mutateAsync({ sessionId, taskDescription });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Неизвестная ошибка';
      setNextTaskError(message);
      markTaskDone(true);
    }
  }, [sessionId, nextTaskMutation, addUserMessage, markTaskDone]);

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

  const idleTimeout = useSessionIdleTimeout({
    enabled: status === SESSION_STATUSES.RUNNING && isTaskDone,
    onTimeout: handleStop,
  });

  return {
    status,
    connectArgs,
    messages,
    elapsedSeconds,
    startError,
    isTaskDone,
    taskTitle: taskData?.title ?? '—',
    isPresetTask: taskData?.isPreset ?? true,
    difficulty: sessionData?.difficulty ?? 1,
    handleStop,
    handleStopTask,
    handleNextTask,
    handleRetry,
    handleRestart,
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
    nextTaskError,
    isNextTaskPending: nextTaskMutation.isPending,
  };
}
