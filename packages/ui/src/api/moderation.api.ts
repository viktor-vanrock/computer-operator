import { useMutation } from '@tanstack/react-query';

import { apiClient } from '../lib/api-client';

export interface ModerationValidation {
  allowed: true;
  validationToken: string;
}

export function useValidateTask() {
  return useMutation({
    mutationFn: (text: string) =>
      apiClient.post<ModerationValidation>('/moderation/validate', { text }),
  });
}
