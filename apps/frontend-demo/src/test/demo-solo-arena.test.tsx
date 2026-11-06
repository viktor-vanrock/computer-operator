import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ArenaPage } from '@/features/arena';

const state = vi.hoisted(() => ({ mode: 'SOLO', useArena: vi.fn() }));
vi.mock('@arena/ui/api/sessions.api', () => ({ useSession: () => ({ data: { mode: state.mode } }) }));
vi.mock('@/features/arena/arena.use-arena', () => ({ useArena: state.useArena }));
vi.mock('@arena/ui/arena-human-agent', () => ({ ArenaHumanAgent: () => <h1>Арена соревнования</h1> }));

describe('demo arena restriction', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each(['FULL_DUPLEX', 'SPLIT', 'COOP'])('redirects %s without mounting a session controller', async (mode) => {
    state.mode = mode;
    render(
      <MemoryRouter initialEntries={['/arena/old-session']}>
        <Routes>
          <Route path="/" element={<h1>Выбор задания SOLO</h1>} />
          <Route path="/arena/:sessionId" element={<ArenaPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Выбор задания SOLO' })).toBeInTheDocument());
    expect(state.useArena).not.toHaveBeenCalled();
  });
  it('opens the human versus agent arena', () => {
    state.mode = 'HUMAN_VS_AGENT';
    render(
      <MemoryRouter initialEntries={['/arena/session']}>
        <Routes>
          <Route path="/arena/:sessionId" element={<ArenaPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: 'Арена соревнования' })).toBeInTheDocument();
    expect(state.useArena).not.toHaveBeenCalled();
  });
});
