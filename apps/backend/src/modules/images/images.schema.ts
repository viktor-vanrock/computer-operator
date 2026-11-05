import { z } from 'zod';

export const AvailableImageSchema = z.object({
  imageId: z.string().min(1),
  name: z.string().min(1),
});
