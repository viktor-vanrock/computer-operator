// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskManagementPage } from '@/features/task-management';

const createTask = vi.fn();

vi.mock('@arena/ui/api/images.api', () => ({
  useAvailableImages: () => ({ data: [], isPending: false }),
}));

vi.mock('@arena/ui/api/tasks.api', () => ({
  useAdminPresetTasks: () => ({ data: [], isPending: false, isError: false }),
  useCreatePresetTask: () => ({ mutateAsync: createTask, isPending: false }),
  useUpdatePresetTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePresetTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportPresetTasks: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe('TaskManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('не показывает сложность в таблице и форме', () => {
    render(<TaskManagementPage />);
    fireEvent.click(screen.getByRole('button', { name: /Добавить/ }));

    expect(screen.queryByText('Сложность')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Сложность' })).toBeNull();
  });

  it('создаёт новый пресет с фиксированной difficulty 1', async () => {
    createTask.mockResolvedValueOnce({});
    render(<TaskManagementPage />);
    fireEvent.click(screen.getByRole('button', { name: /Добавить/ }));
    fireEvent.change(screen.getByLabelText('Название в UI'), { target: { value: 'Новый кейс' } });
    fireEvent.change(screen.getByLabelText('Промпт для агента'), { target: { value: 'Откройте приложение' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledWith({
      title: 'Новый кейс',
      prompt: 'Откройте приложение',
      imageId: null,
      difficulty: 1,
      isVisible: true,
    }));
  });
});
