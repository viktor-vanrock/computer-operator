import { useAgentThoughts } from '@arena/ui/hooks/use-agent-thoughts';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('useAgentThoughts — Agent Manager WS v1', () => {
  it('добавляет текст STEP как сообщение агента', () => {
    const { result } = renderHook(() => useAgentThoughts());
    act(() => {
      result.current.handleWsEvent({
        type: 'AGENT_THOUGHT',
        payload: { step: 1, ts: 1, text: 'Открываю браузер', status: 'INCOMPLETE' },
      });
    });
    expect(result.current.messages[0]).toEqual(expect.objectContaining({ kind: 'agent', thought: 'Открываю браузер' }));
    expect(result.current.isTaskDone).toBe(false);
  });

  it('добавляет action_type из STEP для отображения бейджа', () => {
    const { result } = renderHook(() => useAgentThoughts());
    act(() => {
      result.current.handleWsEvent({
        type: 'AGENT_THOUGHT',
        payload: {
          step: 19,
          ts: 1788514020719,
          text: 'Перехожу на ozon.ru',
          status: 'INCOMPLETE',
          thought: 'Мне нужно перейти на ozon.ru',
          action_type: 'click',
          action_inputs: { point: [291, 115] },
          action_explanation: 'Нажимаю на адресную строку',
        },
      });
    });

    expect(result.current.messages[0]).toEqual(expect.objectContaining({
      kind: 'agent',
      thought: 'Мне нужно перейти на ozon.ru',
      actionType: 'click',
      actionInputs: { point: [291, 115] },
    }));
  });

  it('игнорирует STEP с пустым текстом', () => {
    const { result } = renderHook(() => useAgentThoughts());
    act(() => {
      result.current.handleWsEvent({
        type: 'AGENT_THOUGHT',
        payload: { step: 2, ts: 2, text: '', status: 'INCOMPLETE' },
      });
    });
    expect(result.current.messages).toEqual([]);
  });

  it('AGENT_OUTCOME добавляет итог и завершает задачу', () => {
    const { result } = renderHook(() => useAgentThoughts());
    act(() => {
      result.current.handleWsEvent({
        type: 'AGENT_OUTCOME',
        payload: { step: 3, ts: 3, kind: 'finished', value: 'positive' },
      });
    });
    expect(result.current.messages[0]).toEqual(expect.objectContaining({
      kind: 'agent', thought: 'Агент завершил работу', outcomeStatus: 'success',
    }));
    expect(result.current.isTaskDone).toBe(true);
  });

  it('не дублирует повторный AGENT_OUTCOME', () => {
    const { result } = renderHook(() => useAgentThoughts());
    const event = {
      type: 'AGENT_OUTCOME' as const,
      payload: { step: 3, ts: 3, kind: 'finished' as const, value: 'positive' as const },
    };
    act(() => {
      result.current.handleWsEvent(event);
      result.current.handleWsEvent(event);
    });
    expect(result.current.messages).toHaveLength(1);
  });

  it('AGENT_ERROR добавляет системное сообщение', () => {
    const { result } = renderHook(() => useAgentThoughts());
    act(() => {
      result.current.handleWsEvent({
        type: 'AGENT_ERROR',
        payload: { code: 'session_timeout', message: 'Критическая ошибка', fatal: true },
      });
    });
    expect(result.current.messages[0]).toEqual(expect.objectContaining({ kind: 'system', text: 'Критическая ошибка' }));
  });

  it('markTaskDone(false) разрешает принять итог следующей задачи', () => {
    const { result } = renderHook(() => useAgentThoughts());
    const event = {
      type: 'AGENT_OUTCOME' as const,
      payload: { step: 1, ts: 1, kind: 'finished' as const, value: 'positive' as const },
    };
    act(() => { result.current.handleWsEvent(event); });
    act(() => { result.current.markTaskDone(false); });
    act(() => { result.current.handleWsEvent(event); });
    expect(result.current.messages).toHaveLength(2);
  });

  it('reset очищает сообщения и состояние завершения', () => {
    const { result } = renderHook(() => useAgentThoughts());
    act(() => {
      result.current.addUserMessage('Задача');
      result.current.markTaskDone(true);
    });
    act(() => { result.current.reset(); });
    expect(result.current.messages).toEqual([]);
    expect(result.current.isTaskDone).toBe(false);
  });
});
