import { z } from 'zod';

export const CurrentUserSchema = z.object({
  sub:               z.string(),
  email:             z.string(),
  name:              z.string(),
  preferredUsername: z.string(),
});

export type CurrentUser = z.infer<typeof CurrentUserSchema>;
