export const ACTION_TYPES = [
  'click',
  'left_double',
  'right_single',
  'triple_click',
  'move',
  'mouse_move',
  'drag',
  'hotkey',
  'press',
  'type',
  'scroll',
  'wait',
  'delay',
  'finished',
  'done',
] as const;

export type KnownActionType = (typeof ACTION_TYPES)[number];
export type ActionType = KnownActionType | (string & {});

export const ACTION_TYPE_LABELS: Record<KnownActionType, string> = {
  click: 'Клик',
  left_double: 'Двойной клик',
  right_single: 'Правый клик',
  triple_click: 'Тройной клик',
  move: 'Перемещение',
  mouse_move: 'Перемещение',
  drag: 'Перетаскивание',
  hotkey: 'Горячие клавиши',
  press: 'Горячие клавиши',
  type: 'Ввод текста',
  scroll: 'Прокрутка',
  wait: 'Ожидание',
  delay: 'Ожидание',
  finished: 'Завершено',
  done: 'Завершено',
};

/** Legacy-формат мысли агента, сохранённый для совместимости утилит отображения. */
export interface AgentThoughtPayload {
  step: number
  thought: string
  action_type?: string
  action_explanation?: string
  action_inputs?: { content?: string; [k: string]: unknown }
  status?: string;
  done?: boolean;
}

export type OutcomeValue = 'positive' | 'negative' | 'user' | 'env';

export type TaskOutcomeStatus = 'success' | 'failed' | 'cancelled';

export type ChatMessage =
  | { kind: 'agent'; id: string; thought: string; actionType?: string; actionInputs?: Record<string, unknown>; details?: Record<string, unknown>; outcomeStatus?: TaskOutcomeStatus; rawOutcomeStatus?: string; receivedAt: string }
  | { kind: 'user'; id: string; text: string; receivedAt: string }
  | { kind: 'system'; id: string; text: string; receivedAt: string }
  | { kind: 'outcome'; id: string; text: string; value: OutcomeValue; receivedAt: string };
