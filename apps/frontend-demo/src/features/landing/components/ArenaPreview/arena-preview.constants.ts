import type { ArenaState } from './arena-preview.types';

export const HUMAN_TOTAL = 120;
export const AGENT_TOTAL = 72;

export const AGENT_ACTIONS = [
  'Анализирую',
  'Генерирую',
  'Изучаю',
  'Сканирую',
  'Обрабатываю',
  'Вычисляю',
  'Проверяю',
  'Оптимизирую',
  'Навигирую',
  'Извлекаю',
] as const;

export const INITIAL_STATE: ArenaState = {
  phase: 'running',
  elapsed: 0,
  agentActionIdx: 0,
  cycleKey: 0,
};
