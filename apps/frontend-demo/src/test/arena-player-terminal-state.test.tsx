import { ArenaPlayer } from '@arena/ui/arena-player';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@arena/ui/arena-player/GuacamoleDisplay', () => ({
  GuacamoleDisplay: () => <div>guacamole</div>,
}));

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

describe('ArenaPlayer terminal state', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  it('enables pointer input only for an explicit RUNNING viewer', () => {
    const { container, rerender } = render(<ArenaPlayer status="RUNNING" connectArgs="fixture" inputEnabled onRestart={vi.fn()} />);
    expect(container.querySelector('[class*="interactive"]')).toBeTruthy();
    rerender(<ArenaPlayer status="RUNNING" connectArgs="fixture" onRestart={vi.fn()} />);
    expect(container.querySelector('[class*="interactive"]')).toBeNull();
  });

  it('для COMPLETED показывает завершение сессии вместо PreparingLoader', () => {
    render(
      <ArenaPlayer
        status="COMPLETED"
        connectArgs="token=test"
        onRestart={vi.fn()}
      />
    );

    expect(screen.getByText('Сессия завершена')).toBeInTheDocument();
    expect(screen.queryByText('guacamole')).not.toBeInTheDocument();
    expect(screen.queryByText('Подготовка рабочей среды')).not.toBeInTheDocument();
  });
});
