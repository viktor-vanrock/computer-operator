import { useNavigate, useParams } from 'react-router-dom';

import { ArenaRaceResults } from '@arena/ui/arena-human-agent/results-page';

export function ResultsPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  return <ArenaRaceResults sessionId={sessionId}
    onBack={() => { sessionStorage.removeItem('arena-demo-launch'); navigate('/?mode=human-vs-agent'); }}
    onRestart={(id) => navigate(`/arena/${id}`)}
    onArena={() => navigate(`/arena/${sessionId}`, { replace: true })}
  />;
}
