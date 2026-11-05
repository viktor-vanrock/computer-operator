import { useCallback, useEffect, useRef, useState } from 'react';

export const SESSION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const SESSION_IDLE_WARNING_MS = 60 * 1000;
const COUNTDOWN_INTERVAL_MS = 250;

interface UseSessionIdleTimeoutOptions {
  enabled: boolean;
  onTimeout: () => void;
  timeoutMs?: number;
  warningMs?: number;
}

interface SessionIdleTimeout {
  isWarningOpen: boolean;
  secondsRemaining: number;
  reportActivity: () => void;
  continueSession: () => void;
  endSession: () => void;
}

export function useSessionIdleTimeout({
  enabled,
  onTimeout,
  timeoutMs = SESSION_IDLE_TIMEOUT_MS,
  warningMs = SESSION_IDLE_WARNING_MS,
}: UseSessionIdleTimeoutOptions): SessionIdleTimeout {
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => { onTimeoutRef.current = onTimeout; });

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const deadlineRef = useRef(0);
  const timedOutRef = useRef(false);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(Math.ceil(warningMs / 1000));

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    warningTimerRef.current = null;
    timeoutTimerRef.current = null;
    countdownTimerRef.current = null;
  }, []);

  const finish = useCallback(() => {
    if (timedOutRef.current) return;
    timedOutRef.current = true;
    clearTimers();
    setIsWarningOpen(false);
    onTimeoutRef.current();
  }, [clearTimers]);

  const updateCountdown = useCallback(() => {
    const remainingMs = deadlineRef.current - Date.now();
    if (remainingMs <= 0) {
      finish();
      return;
    }
    setSecondsRemaining(Math.ceil(remainingMs / 1000));
  }, [finish]);

  const openWarning = useCallback(() => {
    if (!enabledRef.current || timedOutRef.current) return;
    setIsWarningOpen(true);
    updateCountdown();
    countdownTimerRef.current = setInterval(updateCountdown, COUNTDOWN_INTERVAL_MS);
  }, [updateCountdown]);

  const startIdlePeriod = useCallback(() => {
    clearTimers();
    timedOutRef.current = false;
    setIsWarningOpen(false);
    setSecondsRemaining(Math.ceil(warningMs / 1000));
    if (!enabledRef.current) return;

    deadlineRef.current = Date.now() + timeoutMs;
    warningTimerRef.current = setTimeout(openWarning, Math.max(0, timeoutMs - warningMs));
    timeoutTimerRef.current = setTimeout(finish, timeoutMs);
  }, [clearTimers, finish, openWarning, timeoutMs, warningMs]);

  useEffect(() => {
    startIdlePeriod();
    return clearTimers;
  }, [enabled, startIdlePeriod, clearTimers]);

  const reportActivity = useCallback(() => {
    if (!enabledRef.current || isWarningOpen) return;
    startIdlePeriod();
  }, [isWarningOpen, startIdlePeriod]);

  const continueSession = useCallback(() => {
    if (!enabledRef.current) return;
    startIdlePeriod();
  }, [startIdlePeriod]);

  return {
    isWarningOpen,
    secondsRemaining,
    reportActivity,
    continueSession,
    endSession: finish,
  };
}
