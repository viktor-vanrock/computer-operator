import { WsEventSchema } from '@arena/ui/lib/ws-event.schema';
import { describe, expect, it } from 'vitest';

describe('WsEventSchema', () => {
  it('валидирует METRICS_UPDATE', () => {
    const event = {
      type: 'METRICS_UPDATE',
      payload: { participant: 'HUMAN', time: 1500, steps: 4, clicks: 6, errors: 0, retries: 0 },
    };
    expect(() => WsEventSchema.parse(event)).not.toThrow();
  });

  it('валидирует STATUS_CHANGE', () => {
    const event = { type: 'STATUS_CHANGE', payload: { status: 'COMPLETED' } };
    expect(() => WsEventSchema.parse(event)).not.toThrow();
  });

  it('валидирует STEP_COMPLETE', () => {
    const event = { type: 'STEP_COMPLETE', payload: { stepIndex: 2, description: 'Нажали кнопку' } };
    expect(() => WsEventSchema.parse(event)).not.toThrow();
  });

  it('валидирует полный STEP-конверт Agent Manager как AGENT_THOUGHT', () => {
    const event = {
      type: 'AGENT_THOUGHT',
      payload: { step: 2, ts: 123, text: 'Нажимаю кнопку', status: 'INCOMPLETE' },
    };
    expect(() => WsEventSchema.parse(event)).not.toThrow();
  });

  it('сохраняет диагностические поля в AGENT_THOUGHT', () => {
    const event = WsEventSchema.parse({
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

    expect(event.payload).toMatchObject({
      action_type: 'click',
      action_inputs: { point: [291, 115] },
      action_explanation: 'Нажимаю на адресную строку',
    });
  });

  it('принимает press action для хоткеев', () => {
    expect(() => WsEventSchema.parse({
      type: 'AGENT_THOUGHT',
      payload: { step: 15, ts: 1, text: 'Нажимаю сочетание', status: 'INCOMPLETE', action_type: 'press' },
    })).not.toThrow();
  });

  it('принимает неизвестный action_type, чтобы UI мог показать его без потери мысли', () => {
    expect(() => WsEventSchema.parse({
      type: 'AGENT_THOUGHT',
      payload: { step: 16, ts: 2, text: 'Действие', status: 'INCOMPLETE', action_type: 'future_action' },
    })).not.toThrow();
  });

  it('отклоняет старый AGENT_THOUGHT с description', () => {
    const event = { type: 'AGENT_THOUGHT', payload: { description: 'Нажимаю кнопку' } };
    expect(() => WsEventSchema.parse(event)).toThrow();
  });

  it('отклоняет неизвестный тип события', () => {
    const event = { type: 'UNKNOWN_EVENT', payload: {} };
    expect(() => WsEventSchema.parse(event)).toThrow();
  });

  it('отклоняет отрицательные метрики', () => {
    const event = {
      type: 'METRICS_UPDATE',
      payload: { participant: 'AGENT', time: -100, steps: 0, clicks: 0, errors: 0, retries: 0 },
    };
    expect(() => WsEventSchema.parse(event)).toThrow();
  });
});

describe('race outbound WS', () => {
  it('accepts an ordered action only with its session identity', () => {
    const action = { id: 'event', sessionId: 'session', sequence: 1, eventId: 'event', participant: 'HUMAN',
      occurredAt: '2026-10-09T00:00:00Z', receivedAt: '2026-10-09T00:00:00Z', kind: 'CLICK', details: { x: 0, y: 1, button: 'left' }, text: null, step: null };
    expect(WsEventSchema.parse({ type: 'RACE_ACTION', payload: { sessionId: 'session', action } }).type).toBe('RACE_ACTION');
    expect(WsEventSchema.safeParse({ type: 'RACE_ACTION', payload: { action } }).success).toBe(false);
    expect(WsEventSchema.safeParse({ type: 'RACE_ACTION', payload: { sessionId: 'session', action: { ...action, sequence: 0 } } }).success).toBe(false);
  });
});
