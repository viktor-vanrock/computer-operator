import type { AvailableImageSchema } from './images.schema.js';

import type { z } from 'zod';

export type AvailableImage = z.infer<typeof AvailableImageSchema>;
