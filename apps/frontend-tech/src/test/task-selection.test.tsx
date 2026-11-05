// @vitest-environment jsdom

import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskSelectionPage } from '@/features/task-selection';

const handleStart = vi.fn();
vi.mock('@/features/task-selection/use-agent-profiles', () => ({
  useAgentProfiles: () => ({ data: [{ id: 'default', displayName: 'Computer Operator' }], isPending: false, isError: false }),
}));

vi.mock('@arena/ui/api/images.api', () => ({
  useAvailableImages: () => ({ data: [], isError: false, isPending: false }),
}));

vi.mock('@arena/ui/ui/styled-select', () => ({
  StyledSelect: () => <div />,
}));

vi.mock('@/features/task-selection/use-task-selection', () => ({
  useTaskSelection: () => ({
    taskDraft: 'Открой браузер',
    setTaskDraft: vi.fn(),
    imageSelection: { kind: 'default' },
    agentModel: 'computer-operator',
    setImageSelection: vi.fn(),
    setAgentModel: vi.fn(),
    historyMaxStepsCount: 10,
    setHistoryMaxStepsCount: vi.fn(),
    maxScreenshotsDelay: 2,
    setMaxScreenshotsDelay: vi.fn(),
    maxIterations: 25,
    setMaxIterations: vi.fn(),
    modelRetries: 4,
    setModelRetries: vi.fn(),
    mouseClickDelay: 0.1,
    setMouseClickDelay: vi.fn(),
    minOperationDelay: 2,
    setMinOperationDelay: vi.fn(),
    canStart: true,
    isStarting: false,
    startError: null,
    handleStart,
  }),
}));

function renderSoloTaskSelection() {
  render(
    <MemoryRouter initialEntries={['/tasks/solo']}>
      <Routes>
        <Route path="/tasks/:mode" element={<TaskSelectionPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TaskSelectionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('запускает SOLO-задание по Enter', () => {
    renderSoloTaskSelection();

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Своё задание' }), { key: 'Enter' });

    expect(handleStart).toHaveBeenCalledOnce();
  });

  it('оставляет Shift+Enter для переноса строки', () => {
    renderSoloTaskSelection();

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Своё задание' }), {
      key: 'Enter',
      shiftKey: true,
    });

    expect(handleStart).not.toHaveBeenCalled();
  });
});
