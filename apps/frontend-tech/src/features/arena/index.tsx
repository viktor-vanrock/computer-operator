import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { useSession } from '@arena/ui/api/sessions.api';
import { ArenaHumanAgent } from '@arena/ui/arena-human-agent';
import type { SessionMode } from '@arena/ui/types/session.types';

import { ArenaFullDuplex } from './arena-full-duplex';
import { ArenaSolo } from './arena-solo';

export function ArenaPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  // Режим приходит из Task Selection синхронно через router state — экран
  // рендерится сразу, без ожидания GET /sessions/:id. Фетч сессии нужен только
  // как фолбэк для прямого захода по ссылке/рефреша страницы (state теряется).
  const stateMode = (location.state as { mode?: SessionMode } | null)?.mode;
  const { data: session } = useSession(sessionId);
  const mode = session?.mode ?? stateMode;

  if (!session) return <p role="status">Загружаем сессию…</p>;

  if ('HUMAN_VS_AGENT' === mode) return <ArenaHumanAgent sessionId={sessionId}
    onBack={() => { sessionStorage.removeItem('arena-tech-launch'); navigate('/tasks/human-vs-agent'); }}
    showDetails
    autoFinishOnAgent={false}
    onFinished={(id) => navigate(`/arena/${id}/results`, { replace: true })}
    onRestart={(id) => navigate(`/arena/${id}`)}
  />;
  return 'FULL_DUPLEX' === mode
    ? <ArenaFullDuplex key={sessionId} sessionId={sessionId} />
    : <ArenaSolo sessionId={sessionId} />;
}
