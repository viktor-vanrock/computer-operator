import { useEffect, useState } from 'react';

import { BrainIcon, UserIcon } from '@phosphor-icons/react';

import { ArenaPlayer } from '../arena-player';
import { PreparingLoader } from '../arena-player/components';
import type { Participant } from '../types/session.types';
import { ArenaTopBar } from '../ui/arena-top-bar';

import { ActionStrip } from './action-strip';
import { finishLabels } from './result';
import { useArenaHumanAgent } from './use-arena-human-agent';

import styles from './arena-human-agent.module.css';

export function ArenaHumanAgent({ sessionId, onBack, onRestart, onFinished, showDetails = false, autoFinishOnAgent }: {
  sessionId: string; onBack: () => void; onRestart: (id: string) => void; onFinished: (id: string) => void; showDetails?: boolean;
  autoFinishOnAgent?: boolean;
}) {
  const arena = useArenaHumanAgent(sessionId, { ...(autoFinishOnAgent === undefined ? {} : { autoFinishOnAgent }) });
  const { session, race } = arena;
  const [connections, setConnections] = useState<{ sessionId: string; roles: Participant[] }>({ sessionId, roles: [] });
  useEffect(() => { if (race?.finishedAt) onFinished(sessionId); }, [race?.finishedAt, sessionId, onFinished]);
  const displaysReady = connections.sessionId === sessionId && 2 === connections.roles.length && 'RUNNING' === session?.status;
  const preparing = !race?.finishedAt && !displaysReady;
  useEffect(() => {
    if (!preparing) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = previous; };
  }, [preparing]);
  if (!session || !race) return <p role="status">{arena.error ?? 'Загружаем соревнование…'}</p>;
  const terminal = Boolean(race.finishedAt);
  if (terminal) return <p role="status">Переходим к результатам…</p>;
  const restart = async () => {
    const replacement = await arena.restart();
    if (replacement) onRestart(replacement.id);
  };
  return (
    <div className={styles.page}>
      <ArenaTopBar
        taskTitle={race.taskTitle}
        difficulty={session.difficulty}
        elapsedSeconds={null === arena.elapsed ? 0 : Math.floor(arena.elapsed / 1000)}
        isStopping={arena.busy}
        isTerminal={terminal}
        onStop={() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); void arena.stop(); }}
        showDifficultyBadge={false}
      />
      {arena.error ? <p role="alert">{arena.error}</p> : null}
      {!displaysReady ? (
        <div className={styles.preparing} role="status">
          <PreparingLoader /><p>Подключаем оба рабочих стола…</p>
          <button type="button" className={styles.cancelPreparation} onClick={() => void arena.stop()} disabled={arena.busy}>
            {arena.busy ? 'Останавливаем…' : 'Остановить соревнование'}
          </button>
        </div>
      ) : null}
      <div className={`${styles.columns} ${displaysReady ? '' : styles.columnsHidden}`} aria-hidden={!displaysReady} inert={!displaysReady}>
        {race.participants.map((participant) => {
          const human = 'HUMAN' === participant.participant;
          return (
            <section key={participant.participant} className={`${styles.column} ${human ? styles.humanColumn : styles.agentColumn}`}>
              <div className={styles.label}>
                {human ? <UserIcon size={16} aria-hidden="true" /> : <BrainIcon size={16} aria-hidden="true" />}
                <strong>{human ? 'Человек' : race.modelLabel || race.modelId || 'Модель не определена'}</strong>
                {'RUNNING' === session.status && !terminal ? <span>LIVE</span> : null}
                {human ? <button type="button" onClick={() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); void arena.complete(); }} disabled={!arena.inputEnabled || !displaysReady}>Готово</button> : null}
              </div>
              <div className={styles.screen}>
                <ArenaPlayer
                  status={session.status}
                  connectArgs={participant.connectArgs}
                  inputEnabled={human && arena.inputEnabled && displaysReady}
                  clipboardInputEnabled={human}
                  suppressPreparation
                  onHumanAction={arena.onHumanAction}
                  onGuacamoleConnected={(id) => {
                    if (!id) return;
                    setConnections((previous) => ({
                      sessionId,
                      roles: [...new Set([...(previous.sessionId === sessionId ? previous.roles : []), participant.participant])],
                    }));
                    arena.ready(participant.participant, id);
                  }}
                  onGuacamoleError={() => {
                    setConnections((previous) => ({
                      ...previous, roles: previous.roles.filter((role) => role !== participant.participant),
                    }));
                    arena.guacError(participant.participant);
                  }}
                  errorCode={race.errorCode}
                  errorMessage={race.errorMessage ?? (
                    finishLabels[race.finishReason ?? ''] ?? null
                  )}
                  onRestart={() => void restart()}
                  onBack={onBack}
                />
              </div>
              {!human ? (
                <div className={styles.actions}>
                  <h2>Шаги модели</h2>
                  <ActionStrip
                    events={arena.events.filter((event) => 'AGENT' === event.participant)}
                    showDetails={showDetails}
                  />
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
