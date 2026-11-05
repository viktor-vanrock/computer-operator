import { useNavigate } from 'react-router-dom';

import { ArenaFullDuplex as SharedFullDuplex } from '@arena/ui/arena-full-duplex';
import { useArenaFullDuplex } from '@arena/ui/arena-full-duplex/use-arena-full-duplex';

import { useDemoFullDuplexMessage } from './use-demo-full-duplex-message';

export function ArenaFullDuplex({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const sendMessage = useDemoFullDuplexMessage(sessionId);
  const arena = useArenaFullDuplex(sessionId, {
    onBack: () => navigate('/?mode=full-duplex'),
    onRestart: (id) => navigate(`/arena/${id}`, { replace: true }),
    sendMessage,
  });
  return <SharedFullDuplex sessionId={sessionId} arena={arena} />;
}
