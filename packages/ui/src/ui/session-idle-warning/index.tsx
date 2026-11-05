import { WarningCircleIcon } from '@phosphor-icons/react';

import styles from './session-idle-warning.module.css';

interface SessionIdleWarningProps {
  open: boolean;
  secondsRemaining: number;
  onContinue: () => void;
  onEnd: () => void;
}

export function SessionIdleWarning({ open, secondsRemaining, onContinue, onEnd }: SessionIdleWarningProps) {
  if (!open) return null;

  return (
    <div className={styles.overlay}>
      <section
        aria-describedby="session-idle-description"
        aria-labelledby="session-idle-title"
        aria-live="assertive"
        className={styles.dialog}
        role="alertdialog"
      >
        <WarningCircleIcon
          aria-hidden="true"
          className={styles.icon}
          size={40}
          weight="thin"
        />
        <h2
          className={styles.title}
          id="session-idle-title"
        >
          Сессия скоро завершится
        </h2>
        <p
          className={styles.description}
          id="session-idle-description"
        >
          Форма задания неактивна. До автоматического завершения осталось {secondsRemaining} сек.
        </p>
        <div className={styles.actions}>
          <button
            className={styles.endButton}
            onClick={onEnd}
            type="button"
          >
            Завершить сейчас
          </button>
          <button
            autoFocus
            className={styles.continueButton}
            onClick={onContinue}
            type="button"
          >
            Продолжить сессию
          </button>
        </div>
      </section>
    </div>
  );
}
