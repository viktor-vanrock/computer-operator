import { useEffect, useRef } from 'react';

import type { HumanInputAction } from '../arena-player/human-input';
import { getActionLabel, getActionModifier } from '../ui/arena-thoughts/constants';

import type { RaceAction } from './race-state';

import styles from './action-strip.module.css';

const humanKinds: Record<string, string> = { CLICK: 'click', DRAG: 'drag', SCROLL: 'scroll', KEY_INPUT: 'press' };

export function ActionStrip({ events, pending = [], pendingStatus = 'pending', showDetails = false }: {
  events: RaceAction[]; pending?: HumanInputAction[]; pendingStatus?: 'pending' | 'failed' | 'unsaved'; showDetails?: boolean;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  useEffect(() => {
    const strip = stripRef.current;
    if (strip && followLatest.current) strip.scrollLeft = strip.scrollWidth;
  }, [events.length, pending.length]);
  return (
    <div className={styles.strip}
      aria-label="Лента действий"
      ref={stripRef}
      onScroll={(event) => {
        const strip = event.currentTarget;
        followLatest.current = strip.scrollWidth - strip.scrollLeft - strip.clientWidth <= 8;
      }}
    >
      {!events.length && !pending.length ? <p>Действий пока нет</p> : null}
      {events.map((event) => {
        const kind = humanKinds[event.kind] ?? event.kind;
        return (
          <article key={event.eventId} className={styles.card} data-event-id={event.eventId}>
            <div className={styles.heading}>
              <strong className={`${styles.badge} ${getActionModifier(kind)}`}>{'KEY_INPUT' === event.kind ? 'Ввод с клавиатуры' : getActionLabel(kind, event.details) ?? kind}</strong>
              <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString('ru-RU')}</time>
            </div>
            {'AGENT' === event.participant && event.text ? <p>{event.text}</p> : null}
            {showDetails ? (
              <details><summary>Детали</summary><pre>{JSON.stringify(event.details, null, 2)}</pre></details>
            ) : null}
          </article>
        );
      })}
      {pending.map((event) => (
        <article key={event.eventId} className={styles.card}>
          <strong className={`${styles.badge} ${getActionModifier(humanKinds[event.kind])}`}>{getActionLabel(humanKinds[event.kind], event.details)}</strong>
          <p>{'pending' === pendingStatus ? 'Сохраняем…' : 'failed' === pendingStatus ? 'Ошибка сохранения' : 'Не сохранено'}</p>
        </article>
      ))}
    </div>
  );
}
