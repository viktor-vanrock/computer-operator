import { useNavigate } from 'react-router-dom';

import { useArenaFullDuplex as useSharedFullDuplex } from '@arena/ui/arena-full-duplex/use-arena-full-duplex';

export function useArenaFullDuplex(sessionId: string) {
  const navigate = useNavigate();
  return useSharedFullDuplex(sessionId, {
    onBack: () => navigate('/tasks/full-duplex'),
    onResults: (durationSeconds) => navigate(`/arena/${sessionId}/results`, { state: { durationSeconds, mode: 'FULL_DUPLEX' } }),
    onRestart: (id) => navigate(`/arena/${id}`, { replace: true, state: { mode: 'FULL_DUPLEX' } }),
  });
}
