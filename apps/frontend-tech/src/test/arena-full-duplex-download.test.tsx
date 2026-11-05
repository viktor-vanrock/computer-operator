// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockArenaState = vi.hoisted(() => ({
  status: 'RUNNING',
  connectArgs: null,
  messages: [],
  elapsedSeconds: 0,
  startError: null,
  difficulty: 1,
  handleStop: vi.fn(),
  handleSendMessage: vi.fn(),
  handleRetry: vi.fn(),
  handleRestart: vi.fn(),
  handleGuacamoleConnected: vi.fn(),
  handleGuacamoleError: vi.fn(),
  handleInputActivity: vi.fn(),
  handleIdleContinue: vi.fn(),
  handleIdleEnd: vi.fn(),
  isIdleWarningOpen: false,
  idleSecondsRemaining: 0,
  isStopping: false,
  sendError: null,
  isSendPending: false,
  isRestarting: false,
  restartError: null,
}));

vi.mock('@/features/arena/use-arena-full-duplex', () => ({
  useArenaFullDuplex: () => mockArenaState,
}));
vi.mock('@arena/ui/arena-player', () => ({ ArenaPlayer: ({ inputEnabled = false, clipboardInputEnabled = false }: {
  inputEnabled?: boolean; clipboardInputEnabled?: boolean;
}) => <div data-testid="desktop" data-input={String(inputEnabled)} data-clipboard={String(clipboardInputEnabled)} /> }));
vi.mock('@arena/ui/ui/arena-thoughts', () => ({ ArenaThoughts: () => <div /> }));
vi.mock('@arena/ui/ui/session-idle-warning', () => ({ SessionIdleWarning: () => null }));

import { ArenaFullDuplex } from '@/features/arena/arena-full-duplex';

describe('ArenaFullDuplex log download feedback', () => {
  it('keeps the Full Duplex VM read-only even in development', () => {
    vi.stubEnv('DEV', true);
    try {
      render(<ArenaFullDuplex sessionId="session-1" />);
      expect(screen.getByTestId('desktop').getAttribute('data-input')).toBe('false');
      expect(screen.getByTestId('desktop').getAttribute('data-clipboard')).toBe('false');
    } finally { vi.unstubAllEnvs(); }
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([80, 75, 3, 4]), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="steps.zip"',
        'content-length': '4',
      },
    })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('возвращает подпись кнопки к исходной после уведомления о начале загрузки', async () => {
    render(<ArenaFullDuplex sessionId="session-1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Скачать логи' }));
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Загрузка началась' })).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });

    expect(screen.getByRole('button', { name: 'Скачать логи' })).toBeTruthy();
  });
});
