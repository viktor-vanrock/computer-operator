import type { SessionMode } from '@arena/ui/types/session.types';

export const ROUTES = {
  TASKS: '/tasks',
  TASKS_SOLO: '/tasks/solo',
  TASKS_FULL_DUPLEX: '/tasks/full-duplex',
  TASKS_HUMAN_AGENT: '/tasks/human-vs-agent',
  TASK_MANAGEMENT: '/task-management',
  ARENA: '/arena/:sessionId',
  RESULTS: '/arena/:sessionId/results',
} as const;

export const MODE_TO_ROUTE: Record<SessionMode, string> = {
  SOLO: ROUTES.TASKS_SOLO,
  FULL_DUPLEX: ROUTES.TASKS_FULL_DUPLEX,
  HUMAN_VS_AGENT: ROUTES.TASKS_HUMAN_AGENT,
};
