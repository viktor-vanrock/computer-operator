import { z } from 'zod';

export const SoloDiagnosticsLevelSchema = z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL', 'FATAL']);
export const SoloStepStatusSchema = z.enum(['INCOMPLETE', 'DONE', 'FAILED', 'CANCELLED']);

const SoloModelActionSchema = z.object({
  action_type: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const SoloModelCompletionSchema = z.object({
  thought: z.string().optional(),
  action_explanation: z.string().optional(),
  actions: z.array(SoloModelActionSchema).optional(),
});

const SoloStepDiagnosticsSchema = z.object({
  event: z.string(),
  completion: z.string().optional(),
  action: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const SoloStepMessageSchema = z.object({
  type: z.literal('STEP'),
  ts: z.number(),
  step: z.number().int().nonnegative(),
  text: z.string().nullable().transform((text) => text ?? ''),
  status: SoloStepStatusSchema,
  diagnostics: z.array(SoloStepDiagnosticsSchema).optional(),
});

// Помимо ts/level/event протокол допускает произвольные дополнительные поля,
// зависящие от конкретного event (список которых в протоколе не зафиксирован).
// Базовые поля валидируются строго типизированно; для остального хранится
// только исходная JSON-строка — используется исключительно для логирования.
export const SoloDiagnosticsMessageSchema = z.object({
  type: z.literal('DIAGNOSTICS'),
  ts: z.number(),
  level: SoloDiagnosticsLevelSchema,
  event: z.string(),
});

export const SoloImAliveMessageSchema = z.object({
  type: z.literal('IMALIVE'),
  ts: z.number(),
});

export const SoloIncomingMessageSchema = z.discriminatedUnion('type', [
  SoloStepMessageSchema,
  SoloDiagnosticsMessageSchema,
  SoloImAliveMessageSchema,
]);

export type SoloIncomingMessage = z.infer<typeof SoloIncomingMessageSchema>;
