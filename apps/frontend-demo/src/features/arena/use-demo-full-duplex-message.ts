import { useCallback } from 'react';

import { useValidateTask } from '@arena/ui/api/moderation.api';
import { useSendFullDuplexMessage } from '@arena/ui/api/sessions.api';

export function useDemoFullDuplexMessage(sessionId: string) {
  const validate = useValidateTask();
  const send = useSendFullDuplexMessage();
  return useCallback(async (text: string) => {
    const normalized = text.trim();
    const result = await validate.mutateAsync(normalized);
    await send.mutateAsync({ sessionId, text: normalized, validationToken: result.validationToken });
  }, [sessionId, validate.mutateAsync, send.mutateAsync]);
}
