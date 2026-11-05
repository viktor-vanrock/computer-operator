import { CaretDownIcon, CaretUpIcon, CheckIcon } from '@phosphor-icons/react';
import * as RadixSelect from '@radix-ui/react-select';

import styles from './styled-select.module.css';

interface StyledSelectProps<T extends string> {
  value: T | null;
  options: readonly { value: T; label: string }[];
  placeholder: string;
  onChange: (value: T | null) => void;
  disabled?: boolean;
}

// Radix возвращает строку без generic-информации; допустимые значения проверяет вызывающий доменный компонент.
export function StyledSelect<T extends string>({ value, options, placeholder, onChange, disabled = false }: StyledSelectProps<T>) {
  return (
    <RadixSelect.Root value={value ?? ''} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <RadixSelect.Trigger className={styles.trigger} aria-label={placeholder}>
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className={styles.triggerIcon}>
          <CaretDownIcon weight="bold" size={14} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content className={styles.content} position="popper" sideOffset={6}>
          <RadixSelect.ScrollUpButton className={styles.scrollBtn}>
            <CaretUpIcon weight="bold" size={12} />
          </RadixSelect.ScrollUpButton>

          <RadixSelect.Viewport className={styles.viewport}>
            {options.map((opt) => (
              <RadixSelect.Item key={opt.value} value={opt.value} className={styles.item}>
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className={styles.itemIndicator}>
                  <CheckIcon weight="bold" size={12} />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>

          <RadixSelect.ScrollDownButton className={styles.scrollBtn}>
            <CaretDownIcon weight="thin" size={12} />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
