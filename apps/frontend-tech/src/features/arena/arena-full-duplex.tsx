import { ArenaFullDuplex as SharedFullDuplex } from '@arena/ui/arena-full-duplex';

import { useArenaFullDuplex } from './use-arena-full-duplex';

export function ArenaFullDuplex({ sessionId }: { sessionId: string }) {
  const arena = useArenaFullDuplex(sessionId);
  return <SharedFullDuplex sessionId={sessionId} arena={arena} canDownloadLogs showDifficultyBadge showDetails />;
}
