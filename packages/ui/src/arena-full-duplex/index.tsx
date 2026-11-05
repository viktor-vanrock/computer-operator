import { useEffect, useState } from 'react';

import { ArenaPlayer } from '../arena-player';
import { BASE_URL } from '../lib/api-client';
import { ArenaThoughts } from '../ui/arena-thoughts';
import { ArenaTopBar } from '../ui/arena-top-bar';
import { SessionIdleWarning } from '../ui/session-idle-warning';

import type { useArenaFullDuplex } from './use-arena-full-duplex';

import styles from './arena-full-duplex.module.css';

interface ArenaFullDuplexProps {
  sessionId: string;
  arena: ReturnType<typeof useArenaFullDuplex>;
  canDownloadLogs?: boolean;
  showDifficultyBadge?: boolean;
  showDetails?: boolean;

}

type DownloadPhase = 'idle' | 'preparing' | 'downloading' | 'done' | 'error';

function filenameFromContentDisposition(contentDisposition: string | null, sessionId: string): string {
  const encodedFilename = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quotedFilename = contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1];
  let candidate = quotedFilename ?? `steps-${sessionId}.zip`;
  if (encodedFilename) {
    try {
      candidate = decodeURIComponent(encodedFilename);
    } catch {
      // Если upstream прислал некорректное filename*, используем обычное имя или fallback.
    }
  }
  return candidate.split(/[\\/]/).pop() || `steps-${sessionId}.zip`;
}

export function ArenaFullDuplex({
  sessionId, arena, canDownloadLogs = false, showDifficultyBadge = false, showDetails = false,
}: ArenaFullDuplexProps) {
  const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>('idle');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if ('done' !== downloadPhase) return;
    const timeout = window.setTimeout(() => {
      setDownloadPhase('idle');
      setDownloadProgress(null);
    }, 2_500);
    return () => window.clearTimeout(timeout);
  }, [downloadPhase]);

  const {
    status, connectArgs, messages, elapsedSeconds, startError, difficulty,
    handleStop, handleSendMessage, handleRetry, handleRestart, handleGuacamoleConnected,
    handleGuacamoleError, handleInputActivity, handleIdleContinue, handleIdleEnd,
    isIdleWarningOpen, idleSecondsRemaining,
    isStopping, sendError, isSendPending, isRestarting, restartError,
  } = arena;

  const handleDownloadLogs = async () => {
    if ('preparing' === downloadPhase || 'downloading' === downloadPhase) return;

    setDownloadPhase('preparing');
    setDownloadProgress(null);
    setDownloadError(null);

    try {
      const response = await fetch(`${BASE_URL}/sessions/${encodeURIComponent(sessionId)}/steps.zip`, {
        credentials: 'include',
      });
      if (!response.ok) {
        let message = 'Не удалось скачать логи';
        try {
          const body = await response.json() as { error?: { message?: string }; message?: string };
          message = body.error?.message ?? body.message ?? message;
        } catch {
          // Ответ может не содержать JSON с описанием ошибки.
        }
        throw new Error(message);
      }

      setDownloadPhase('downloading');
      const totalBytes = Number(response.headers.get('content-length')) || null;
      const chunks: BlobPart[] = [];
      let receivedBytes = 0;

      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value as BlobPart);
            receivedBytes += value.byteLength;
            if (totalBytes) setDownloadProgress(Math.min(100, Math.floor((receivedBytes / totalBytes) * 100)));
          }
        } finally {
          reader.releaseLock();
        }
      }

      const blob = new Blob(chunks, { type: response.headers.get('content-type') ?? 'application/zip' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filenameFromContentDisposition(response.headers.get('content-disposition'), sessionId);
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setDownloadProgress(100);
      setDownloadPhase('done');
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Не удалось скачать логи');
      setDownloadPhase('error');
    }
  };

  const downloadLogsLabel = 'preparing' === downloadPhase
    ? 'Готовим архив…'
    : 'downloading' === downloadPhase
      ? null === downloadProgress ? 'Скачиваем…' : `Скачиваем ${downloadProgress}%`
      : 'done' === downloadPhase
        ? 'Загрузка началась'
        : 'error' === downloadPhase ? 'Повторить скачивание' : 'Скачать логи';

  return (
    <div className={styles.page}>
      <ArenaTopBar
        taskTitle="Свободный диалог"
        taskLabel="Режим"
        difficulty={difficulty}
        elapsedSeconds={elapsedSeconds}
        isStopping={isStopping}
        onStop={handleStop}
        {...('FAILED' === status ? {} : { onRestart: handleRestart })}
        isRestarting={isRestarting}
        isTerminal={'COMPLETED' === status || 'FAILED' === status}
        showDifficultyBadge={showDifficultyBadge}
        {...(canDownloadLogs ? { onDownloadLogs: handleDownloadLogs } : {})}
        downloadLogsLabel={downloadLogsLabel}
        isDownloadingLogs={'preparing' === downloadPhase || 'downloading' === downloadPhase}
        downloadLogsError={downloadError}
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
            showDetails={showDetails}
            messages={messages}
            status={status}
            alwaysOpenInput={'RUNNING' === status}
            submitOnEnter={false}
            onNextTask={handleSendMessage}
            isNextTaskPending={isSendPending}
            nextTaskError={sendError}
            inputLabel="Сообщение агенту:"
            inputPlaceholder="Введите инструкцию в любой момент..."
            submitLabel="Отправить"
            submitPendingLabel="Отправка..."
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
