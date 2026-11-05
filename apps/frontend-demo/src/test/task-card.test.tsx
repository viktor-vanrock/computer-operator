import type { Task } from '@arena/ui/types/task.types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskCard } from '@/features/task-selection/components/TaskCard';

const task: Task = {
  id: 'task-1', title: 'Открыть браузер', prompt: 'Откройте браузер', imageId: null,
  difficulty: 2, isPreset: true, isVisible: true, createdAt: '2026-01-01',
};

describe('TaskCard', () => {
  it('сохраняет pressed-семантику без плашки, смещающей название', () => {
    render(<TaskCard task={task} selected onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Открыть браузер' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Выбрано')).not.toBeInTheDocument();
  });
});
