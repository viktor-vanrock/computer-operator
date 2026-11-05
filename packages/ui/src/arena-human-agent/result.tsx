import type { RaceSnapshot } from './race-state';

import styles from './results-page.module.css';

export function RaceResult({ race }: { race: RaceSnapshot }) {
  const model = race.modelLabel || race.modelId || 'Модель не определена';
  return (
    <section aria-label="Результат соревнования">
      <div className={styles.metrics}>
        {race.participants.map((p) => (
          <div key={p.participant} className={`${styles.row} ${race.winner === p.participant ? styles.winner : ''}`}>
            <strong>{'HUMAN' === p.participant ? 'Человек' : model}</strong>
            <div><b>{formatTime(p.metrics.time)}</b><span>{'SUCCEEDED' === p.status ? 'Время выполнения' : 'Время до остановки'}</span></div>
            <div><b>{p.metrics.steps ?? 'Нет данных'}</b><span>{'HUMAN' === p.participant ? 'Действия' : 'Шаги модели'}</span></div>
            <div><b>{p.metrics.clicks ?? 'Нет данных'}</b><span>Клики</span></div>
          </div>
        ))}
      </div>
      <p>Очистка ресурсов: {cleanupLabels[race.cleanupStatus] ?? race.cleanupStatus}</p>
    </section>
  );
}

export const finishLabels: Record<string, string> = {
  USER_STOP: 'Остановлено пользователем', PREPARATION_FAILED: 'Не удалось подготовить рабочие столы',
  START_FAILED: 'Не удалось запустить соревнование', AGENT_FAILED: 'Ошибка агента',
  CONNECTION_LOST: 'Потеря соединения', BACKEND_RESTART: 'Сессия прервана при перезапуске сервера',
};
const cleanupLabels: Record<string, string> = {
  NOT_REQUIRED: 'Не требуется', PENDING: 'Выполняется', COMPLETE: 'Завершена', FAILED: 'Повторяем после ошибки',
};

function formatTime(seconds: number | null) {
  if (null === seconds) return 'Нет данных';
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
