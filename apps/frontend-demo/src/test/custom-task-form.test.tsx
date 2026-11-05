import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CustomTaskForm } from '@/features/task-selection/components/CustomTaskForm';

describe('CustomTaskForm', () => {
  it('позволяет запустить выбранный пресет при пустом черновике', () => {
    const onSubmit = vi.fn();
    render(<CustomTaskForm value="" hasSelectedTask onChange={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
  it('отправляет непустой запрос', () => {
    const onSubmit = vi.fn();
    render(
      <CustomTaskForm
        value=""
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByRole('button', { name: 'Отправить запрос' })).toBeDisabled();
  });

  it('передаёт изменения и вызывает отправку формы', () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <CustomTaskForm
        value=""
        onChange={onChange}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Откройте браузер' } });
    expect(onChange).toHaveBeenCalledWith('Откройте браузер');

    rerender(
      <CustomTaskForm
        value="Откройте браузер"
        onChange={onChange}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('обрабатывает отклонение асинхронной отправки внутри формы', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Отклонено модерацией'));
    render(
      <CustomTaskForm
        value="Отклонённая задача"
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }));

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('отправляет запрос по Enter и оставляет Shift+Enter для переноса строки', () => {
    const onSubmit = vi.fn();
    render(
      <CustomTaskForm
        value="Откройте браузер"
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('не отправляет пустой запрос или повторный keydown', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <CustomTaskForm
        value="   "
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <CustomTaskForm
        value="Откройте браузер"
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    fireEvent.keyDown(input, { key: 'Enter', repeat: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
