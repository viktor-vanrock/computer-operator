import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { useSession } from '@arena/ui/api/sessions.api';
import { ArenaHumanAgent } from '@arena/ui/arena-human-agent';
import { SessionIdleWarning } from '@arena/ui/ui/session-idle-warning';

import { getModelLabel } from '@/constants/arena';
import { ROUTES } from '@/constants/routes';

import { useArena } from './arena.use-arena';
import { ArenaPlayer, ArenaThoughts, ArenaTopBar } from './components';

import styles from './arena.module.css';

export function ArenaPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const { data: session } = useSession(sessionId);
  if (!session) return <p>Загружаем сессию…</p>;
  if ('HUMAN_VS_AGENT' === session.mode) return <ArenaHumanAgent
    sessionId={sessionId}
    onBack={() => navigate(ROUTES.HUMAN_AGENT)}
    showDetails
    autoFinishOnAgent={false}
    onRestart={(id) => navigate(`/arena/${id}`, { replace: true })}
    onFinished={(id) => navigate(`/arena/${id}/results`, { replace: true })}
  />;
  if ('SOLO' !== session.mode) return <Navigate to="/" replace />;
  return <SoloArena sessionId={sessionId} />;
}

function SoloArena({ sessionId }: { sessionId: string }) {
  const {
    status, connectArgs, messages,
    startError,
    elapsedSeconds,
    isTaskDone,
    taskTitle, difficulty,
    agentLeftModel,
    handleStop, handleStopTask, handleNextTask, handleRetry, handleRestart, handleHome,
    handleGuacamoleConnected, handleGuacamoleError,
    handleInputActivity, handleIdleContinue, handleIdleEnd,
    isIdleWarningOpen, idleSecondsRemaining,
    nextTaskError,
    isStopping, isStoppingTask, isNextTaskPending, isRestarting, restartError,
  } = useArena(sessionId);

  return (
    <div className={styles.page}>
      <ArenaTopBar
        taskTitle={taskTitle}
        difficulty={difficulty}
        elapsedSeconds={elapsedSeconds}
        isStopping={isStopping}
        onStop={handleStop}
        isSolo
        isTaskDone={isTaskDone}
        isStoppingTask={isStoppingTask}
        onStopTask={handleStopTask}
        showDifficultyBadge={false}
        {...('FAILED' === status ? {} : { onRestart: handleRestart })}
        isRestarting={isRestarting}
      />

      <div className={styles.body}>
        <div className={styles.playerCol}>
          <ArenaPlayer
            status={status}
            connectArgs={connectArgs}
            onRestart={handleRestart}
            onBack={'SESSION_ALREADY_STARTED' === startError?.code ? handleHome : handleRetry}
            isRestarting={isRestarting}
            restartError={restartError}
            onGuacamoleConnected={handleGuacamoleConnected}
            onGuacamoleError={handleGuacamoleError}
            errorCode={startError?.code ?? null}
            errorMessage={startError?.message ?? null}
          />
        </div>

        <div className={styles.thoughtsCol}>
          <ArenaThoughts
            messages={messages}
            status={status}
            title={getModelLabel(agentLeftModel) ?? 'Агент'}
            isTaskDone={isTaskDone}
            onNextTask={handleNextTask}
            isNextTaskPending={isNextTaskPending}
            nextTaskError={nextTaskError}
            onInputActivity={handleInputActivity}
          />
        </div>
      </div>
      <SessionIdleWarning
        onContinue={handleIdleContinue}
        onEnd={handleIdleEnd}
        open={isIdleWarningOpen}
        secondsRemaining={idleSecondsRemaining}
      />
    </div>
  );
}
