import { apiClient } from '@arena/ui/lib/api-client';
import { useQuery } from '@tanstack/react-query';

interface AgentProfile { id: string; displayName: string }

export function useAgentProfiles(enabled: boolean) {
  return useQuery({
    queryKey: ['agent-profiles'],
    queryFn: () => apiClient.get<AgentProfile[]>('/sessions/profiles'),
    enabled,
    staleTime: 30_000,
  });
}
