import { z } from 'zod';

export const AgentProfileSchema = z.object({ display_name: z.string().trim().min(1) });
export const AvailableAgentProfileSchema = z.object({ id: z.string().min(1), displayName: z.string().min(1) });
export type AvailableAgentProfile = z.infer<typeof AvailableAgentProfileSchema>;
