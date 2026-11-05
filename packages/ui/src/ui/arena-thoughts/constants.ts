import { ACTION_TYPE_LABELS, type KnownActionType } from '../../types/chat.types';

import styles from './arena-thoughts.module.css';

/** actionType отсутствует для SOLO v1 plain-text мыслей агента (нет классификации действия) —
 *  в этом случае бейдж действия не рендерится вовсе. */
export function getActionLabel(actionType: string | undefined, actionInputs?: Record<string, unknown>): string | undefined {
  if (!actionType) return undefined;
  if ('click' === actionType) {
    return getClickLabel(actionInputs?.['button'], actionInputs?.['count']);
  }
  return Object.hasOwn(ACTION_TYPE_LABELS, actionType)
    ? ACTION_TYPE_LABELS[actionType as KnownActionType]
    : actionType;
}

function getClickLabel(button: unknown, count: unknown): string {
  const isRight = 'right' === button;
  const n = 'number' === typeof count && 0 < count ? count : 1;
  if (1 === n) return isRight ? 'Правый клик' : 'Клик';
  if (2 === n) return isRight ? 'Двойной правый клик' : 'Двойной клик';
  if (3 === n) return isRight ? 'Тройной правый клик' : 'Тройной клик';
  return isRight ? `Правый клик ×${n}` : `Клик ×${n}`;
}

export function getActionModifier(actionType: string | undefined): string {
  switch (actionType) {
    case 'click':
    case 'left_double':
    case 'right_single':
    case 'drag':
    case 'scroll':
    case 'move':
    case 'mouse_move':
    case 'triple_click':
      return styles['badgeAction'] ?? '';
    case 'type':
    case 'hotkey':
    case 'press':
      return styles['badgeInput'] ?? '';
    case 'wait':
    case 'delay':
      return styles['badgeWait'] ?? '';
    case 'finished':
    case 'done':
      return styles['badgeFinished'] ?? '';
    default:
      return styles['badgeDefault'] ?? '';
  }
}
