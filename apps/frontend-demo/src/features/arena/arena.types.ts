export type { ActionType, AgentThoughtPayload, ChatMessage } from '@arena/ui/types/chat.types';
export { ACTION_TYPE_LABELS } from '@arena/ui/types/chat.types';

export interface ArenaSession {
  sessionId: string
  taskTitle: string
  difficulty: number
}

export interface PreparingStep {
  icon: React.ReactNode
  label: string
  duration: number
}

/**
 * Клик, пойманный на нашей стороне через `Guacamole.Mouse` поверх Guacamole canvas.
 */
export interface AgentClick {
  id: string
  x: number // относительная [0, 1] от ширины Guacamole-дисплея
  y: number // относительная [0, 1] от высоты Guacamole-дисплея
  timestamp: number
}

export type DoneStatus = 'success' | 'failure' | 'unknown';

export interface ParsedDoneContent {
  status: DoneStatus;
  message: string;
}
