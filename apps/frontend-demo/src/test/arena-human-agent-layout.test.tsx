import { ArenaHumanAgent } from '@arena/ui/arena-human-agent';
import { ArenaRaceResults } from '@arena/ui/arena-human-agent/results-page';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ complete: vi.fn(), status: 'RUNNING', race: {
  taskTitle: 'Задача', modelLabel: null as string | null, modelId: 'computer-operator' as string | null,
  finishedAt: null as string | null, winner: null, cleanupStatus: 'PENDING', finishReason: null as string | null,
  participants: ['HUMAN', 'AGENT'].map((participant) => ({ participant, status: 'RUNNING', connectArgs: null, metrics: { steps: 0, time: null, clicks: null } })),
}, inputEnabled: true }));
vi.mock('@arena/ui/arena-human-agent/use-arena-human-agent', () => ({ useArenaHumanAgent: () => ({
  session: { status: state.race.finishedAt ? 'COMPLETED' : state.status, difficulty: 1 }, race: state.race,
  elapsed: null, busy: false, inputEnabled: state.inputEnabled, events: [], pending: [],
  onHumanAction: vi.fn(), ready: vi.fn(), guacError: vi.fn(), complete: state.complete, stop: vi.fn(), restart: vi.fn(),
}) }));
vi.mock('@arena/ui/arena-player', () => ({ ArenaPlayer: ({ inputEnabled, clipboardInputEnabled, onGuacamoleConnected }: {
  inputEnabled: boolean; clipboardInputEnabled?: boolean; onGuacamoleConnected: (id: string) => void;
}) => (
  <button type="button" data-testid="desktop" data-input={inputEnabled} data-clipboard={clipboardInputEnabled} onClick={() => onGuacamoleConnected('test-tunnel')}>Подключить</button>
) }));
beforeEach(() => { vi.clearAllMocks(); state.race.finishedAt = null; state.race.finishReason = null; state.race.modelId = 'computer-operator'; state.inputEnabled = true; state.status = 'RUNNING'; });
describe('race presentation', () => {
  it('shows one loader until both viewers connect and preserves human-only input', () => {
    render(<ArenaHumanAgent sessionId="test" onBack={vi.fn()} onRestart={vi.fn()} onFinished={vi.fn()} />);
    const desktops = screen.getAllByTestId('desktop');
    expect(screen.getAllByText('Подготовка рабочей среды')).toHaveLength(1);
    expect(desktops.map((e) => e.dataset.input)).toEqual(['false', 'false']);
    fireEvent.click(desktops[0]!);
    expect(screen.getByText('Подключаем оба рабочих стола…')).toBeTruthy();
    fireEvent.click(desktops[1]!);
    expect(screen.queryByText('Подключаем оба рабочих стола…')).toBeNull();
    expect(desktops.map((e) => e.dataset.input)).toEqual(['true', 'false']);
    expect(desktops.map((e) => e.dataset.clipboard)).toEqual(['true', 'false']);
    expect(screen.getByText('Человек').compareDocumentPosition(screen.getByText('computer-operator')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/Уровень/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' })); expect(state.complete).toHaveBeenCalledOnce();
  });
  it('waits for canonical RUNNING even when both viewers have connected', () => {
    state.status = 'PREPARING';
    render(<ArenaHumanAgent sessionId="test" onBack={vi.fn()} onRestart={vi.fn()} onFinished={vi.fn()} />);
    screen.getAllByTestId('desktop').forEach((e) => fireEvent.click(e));
    expect(screen.getByText('Подключаем оба рабочих стола…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Готово', hidden: true })).toBeDisabled();
  });
  it('navigates to results on terminal state without rendering desktops or inline results', () => {
    state.race.finishedAt = '2026-10-09T00:00:00Z';
    const onFinished = vi.fn();
    render(<ArenaHumanAgent sessionId="test" onBack={vi.fn()} onRestart={vi.fn()} onFinished={onFinished} />);
    expect(onFinished).toHaveBeenCalledWith('test');
    expect(screen.queryByTestId('desktop')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Результат соревнования' })).toBeNull();
  });
  it('results describe a crash and unknown metrics without a preparation error or fabricated speed ratio', () => {
    state.race.finishedAt = '2026-10-09T00:00:00Z'; state.race.finishReason = 'BACKEND_RESTART'; state.race.modelId = null;
    render(<ArenaRaceResults sessionId="test" onBack={vi.fn()} onRestart={vi.fn()} onArena={vi.fn()} />);
    expect(screen.getByText('Сессия прервана при перезапуске сервера')).toBeTruthy();
    expect(screen.getByText('Модель не определена')).toBeTruthy();
    expect(screen.queryByText(/быстрее/)).toBeNull(); expect(screen.queryByText('LIVE')).toBeNull();
    expect(screen.queryByTestId('desktop')).toBeNull();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeDisabled();
  });
});
