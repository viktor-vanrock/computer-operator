import confetti from './assets/confetti.png';
import trophy from './assets/trophy.png';
import { finishLabels, RaceResult } from './result';
import { useArenaHumanAgent } from './use-arena-human-agent';

import styles from './results-page.module.css';

export function ArenaRaceResults({ sessionId, onBack, onRestart, onArena }: {
  sessionId: string; onBack: () => void; onRestart: (id: string) => void; onArena: () => void;
}) {
  const { session, race, busy, error, restart } = useArenaHumanAgent(sessionId, { startOnPending: false });
  // The active race controller remains subscribed while cleanup finishes.
  if (!session || !race) return <p role="status">{error ?? 'Загружаем результаты…'}</p>;
  if (!race.finishedAt) return <div className={styles.page}><p>Соревнование ещё идёт</p><button type="button" onClick={onArena}>Вернуться к соревнованию</button></div>;
  const model = race.modelLabel || race.modelId || 'Модель не определена';
  return (
    <div className={styles.page} style={race.winner ? { backgroundImage: `url(${confetti})` } : undefined}>
      <div className={styles.card}>
        {race.winner ? <img className={styles.trophy} src={trophy} alt="" /> : null}
        <p className={styles.eyebrow}>Результаты соревнования</p>
        <h1>{race.winner ? `Победитель: ${'HUMAN' === race.winner ? 'Человек' : model}` : 'Соревнование завершено без победителя'}</h1>
        <p className={styles.task}>{race.taskTitle}</p>
        {!race.winner ? <p>{race.errorMessage ?? finishLabels[race.finishReason ?? ''] ?? race.finishReason}</p> : null}
        <RaceResult race={race} />
        {error ? <p role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <button className={styles.primary} type="button" onClick={onBack}>Новое задание</button>
          <button type="button"
            onClick={() => void restart().then((replacement) => { if (replacement) onRestart(replacement.id); })}
            disabled={busy || 'COMPLETE' !== race.cleanupStatus}
          >{busy ? 'Перезапускаем…' : 'Повторить'}
          </button>
        </div>
      </div>
    </div>
  );
}
