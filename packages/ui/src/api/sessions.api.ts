import { useMutation,useQuery } from '@tanstack/react-query';

import type { RaceAction } from '../arena-human-agent/race-state';
import type { HumanInputAction } from '../arena-player/human-input';
import { apiClient } from '../lib/api-client';
import type { CreateSessionInput, Session, UpdateSessionInput } from '../types/session.types';

export const sessionKeys = {
  all: ['sessions'] as const,
  detail: (id: string) => [...sessionKeys.all, id] as const,
};

export const sessionRaceApi = {
  create: (body: CreateSessionInput, idempotencyKey: string) =>
    apiClient.post<Session>('/sessions', body, { 'Idempotency-Key': idempotencyKey }),
  snapshot: (id: string) => apiClient.get<Session>(`/sessions/${id}`),
  ready: (id: string, participant: 'HUMAN' | 'AGENT', tunnelId: string) =>
    apiClient.post(`/sessions/${id}/guacamole-ready`, { participant, tunnelId }),
  error: (id: string, participant: 'HUMAN' | 'AGENT', code: 'GUACAMOLE_CONNECTION_LOST' | 'GUACAMOLE_SCREEN_TIMEOUT') =>
    apiClient.post<Session>(`/sessions/${id}/guacamole-error`, { participant, code }),
  complete: (id: string) => apiClient.post<Session>(`/sessions/${id}/human-complete`, {}),
  humanActions: (id: string, events: HumanInputAction[]) =>
    apiClient.post<{ accepted: Array<{ eventId: string; sequence: number }>; lastEventSequence: number }>(
      `/sessions/${id}/human-actions`, { events }
    ),
  actions: (id: string, afterSequence = 0, limit = 200) =>
    apiClient.get<{ events: RaceAction[]; nextAfterSequence: number; hasMore: boolean }>(
      `/sessions/${id}/actions?afterSequence=${afterSequence}&limit=${limit}`
    ),
};

export function useSession(id: string | undefined) {
  return useQuery({
    queryKey: sessionKeys.detail(id ?? 'none'),
    queryFn: () => apiClient.get<Session>(`/sessions/${id}`),
    enabled: !!id,
  });
}

export function useCreateSession() {
  return useMutation({
    mutationFn: (input: CreateSessionInput) =>
      apiClient.post<Session>('/sessions', input),
  });
}

export function useUpdateSession(id: string) {
  return useMutation({
    mutationFn: (input: UpdateSessionInput) =>
      apiClient.patch<Session>(`/sessions/${id}`, input),
  });
}

export function useStartSession() {
  return useMutation({
    mutationFn: (id: string) => apiClient.post<Session>(`/sessions/${id}/start`, {}),
  });
}

export function useStopSession() {
  return useMutation({
    mutationFn: (id: string) => apiClient.post<Session>(`/sessions/${id}/stop`, {}),
  });
}

export function useFailGuacamoleConnection() {
  return useMutation({
    mutationFn: (id: string) => apiClient.post<Session>(`/sessions/${id}/guacamole-error`, {}),
  });
}

export function useRestartSession() {
  return useMutation({
    mutationFn: (id: string) => apiClient.post<Session>(`/sessions/${id}/restart`, {}),
  });
}

export function useNextTask() {
  return useMutation({
    mutationFn: ({ sessionId, taskDescription, validationToken }: {
      sessionId: string;
      taskDescription: string;
      validationToken?: string;
    }) =>
      apiClient.post<Session>(`/sessions/${sessionId}/next-task`, { taskDescription, validationToken }),
  });
}

export function useStopTask() {
  return useMutation({
    mutationFn: (id: string) => apiClient.post<{ ok: boolean }>(`/sessions/${id}/stop-task`, {}),
  });
}

export function useSendFullDuplexMessage() {
  return useMutation({
    mutationFn: ({ sessionId, text, validationToken }: { sessionId: string; text: string; validationToken?: string }) =>
      apiClient.post<{ ok: boolean }>(`/sessions/${sessionId}/message`, { text, ...(validationToken ? { validationToken } : {}) }),
  });
}
