import { ArenaTopBar } from '@arena/ui/ui/arena-top-bar';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('ArenaTopBar', () => {
  it('ограничивает отображаемый заголовок 100 символами и сохраняет полный title', () => {
    const title = 'а'.repeat(101);
    render(
      <ArenaTopBar
        taskTitle={title}
        difficulty={1}
        elapsedSeconds={0}
        isStopping={false}
        onStop={vi.fn()}
      />
    );

    const visible = `${'а'.repeat(99)}…`;
    expect(screen.getByText(visible)).toHaveAttribute('title', title);
    expect(visible).toHaveLength(100);
  });

  it('не показывает кнопку перезапуска в процессе выполнения задания', () => {
    render(
      <ArenaTopBar
        taskTitle="Тестовое задание"
        difficulty={1}
        elapsedSeconds={0}
        isStopping={false}
        onStop={vi.fn()}
        onRestart={vi.fn()}
        isTaskDone={false}
      />
    );

    expect(screen.queryByRole('button', { name: 'Перезапустить' })).not.toBeInTheDocument();
  });
});
