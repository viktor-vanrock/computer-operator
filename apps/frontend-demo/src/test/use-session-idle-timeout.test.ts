import { useSessionIdleTimeout } from '@arena/ui/hooks/use-session-idle-timeout';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('useSessionIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('показывает предупреждение и завершает после дедлайна', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useSessionIdleTimeout({
      enabled: true,
      onTimeout,
      timeoutMs: 10_000,
      warningMs: 2_000,
    }));

    act(() => { vi.advanceTimersByTime(8_000); });
    expect(result.current.isWarningOpen).toBe(true);
    expect(result.current.secondsRemaining).toBe(2);

    act(() => { vi.advanceTimersByTime(2_000); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(result.current.isWarningOpen).toBe(false);
  });

  it('активность формы переносит дедлайн', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useSessionIdleTimeout({
      enabled: true,
      onTimeout,
      timeoutMs: 10_000,
      warningMs: 2_000,
    }));

    act(() => { vi.advanceTimersByTime(7_000); });
    act(() => { result.current.reportActivity(); });
    act(() => { vi.advanceTimersByTime(3_000); });

    expect(result.current.isWarningOpen).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('продление из предупреждения запускает новый период', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useSessionIdleTimeout({
      enabled: true,
      onTimeout,
      timeoutMs: 10_000,
      warningMs: 2_000,
    }));

    act(() => { vi.advanceTimersByTime(8_000); });
    act(() => { result.current.continueSession(); });
    expect(result.current.isWarningOpen).toBe(false);

    act(() => { vi.advanceTimersByTime(9_999); });
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('не запускает таймер, пока форма закрыта', () => {
    const onTimeout = vi.fn();
    renderHook(() => useSessionIdleTimeout({ enabled: false, onTimeout, timeoutMs: 10_000 }));

    act(() => { vi.advanceTimersByTime(20_000); });
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
