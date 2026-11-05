import { ArenaPlayer } from '@arena/ui/arena-player';
import { ArenaThoughts } from '@arena/ui/ui/arena-thoughts';
import { ArenaTopBar } from '@arena/ui/ui/arena-top-bar';
import { SessionIdleWarning } from '@arena/ui/ui/session-idle-warning';

import { useArena } from './use-arena';

import styles from './arena.module.css';

interface ArenaSoloProps {
  sessionId: string;
}

export function ArenaSolo({ sessionId }: ArenaSoloProps) {
  const {
    status, connectArgs, messages, elapsedSeconds, startError,
    taskTitle, difficulty, isTaskDone, isPresetTask,
    handleStop, handleStopTask, handleNextTask, handleRetry, handleRestart, handleGuacamoleConnected,
    handleGuacamoleError, handleInputActivity, handleIdleContinue, handleIdleEnd,
    isIdleWarningOpen, idleSecondsRemaining,
    isStopping, isStoppingTask, nextTaskError, isNextTaskPending, isRestarting, restartError,
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
        showDifficultyBadge={isPresetTask}
        {...('FAILED' === status ? {} : { onRestart: handleRestart })}
        isRestarting={isRestarting}
      />

      <div className={styles.body}>
        <div className={styles.playerCol}>
          <ArenaPlayer
            status={status}
            connectArgs={connectArgs}
            onRestart={handleRestart}
            onBack={handleRetry}
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
            showDetails
            messages={messages}
            status={status}
            submitOnEnter={false}
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
