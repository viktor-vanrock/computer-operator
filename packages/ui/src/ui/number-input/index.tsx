import styles from './number-input.module.css';

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  id?: string;
  hint?: string;
}

export function NumberInput({ value, onChange, disabled, id, hint }: NumberInputProps) {
  return (
    <div className={styles.root}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className={styles.input}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = parseInt(e.target.value, 10);
          if (!Number.isNaN(next)) onChange(next);
        }}
        aria-describedby={id && hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <span id={id ? `${id}-hint` : undefined} className={styles.hint}>
          {hint}
        </span>
      )}
    </div>
  );
}
