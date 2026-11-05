// @vitest-environment jsdom

import { ArenaTopBar } from '@arena/ui/ui/arena-top-bar';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('ArenaTopBar log download control', () => {
  it('uses an in-page button and reports the active download state', () => {
    const onDownloadLogs = vi.fn();
    render(
      <ArenaTopBar
        taskTitle="Свободный диалог"
        taskLabel="Режим"
        difficulty={1}
        elapsedSeconds={0}
        isStopping={false}
        onStop={vi.fn()}
        onDownloadLogs={onDownloadLogs}
        downloadLogsLabel="Скачиваем 42%"
        isDownloadingLogs
      />
    );

    expect(screen.queryByRole('link', { name: /скачать логи/i })).toBeNull();
    const button = screen.getByRole('button', { name: 'Скачиваем 42%' });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(button);

    expect(onDownloadLogs).not.toHaveBeenCalled();
  });
});
