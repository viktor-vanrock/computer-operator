import { formatHotkeyCombo, getOutcomeLabel, isFinishedThought, parseAgentThoughtPayload, parseSoloAgentThoughtPayload, resolveFinishedMessageFields, resolveFinishedText, resolveOutcomeMessageFields, resolveOutcomeStatus } from '@arena/ui/lib/agent-thought';
import type { AgentThoughtPayload } from '@arena/ui/types/chat.types';
import type { AgentOutcomePayload } from '@arena/ui/types/websocket.types';
import { describe, expect, it } from 'vitest';

const base: AgentThoughtPayload = {
  step: 1,
  thought: '',
  action_type: 'click',
};

describe('resolveOutcomeStatus', () => {
  it('возвращает "success" для known статуса', () => {
    expect(resolveOutcomeStatus('success')).toBe('success');
  });

  it('возвращает "failed" для known статуса', () => {
    expect(resolveOutcomeStatus('failed')).toBe('failed');
  });

  it('возвращает "cancelled" для known статуса', () => {
    expect(resolveOutcomeStatus('cancelled')).toBe('cancelled');
  });

  it('возвращает undefined для неизвестного статуса (сырой статус идёт в rawOutcomeStatus)', () => {
    expect(resolveOutcomeStatus('partial')).toBeUndefined();
    expect(resolveOutcomeStatus('aborted')).toBeUndefined();
  });

  it('возвращает undefined для пустой строки и undefined', () => {
    expect(resolveOutcomeStatus('')).toBeUndefined();
    expect(resolveOutcomeStatus(undefined)).toBeUndefined();
  });
});

describe('formatHotkeyCombo', () => {
  it('форматирует комбинацию клавиш', () => {
    expect(formatHotkeyCombo('<ctrl>+<a>')).toBe('Ctrl+A');
  });
});

describe('getOutcomeLabel', () => {
  it('возвращает русские лейблы для known статусов', () => {
    expect(getOutcomeLabel('success')).toBe('Завершено');
    expect(getOutcomeLabel('failed')).toBe('Не выполнено');
    expect(getOutcomeLabel('cancelled')).toBe('Отменено');
  });

  it('возвращает undefined для отсутствующего статуса', () => {
    expect(getOutcomeLabel(undefined)).toBeUndefined();
  });
});

describe('resolveFinishedText', () => {
  it('возвращает исходный текст если он непустой', () => {
    expect(resolveFinishedText('Задача выполнена', 'success')).toBe('Задача выполнена');
    expect(resolveFinishedText('Не получилось', 'failed')).toBe('Не получилось');
    expect(resolveFinishedText('Текст', undefined)).toBe('Текст');
  });

  it('возвращает русскую заглушку для failed при пустом тексте', () => {
    expect(resolveFinishedText('', 'failed')).toBe('Агент не смог выполнить задачу');
  });

  it('возвращает русскую заглушку для cancelled при пустом тексте', () => {
    expect(resolveFinishedText('', 'cancelled')).toBe('Задача была отменена');
  });

  it('возвращает нейтральную заглушку для success при пустом тексте', () => {
    expect(resolveFinishedText('', 'success')).toBe('Агент завершил работу');
  });

  it('возвращает нейтральную заглушку при unknown outcome и пустом тексте', () => {
    expect(resolveFinishedText('', undefined)).toBe('Агент завершил работу');
  });
});

describe('resolveFinishedMessageFields', () => {
  it('known status: outcomeStatus и rawOutcomeStatus оба заполнены', () => {
    const payload: AgentThoughtPayload = { ...base, status: 'failed', done: true, thought: 'Ошибка' };
    const fields = resolveFinishedMessageFields('Ошибка', payload);
    expect(fields.outcomeStatus).toBe('failed');
    expect(fields.rawOutcomeStatus).toBe('failed');
    expect(fields.thought).toBe('Ошибка');
  });

  it('unknown status: outcomeStatus undefined, rawOutcomeStatus = сырая строка', () => {
    const payload: AgentThoughtPayload = { ...base, status: 'partial', done: true, thought: '' };
    const fields = resolveFinishedMessageFields('', payload);
    expect(fields.outcomeStatus).toBeUndefined();
    expect(fields.rawOutcomeStatus).toBe('partial');
  });

  it('нет status: оба поля отсутствуют', () => {
    const payload: AgentThoughtPayload = { ...base, action_type: 'done' };
    const fields = resolveFinishedMessageFields('Готово', payload);
    expect(fields.outcomeStatus).toBeUndefined();
    expect(fields.rawOutcomeStatus).toBeUndefined();
  });
});

describe('parseAgentThoughtPayload (legacy JSON)', () => {
  it('валидный JSON парсится в AgentThoughtPayload', () => {
    const payload = parseAgentThoughtPayload(JSON.stringify({ step: 1, thought: 'Готово', action_type: 'done' }));
    expect(payload).toEqual({ step: 1, thought: 'Готово', action_type: 'done' });
  });

  it('невалидный JSON → null', () => {
    expect(parseAgentThoughtPayload('Браузер успешно открыт. Задача выполнена.')).toBeNull();
  });

  it('пустая строка → null', () => {
    expect(parseAgentThoughtPayload('')).toBeNull();
  });
});

describe('parseSoloAgentThoughtPayload (с фолбэком на plain text — только SOLO v1)', () => {
  it('валидный JSON парсится так же, как parseAgentThoughtPayload', () => {
    const payload = parseSoloAgentThoughtPayload(JSON.stringify({ step: 1, thought: 'Готово', action_type: 'done' }));
    expect(payload).toEqual({ step: 1, thought: 'Готово', action_type: 'done' });
  });

  it('невалидный JSON (SOLO v1 plain text) → фолбэк-объект с исходным текстом в thought', () => {
    const payload = parseSoloAgentThoughtPayload('Браузер успешно открыт. Задача выполнена.');
    expect(payload).toEqual({ step: 0, thought: 'Браузер успешно открыт. Задача выполнена.' });
  });

  it('фолбэк для plain text не считается финальным (нет status/done/action_type)', () => {
    const payload = parseSoloAgentThoughtPayload('Мне нужно открыть браузер.');
    expect(payload).not.toBeNull();
    expect(isFinishedThought(payload!)).toBe(false);
  });

  it('пустая строка → null (нет смысла показывать пустое сообщение)', () => {
    expect(parseSoloAgentThoughtPayload('')).toBeNull();
  });
});

describe('resolveOutcomeMessageFields (AGENT_OUTCOME SOLO)', () => {
  const base: AgentOutcomePayload = { step: 2, ts: 1788429347748, kind: 'finished', value: 'positive' };

  it('finished/positive → outcomeStatus success, нейтральный фолбэк-текст без speak', () => {
    const fields = resolveOutcomeMessageFields(base);
    expect(fields.outcomeStatus).toBe('success');
    expect(fields.rawOutcomeStatus).toBe('finished:positive');
    expect(fields.thought).toBe('Агент завершил работу');
    expect(fields.actionType).toBe('done');
  });

  it('finished/negative → outcomeStatus failed, фолбэк "не смог выполнить"', () => {
    const fields = resolveOutcomeMessageFields({ ...base, kind: 'finished', value: 'negative' });
    expect(fields.outcomeStatus).toBe('failed');
    expect(fields.thought).toBe('Агент не смог выполнить задачу');
  });

  it('aborted/user → outcomeStatus cancelled, фолбэк "задача отменена"', () => {
    const fields = resolveOutcomeMessageFields({ ...base, kind: 'aborted', value: 'user' });
    expect(fields.outcomeStatus).toBe('cancelled');
    expect(fields.thought).toBe('Задача была отменена');
  });

  it('неизвестная комбинация kind/value (aborted/env) → outcomeStatus undefined, rawOutcomeStatus хранит сырую пару', () => {
    const fields = resolveOutcomeMessageFields({ ...base, kind: 'aborted', value: 'env' });
    expect(fields.outcomeStatus).toBeUndefined();
    expect(fields.rawOutcomeStatus).toBe('aborted:env');
    expect(fields.thought).toBe('Агент завершил работу');
  });

  it('payload.speak приоритетнее фолбэк-текста', () => {
    const fields = resolveOutcomeMessageFields({ ...base, speak: 'Задача успешно завершена агентом' });
    expect(fields.thought).toBe('Задача успешно завершена агентом');
  });
});

describe('isFinishedThought + resolveOutcomeStatus интеграция', () => {
  it('финальный пэйлоад success распознаётся как finished с outcomeStatus success', () => {
    const payload: AgentThoughtPayload = { ...base, status: 'success', done: true };
    expect(isFinishedThought(payload)).toBe(true);
    expect(resolveOutcomeStatus(payload.status)).toBe('success');
  });

  it('финальный пэйлоад failed распознаётся как finished с outcomeStatus failed', () => {
    const payload: AgentThoughtPayload = { ...base, status: 'failed', done: true };
    expect(isFinishedThought(payload)).toBe(true);
    expect(resolveOutcomeStatus(payload.status)).toBe('failed');
  });

  it('финальный пэйлоад cancelled распознаётся как finished с outcomeStatus cancelled', () => {
    const payload: AgentThoughtPayload = { ...base, status: 'cancelled', done: true };
    expect(isFinishedThought(payload)).toBe(true);
    expect(resolveOutcomeStatus(payload.status)).toBe('cancelled');
  });

  it('неизвестный статус: isFinished=true, outcomeStatus=undefined (rawOutcomeStatus передаётся отдельно)', () => {
    const payload: AgentThoughtPayload = { ...base, status: 'partial', done: true };
    expect(isFinishedThought(payload)).toBe(true);
    expect(resolveOutcomeStatus(payload.status)).toBeUndefined();
  });

  it('action_type done без status даёт finished с outcomeStatus undefined', () => {
    const payload: AgentThoughtPayload = { ...base, action_type: 'done' };
    expect(isFinishedThought(payload)).toBe(true);
    expect(resolveOutcomeStatus(payload.status)).toBeUndefined();
  });

  it('нефинальный пэйлоад не даёт finished', () => {
    expect(isFinishedThought(base)).toBe(false);
  });
});
