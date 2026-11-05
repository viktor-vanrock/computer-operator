import type { HumanActionSchema, RaceSnapshotSchema } from './race.schema.js';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';

export type HumanAction = z.infer<typeof HumanActionSchema>;
export type RaceSnapshot = z.infer<typeof RaceSnapshotSchema>;
export type RaceFinishReason = Exclude<RaceSnapshot['finishReason'], null>;
export type RawRaceState = Prisma.SessionGetPayload<{ include: { race: { include: { participants: true } }; metrics: true } }>;
