import type { AgentThoughtPayload, TaskOutcomeStatus } from '../types/chat.types';
import type { AgentOutcomePayload } from '../types/websocket.types';

const KNOWN_OUTCOME_STATUSES: ReadonlySet<string> = new Set<TaskOutcomeStatus>(['success', 'failed', 'cancelled']);

/** SOLO v1 передаёт финал задачи не полем status внутри AGENT_THOUGHT, а отдельным
 *  событием AGENT_OUTCOME с парой kind/value — сопоставляем её с тем же TaskOutcomeStatus,
 *  которым пользуется остальной UI (см. mapSoloOutcome на backend). */
const OUTCOME_KIND_VALUE_TO_STATUS: Readonly<Record<string, TaskOutcomeStatus>> = {
  'finished:positive': 'success',
  'finished:negative': 'failed',
  'aborted:user': 'cancelled',
};

/** Мысль считается финализирующей, если пришло поле status, done: true, или action_type done/finished */
export function isFinishedThought(parsed: AgentThoughtPayload): boolean {
  return undefined !== parsed.status
    || true === parsed.done
    || 'done' === parsed.action_type
    || 'finished' === parsed.action_type;
}

/** Переводит строковый status из пэйлоада агента в типизированный TaskOutcomeStatus.
 *  Неизвестные значения возвращают undefined — сырой статус хранится в rawOutcomeStatus для отображения. */
export function resolveOutcomeStatus(status: string | undefined): TaskOutcomeStatus | undefined {
  if (!status || !KNOWN_OUTCOME_STATUSES.has(status)) return undefined;
  return status as TaskOutcomeStatus;
}

/** Возвращает локализованный лейбл для бейджа по известному статусу. */
export function getOutcomeLabel(outcomeStatus: TaskOutcomeStatus | undefined): string | undefined {
  switch (outcomeStatus) {
    case 'success': return 'Завершено';
    case 'failed': return 'Не выполнено';
    case 'cancelled': return 'Отменено';
    default: return undefined;
  }
}

/** Возвращает текст финальной мысли с осмысленным фолбэком для любого статуса завершения. */
export function resolveFinishedText(text: string, outcomeStatus: TaskOutcomeStatus | undefined): string {
  if (text) return text;
  if ('failed' === outcomeStatus) return 'Агент не смог выполнить задачу';
  if ('cancelled' === outcomeStatus) return 'Задача была отменена';
  return 'Агент завершил работу';
}

interface FinishedMessageFields {
  thought: string;
  actionType: string;
  outcomeStatus?: TaskOutcomeStatus;
  rawOutcomeStatus?: string;
}

/** Общая сборка полей финального сообщения — используется и для статуса, пришедшего
 *  JSON-полем status (resolveFinishedMessageFields), и для статуса из AGENT_OUTCOME
 *  kind/value (resolveOutcomeMessageFields); разнится только то, как эти два формата
 *  находят outcomeStatus/rawOutcomeStatus. */
function buildFinishedMessageFields(
  text: string, actionType: string, outcomeStatus: TaskOutcomeStatus | undefined, rawOutcomeStatus: string | undefined
): FinishedMessageFields {
  return {
    thought: resolveFinishedText(text, outcomeStatus),
    actionType,
    ...(undefined !== outcomeStatus && { outcomeStatus }),
    ...(undefined !== rawOutcomeStatus && { rawOutcomeStatus }),
  };
}

/** Собирает поля финального сообщения агента из пэйлоада — одно место для обоих SOLO-хуков. */
export function resolveFinishedMessageFields(text: string, parsed: AgentThoughtPayload): FinishedMessageFields {
  return buildFinishedMessageFields(text, parsed.action_type ?? 'done', resolveOutcomeStatus(parsed.status), parsed.status);
}

/** Собирает поля финального сообщения агента из AGENT_OUTCOME (SOLO v1) — аналог
 *  resolveFinishedMessageFields, но источник статуса — kind/value, а не JSON-поле status. */
export function resolveOutcomeMessageFields(payload: AgentOutcomePayload): FinishedMessageFields {
  const rawOutcomeStatus = `${payload.kind}:${payload.value}`;
  return buildFinishedMessageFields(payload.speak ?? '', 'done', OUTCOME_KIND_VALUE_TO_STATUS[rawOutcomeStatus], rawOutcomeStatus);
}

export function parseAgentThoughtPayload(description: string): AgentThoughtPayload | null {
  try {
    return JSON.parse(description) as AgentThoughtPayload;
  } catch {
    return null;
  }
}

/** Legacy helper: при неудачном JSON-парсинге считает значение обычным текстом мысли. */
export function parseSoloAgentThoughtPayload(description: string): AgentThoughtPayload | null {
  const parsed = parseAgentThoughtPayload(description);
  if (parsed) return parsed;
  if (!description) return null;
  return { step: 0, thought: description };
}

/** Форматирует action_inputs.hotkey в компактную комбинацию клавиш для ленты. */
export function formatHotkeyCombo(raw: string): string {
  return raw
    .split('+')
    .map((part) => {
      const token = part.trim().replace(/^<|>$/g, '');
      return token.length <= 1 ? token.toUpperCase() : token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join('+');
}
