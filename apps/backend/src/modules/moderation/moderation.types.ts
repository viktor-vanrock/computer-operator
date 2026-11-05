export const MODERATION_REASONS = [
  'profanity',
  'sexual_content',
  'violence',
  'hate_or_harassment',
  'illegal_activity',
  'personal_data',
  'prompt_injection',
  'not_a_task',
  'meaningless_or_too_vague',
  'task_too_long',
  'provider_blacklist',
  'provider_reject',
] as const;

export type ModerationReason = (typeof MODERATION_REASONS)[number];

export type ModerationResult =
  | { decision: 'allow' }
  | { decision: 'reject'; reason: ModerationReason };

export interface TaskModerator {
  moderate(text: string, signal?: AbortSignal): Promise<ModerationResult>;
}
