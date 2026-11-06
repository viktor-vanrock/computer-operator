import { useNavigate, useParams } from 'react-router-dom';

import { ArenaRaceResults } from '@arena/ui/arena-human-agent/results-page';

import { ROUTES } from '@/constants/routes';

export function ResultsPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  return <ArenaRaceResults sessionId={sessionId}
    onBack={() => { sessionStorage.removeItem('arena-demo-launch'); navigate(ROUTES.HUMAN_AGENT); }}
    onRestart={(id) => navigate(`/arena/${id}`)}
    onArena={() => navigate(`/arena/${sessionId}`, { replace: true })}
  />;
}
