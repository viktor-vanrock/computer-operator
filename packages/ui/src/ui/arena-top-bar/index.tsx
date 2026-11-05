import { DownloadSimpleIcon, PauseIcon, SpinnerGapIcon, XCircleIcon } from '@phosphor-icons/react';

import { toMMSS } from '../../lib/time';

import styles from './arena-top-bar.module.css';

interface ArenaTopBarProps {
  taskTitle: string
  taskLabel?: string
  difficulty: number
  elapsedSeconds: number
  isStopping: boolean
  isTerminal?: boolean
  onStop: () => void
  isSolo?: boolean
  isTaskDone?: boolean
  isStoppingTask?: boolean
  onStopTask?: () => void
  showDifficultyBadge?: boolean
  onRestart?: (() => void) | undefined
  isRestarting?: boolean
  onDownloadLogs?: () => void
  downloadLogsLabel?: string
  isDownloadingLogs?: boolean
  downloadLogsError?: string | null
}

export const ARENA_TITLE_MAX_LENGTH = 100;

export function truncateArenaTitle(title: string): string {
  return title.length > ARENA_TITLE_MAX_LENGTH
    ? `${title.slice(0, ARENA_TITLE_MAX_LENGTH - 1)}…`
    : title;
}

export function ArenaTopBar({
  taskTitle, taskLabel, difficulty, elapsedSeconds, isStopping, onStop,
  isTerminal = false,
  isSolo, isTaskDone, isStoppingTask, onStopTask,
  showDifficultyBadge = true, isRestarting = false,
  onDownloadLogs, downloadLogsLabel = 'Скачать логи', isDownloadingLogs = false, downloadLogsError,
}: ArenaTopBarProps) {
  const visibleTaskTitle = truncateArenaTitle(taskTitle);

  return (
    <header className={styles.topBar}>
      {/* Left: level badge + task info */}
      <div className={styles.taskInfo}>
        {showDifficultyBadge ? (
          <>
            <span className={styles.badgeDifficulty}>{`Уровень ${difficulty}`}</span>
            <div className={styles.taskInfoDivider} />
          </>
        ) : null}
        <span className={styles.taskLabel}>{taskLabel ?? 'Задание'}</span>
        <span className={styles.taskTitle} title={taskTitle}>{visibleTaskTitle}</span>
      </div>

      {/* Center: timer */}
      <div className={styles.center}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{toMMSS(elapsedSeconds)}</span>
          <span className={styles.statLabel}>Время</span>
        </div>
      </div>

      {/* Right: buttons */}
      <div className={styles.right}>
        {onDownloadLogs ? (
          <>
            <button
              type="button"
              className={styles.downloadLogsBtn}
              disabled={isDownloadingLogs}
              onClick={onDownloadLogs}
            >
              {isDownloadingLogs
                ? <SpinnerGapIcon className={styles.downloadSpinner} weight="regular" size={15} />
                : <DownloadSimpleIcon weight="regular" size={15} />}
              {downloadLogsLabel}
            </button>
            {downloadLogsError ? <span className={styles.downloadLogsError} role="alert">{downloadLogsError}</span> : null}
          </>
        ) : null}
        {isSolo && !isTaskDone && onStopTask && (
          <button
            type="button"
            className={styles.stopTaskBtn}
            disabled={isStoppingTask || isRestarting}
            onClick={onStopTask}
          >
            <PauseIcon weight="regular" size={15} />
            {isStoppingTask ? 'Останавливаем...' : 'Стоп задачу'}
          </button>
        )}
        <button
          type="button"
          className={styles.stopBtn}
          disabled={isStopping || isRestarting || isTerminal}
          onClick={onStop}
        >
          <XCircleIcon weight="regular" size={15} />
          {isTerminal ? 'Сессия завершена' : isStopping ? 'Завершаем...' : 'Завершить'}
        </button>
      </div>
    </header>
  );
}
