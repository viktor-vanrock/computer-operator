import { getActionLabel, getActionModifier } from '@arena/ui/ui/arena-thoughts/constants';
import { describe, expect, it } from 'vitest';

describe('getActionLabel', () => {
  it('возвращает русский лейбл для известного action_type', () => {
    expect(getActionLabel('click')).toBe('Клик');
  });

  it('учитывает кнопку и количество кликов', () => {
    expect(getActionLabel('click', { button: 'left', count: 2 })).toBe('Двойной клик');
    expect(getActionLabel('click', { button: 'left', count: 3 })).toBe('Тройной клик');
    expect(getActionLabel('click', { button: 'right', count: 1 })).toBe('Правый клик');
    expect(getActionLabel('click', { button: 'right', count: 2 })).toBe('Двойной правый клик');
  });

  it('оставляет badge для press в категории ввода', () => {
    expect(getActionLabel('press')).toBe('Горячие клавиши');
    expect(getActionModifier('press')).toBeTruthy();
  });

  it('показывает неизвестный action_type как есть', () => {
    expect(getActionLabel('custom_action')).toBe('custom_action');
    expect(getActionModifier('custom_action')).toBeTruthy();
  });

  it('оформляет delay тем же бейджем, что и wait', () => {
    expect(getActionModifier('delay')).toBe(getActionModifier('wait'));
  });

  it('отображает mouse_move как перемещение', () => {
    expect(getActionLabel('mouse_move')).toBe('Перемещение');
    expect(getActionModifier('mouse_move')).toBeTruthy();
  });

  it('undefined (SOLO v1 plain-text мысль без action_type) → undefined, бейдж не рендерится', () => {
    expect(getActionLabel(undefined)).toBeUndefined();
  });
});

describe('getActionModifier', () => {
  it('возвращает CSS-класс для известного action_type', () => {
    expect(getActionModifier('click')).toBeTruthy();
  });

  it('undefined → безопасный дефолтный класс, без исключения', () => {
    expect(() => getActionModifier(undefined)).not.toThrow();
  });
});
