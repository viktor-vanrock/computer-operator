import { useCallback, useEffect, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { sessionKeys, useFailGuacamoleConnection, useRestartSession, useSendFullDuplexMessage, useSession, useStartSession, useStopSession } from '../api/sessions.api';
import type { GuacamoleConnectionError } from '../arena-player/use-guacamole-client';
import { SESSION_STATUSES } from '../constants/session';
import { useFullDuplexMessages } from '../hooks/use-full-duplex-messages';
import { useSessionIdleTimeout } from '../hooks/use-session-idle-timeout';
import { apiClient, ApiError, BASE_URL } from '../lib/api-client';
import { useArenaSocket } from '../lib/use-arena-socket';
import type { Session, SessionStatus } from '../types/session.types';
import type { WsEvent } from '../types/websocket.types';

export interface FullDuplexOptions {
  onBack: () => void;
  onResults?: (durationSeconds: number) => void;
  onRestart: (id: string) => void;
  sendMessage?: (text: string) => Promise<unknown>;
}

export function useArenaFullDuplex(sessionId: string, options: FullDuplexOptions) {
  const queryClient = useQueryClient();

  const [status, setStatusState] = useState<SessionStatus>('PENDING');
  const [connectArgs, setConnectArgs] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [startError, setStartError] = useState<{ code: string; message: string } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [restartError, setRestartError] = useState<string | null>(null);

  const { data: sessionData } = useSession(sessionId);
  const startSession = useStartSession();
  const stopSession = useStopSession();
  const failGuacamoleConnection = useFailGuacamoleConnection();
  const sendMessageMutation = useSendFullDuplexMessage();
  const restartSession = useRestartSession();

  const { messages, addUserMessage, handleWsEvent: handleFullDuplexEvent } = useFullDuplexMessages();

  const startPromiseRef = useRef<Promise<Session> | null>(null);
  const sendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const stopSentRef = useRef(false);
  const mountEpochRef = useRef(0);
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

  const handleWsEvent = useCallback((event: WsEvent) => {
    if ('STATUS_CHANGE' === event.type) {
      setStatus(event.payload.status);
      if (event.payload.connectArgs) setConnectArgs(event.payload.connectArgs);
      return;
    }
    handleFullDuplexEvent(event);
  }, [handleFullDuplexEvent]);

  const synchronizeSession = useCallback(async () => {
    const session = await apiClient.get<Session>(`/sessions/${sessionId}`);
    setStatus(session.status);
    if (session.connectArgs) setConnectArgs(session.connectArgs);
    queryClient.setQueryData(sessionKeys.detail(sessionId), session);
  }, [queryClient, sessionId, setStatus]);

  useArenaSocket(sessionId, { onEvent: handleWsEvent, onReconnect: synchronizeSession, enabled: !!sessionId });

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
    if (!sessionId || !sessionData) return;
    let cancelled = false;
    if (sessionData.status !== 'PENDING') {
      setConnectArgs(sessionData.connectArgs);
      setStatus(sessionData.status);
      return;
    }
    startPromiseRef.current ??= startSession.mutateAsync(sessionId);
    startPromiseRef.current.then((session) => {
      if (cancelled) return;
      if (session.connectArgs) setConnectArgs(session.connectArgs);
      setStatus(session.status);
    }).catch(async (err: unknown) => {
      if (cancelled) return;
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';
      if ('SESSION_ALREADY_STARTED' === code && await restoreRunningSession()) {
        return;
      }
      const message = err instanceof ApiError ? err.message : 'Неизвестная ошибка';
      setStartError({ code, message });
      setStatus(SESSION_STATUSES.FAILED);
    });
    return () => { cancelled = true; };
  }, [sessionId, sessionData]);

  useEffect(() => {
    const handleUnload = () => {
      if (!stopSentRef.current && (SESSION_STATUSES.RUNNING === statusRef.current || SESSION_STATUSES.PREPARING === statusRef.current)) {
        navigator.sendBeacon(`${BASE_URL}/sessions/${sessionId}/stop`);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [sessionId]);

  useEffect(() => {
    const epoch = ++mountEpochRef.current;
    return () => {
      queueMicrotask(() => {
        if (mountEpochRef.current !== epoch) return;
        if (!stopSentRef.current && (SESSION_STATUSES.RUNNING === statusRef.current || SESSION_STATUSES.PREPARING === statusRef.current)) {
          apiClient.post(`/sessions/${sessionId}/stop`, {}).catch(() => {});
        }
      });
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

  const handleStop = useCallback(async () => {
    if (!sessionId || stopSession.isPending) return;
    stopSentRef.current = true;
    try {
      const stopped = await stopSession.mutateAsync(sessionId);
      setStatus(stopped.status);
      options.onResults?.(elapsedSeconds);
    } catch (error) {
      stopSentRef.current = false;
      setStartError({ code: 'STOP_FAILED', message: error instanceof Error ? error.message : 'Не удалось завершить сессию' });
    }
  }, [sessionId, stopSession, options, elapsedSeconds]);

  const idleTimeout = useSessionIdleTimeout({
    enabled: false,
    onTimeout: handleStop,
  });

  const handleRetry = useCallback(() => {
    stopSentRef.current = true;
    stopSession.mutate(sessionId);
    options.onBack();
  }, [sessionId, stopSession, options]);

  const handleRestart = useCallback(async () => {
    if (!sessionId || restartSession.isPending) return;
    stopSentRef.current = true;
    setRestartError(null);
    try {
      const replacement = await restartSession.mutateAsync(sessionId);
      options.onRestart(replacement.id);
    } catch (err) {
      stopSentRef.current = false;
      setRestartError(err instanceof ApiError ? err.message : 'Не удалось перезапустить сессию');
    }
  }, [options, restartSession, sessionId]);

  const handleSendMessage = useCallback(async (text: string) => {
    if (sendingRef.current || statusRef.current !== 'RUNNING') return false;
    sendingRef.current = true;
    setIsSending(true); setSendError(null);
    try {
      if (options.sendMessage) await options.sendMessage(text);
      else await sendMessageMutation.mutateAsync({ sessionId, text });
      addUserMessage(text);
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Неизвестная ошибка';
      setSendError(message);
      return false;
    } finally { sendingRef.current = false; setIsSending(false); }
  }, [sessionId, sendMessageMutation, addUserMessage, options]);

  return {
    status,
    connectArgs,
    messages,
    elapsedSeconds,
    startError,
    difficulty: sessionData?.difficulty ?? 1,
    handleStop,
    handleSendMessage,
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
    sendError,
    isSendPending: isSending || sendMessageMutation.isPending,
  };
}
