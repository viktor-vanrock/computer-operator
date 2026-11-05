import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskSelectionPage } from '@/features/task-selection';

const tasks = [
  {
    id: 'server-task-1',
    title: 'Задание с сервера',
    prompt: 'Выполнить задание с сервера',
    imageId: null,
    difficulty: 1 as const,
    isPreset: true,
    isVisible: true,
    createdAt: '2026-01-01T00:00:00Z',
  },
];

vi.mock('@arena/ui/api/tasks.api', () => ({
  useTasks: () => ({ data: tasks, isLoading: false, isError: false }),
}));

const hookState = {
  validationError: false,
  recoveringLaunch: false,
  dismissValidationError: vi.fn(),
  handleStart: vi.fn(),
};

vi.mock('@/features/task-selection/use-task-selection', () => ({
  useTaskSelection: () => ({
    selectedTask: null,
    customDraft: '',
    setCustomDraft: vi.fn(),
    handleStart: hookState.handleStart,
    isStarting: false,
    validationError: hookState.validationError,
    recoveringLaunch: hookState.recoveringLaunch,
    dismissValidationError: hookState.dismissValidationError,
  }),
}));

describe('TaskSelectionPage', () => {
  it('объясняет сценарий соревнования', () => {
    render(<TaskSelectionPage mode="HUMAN_VS_AGENT" />);
    expect(screen.getByText('Выполните задание и сравните свой результат с агентом')).toBeInTheDocument();
  });

  it('просит восстановить предыдущий запуск и не позволяет выбрать другое задание', () => {
    hookState.recoveringLaunch = true;
    hookState.handleStart.mockResolvedValue(undefined);
    render(<TaskSelectionPage mode="HUMAN_VS_AGENT" />);
    expect(screen.getByText(/Восстановите его, прежде чем начать новое/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Задание с сервера' })).toBeDisabled();
    screen.getByRole('button', { name: 'Восстановить соревнование' }).click();
    expect(hookState.handleStart).toHaveBeenCalledOnce();
    hookState.recoveringLaunch = false;
  });
  it('показывает поле запроса и быстрые действия', () => {
    render(<TaskSelectionPage />);

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('Full Duplex')).not.toBeInTheDocument();
    expect(screen.queryByText('Человек vs агент')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Введите запрос для агента' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Запрос для агента' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Задание с сервера' })).toBeInTheDocument();
  });

  it('показывает сообщение о непрошедшем проверку запросе', () => {
    hookState.validationError = true;
    render(<TaskSelectionPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Ваш запрос не прошёл проверку');
    expect(screen.getByRole('button', { name: 'Закрыть сообщение' })).toBeInTheDocument();

    hookState.validationError = false;
  });

  it('показывает сообщение проверки как нижний toast', () => {
    hookState.validationError = true;
    render(<TaskSelectionPage />);

    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('feedback');

    hookState.validationError = false;
  });

  it('скрывает сообщение о непрошедшей проверке через пять секунд', () => {
    vi.useFakeTimers();
    hookState.validationError = true;
    hookState.dismissValidationError = vi.fn(() => { hookState.validationError = false; });

    render(<TaskSelectionPage />);
    vi.advanceTimersByTime(5_000);

    expect(hookState.dismissValidationError).toHaveBeenCalledOnce();
    hookState.validationError = false;
    hookState.dismissValidationError = vi.fn();
    vi.useRealTimers();
  });

  it('наследует цвета тёмной темы через тематические токены', () => {
    document.documentElement.dataset.theme = 'dark';
    render(<TaskSelectionPage />);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('heading')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Задание с сервера' })).toBeInTheDocument();

    cleanup();
    delete document.documentElement.dataset.theme;
  });
});
