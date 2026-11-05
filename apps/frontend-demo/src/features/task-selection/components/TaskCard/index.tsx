import type { Task } from '@arena/ui/types/task.types';

import styles from './task-card.module.css';

interface Props {
  task: Task;
  selected: boolean;
  onSelect: (task: Task) => void;
}

export function TaskCard({ task, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      className={`${styles.card}${selected ? ` ${styles.selected}` : ''}`}
      onClick={() => onSelect(task)}
      aria-pressed={selected}
    >
      <p className={styles.title}>{task.title}</p>
    </button>
  );
}
