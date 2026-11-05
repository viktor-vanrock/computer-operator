import { z } from 'zod';

import { MODERATION_REASONS } from './moderation.types.js';

export const ModerationValidateSchema = z.object({
  text: z.string().trim().min(1),
});

export const ModerationValidationResponseSchema = z.object({
  allowed: z.literal(true),
  validationToken: z.string().min(1),
});

export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_at: z.number().int().positive(),
});

export const OAuthErrorSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  error: z.string().optional(),
});

export const ChatResponseSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    message: z.object({ content: z.string().min(1) }),
    finish_reason: z.string().optional(),
    index: z.number().int().optional(),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
});

export const VerdictSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('allow') }).strict(),
  z.object({ decision: z.literal('reject'), reason: z.enum(MODERATION_REASONS) }).strict(),
]);

export const ProviderVerdictSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('allow') }).strict(),
  z.object({ decision: z.literal('reject'), reason: z.string().min(1) }).strict(),
]);
