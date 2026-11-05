import { forwardRef } from 'react';
import type { KeyboardEventHandler } from 'react';

import styles from './task-textarea.module.css';

interface TaskTextareaProps {
  value: string;
  onChange: (value: string) => void;
  className?: string | undefined;
  placeholder?: string;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  maxLength?: number | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  errorMessageId?: string | undefined;
  id?: string | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
}

export const TaskTextarea = forwardRef<HTMLTextAreaElement, TaskTextareaProps>(
  ({ value, onChange, className, placeholder, disabled, readOnly, maxLength, hint, error, errorMessageId, id, onKeyDown }, ref) => {
    const charCount = value.length;
    const isOverLimit = maxLength !== undefined && charCount > maxLength;

    return (
      <div className={`${styles.root}${className ? ` ${className}` : ''}`}>
        <div className={styles.inputWrap}>
          <textarea
            ref={ref}
            id={id}
            className={`${styles.textarea}${error ? ` ${styles.hasError}` : ''}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            readOnly={readOnly}
            aria-describedby={error && errorMessageId ? errorMessageId : id ? `${id}-hint` : undefined}
            aria-invalid={error ? true : undefined}
          />
        </div>
        <div className={styles.footer}>
          <span id={id ? `${id}-hint` : undefined}>
            {error && !errorMessageId ? (
              <span className={styles.errorMsg} role="alert">{error}</span>
            ) : hint ? (
              <span className={styles.hint}>{hint}</span>
            ) : null}
          </span>
          {maxLength !== undefined && (
            <span className={`${styles.counter}${isOverLimit ? ` ${styles.counterOver}` : ''}`}>
              {charCount}/{maxLength}
            </span>
          )}
        </div>
      </div>
    );
  }
);

TaskTextarea.displayName = 'TaskTextarea';
