import { useLocation,useNavigate, useParams } from 'react-router-dom';

import { useSession } from '@arena/ui/api/sessions.api';
import { ArenaRaceResults } from '@arena/ui/arena-human-agent/results-page';
import type { SessionMode } from '@arena/ui/types/session.types';

import { MODE_TO_ROUTE, ROUTES } from '@/constants/routes';

import styles from './results.module.css';

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const secs = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
}

export function ResultsPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = useSession(sessionId);

  const stateMode = (location.state as { mode?: SessionMode } | null)?.mode;
  const mode = session?.mode ?? stateMode;
  const isFullDuplex = 'FULL_DUPLEX' === mode;

  const agentMetrics = session?.metrics?.find((m) => 'AGENT' === m.participant);

  const navDurationSeconds = (location.state as { durationSeconds?: number } | null)?.durationSeconds;
  const fullDuplexDurationSeconds = agentMetrics?.time
    ?? navDurationSeconds
    ?? (session
      ? Math.round((new Date(session.updatedAt).getTime() - new Date(session.createdAt).getTime()) / 1000)
      : 0);

  if ('HUMAN_VS_AGENT' === mode) return <ArenaRaceResults
    sessionId={sessionId}
    onBack={() => { sessionStorage.removeItem('arena-tech-launch'); navigate(ROUTES.TASKS_HUMAN_AGENT); }}
    onArena={() => navigate(`/arena/${sessionId}`, { replace: true })}
    onRestart={(id) => navigate(`/arena/${id}`)}
  />;

  return (
    <div className={styles.page}>

      <h1 className={styles.title}>Результаты сессии</h1>

      <div className={styles.metrics}>
        {isFullDuplex ? (
          <div className={styles.metricRow}>
            <span>Длительность</span>
            <span>{formatDuration(Math.max(0, fullDuplexDurationSeconds))}</span>
          </div>
        ) : (
          <div className={styles.metricRow}>
            <span>Агент</span>
            <span>{formatDuration(agentMetrics?.time ?? 0)} · {agentMetrics?.steps ?? 0} шагов</span>
          </div>
        )}
      </div>

      <button type="button" className={styles.primaryBtn} onClick={() => navigate(mode ? (MODE_TO_ROUTE[mode] ?? ROUTES.TASKS_FULL_DUPLEX) : ROUTES.TASKS_FULL_DUPLEX)}>
        Новое задание
      </button>
    </div>
  );
}
