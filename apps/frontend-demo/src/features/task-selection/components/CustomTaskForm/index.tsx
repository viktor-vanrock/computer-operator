import { useLayoutEffect, useRef } from 'react';

import submitArrow from '@/assets/images/task-selection/submit-arrow.svg';

import styles from './custom-task-form.module.css';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  disabled?: boolean;
  isSubmitting?: boolean;
  hasSelectedTask?: boolean;
}

export function CustomTaskForm({ value, onChange, onSubmit, disabled = false, isSubmitting = false, hasSelectedTask = false }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = (hasSelectedTask || value.trim().length > 0) && !disabled;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <form
      className={styles.root}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) void Promise.resolve(onSubmit()).catch(() => undefined);
      }}
    >
      <textarea
        id="customTitle"
        ref={textareaRef}
        className={styles.textarea}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            'Enter' !== event.key
            || event.shiftKey
            || event.repeat
            || event.nativeEvent.isComposing
          ) return;

          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
        placeholder="Опишите, что нужно сделать"
        aria-label="Запрос для агента"
        disabled={disabled}
        rows={1}
      />
      <button className={styles.submitButton} type="submit" disabled={!canSubmit} aria-label="Отправить запрос">
        {isSubmitting ? <span className={styles.loader} aria-hidden="true" /> : <img className={styles.submitIcon} src={submitArrow} alt="" aria-hidden="true" />}
      </button>
    </form>
  );
}
