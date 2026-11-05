import type { WsEventSchema } from './arena.schema.js';
import type { z } from 'zod';


export type WsEvent = z.infer<typeof WsEventSchema>;
