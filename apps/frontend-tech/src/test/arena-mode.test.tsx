// @vitest-environment jsdom
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArenaPage } from '@/features/arena';
import { ResultsPage } from '@/features/results';
vi.mock('@arena/ui/api/sessions.api', () => ({ useSession: () => ({ data: { mode: 'HUMAN_VS_AGENT' } }) }));
vi.mock('@arena/ui/arena-human-agent/results-page', () => ({ ArenaRaceResults: () => <h1>Результаты из Session</h1> }));
vi.mock('@arena/ui/arena-human-agent', () => ({ ArenaHumanAgent: ({ autoFinishOnAgent }: { autoFinishOnAgent?: boolean }) => (
  <h1 data-auto-finish={String(autoFinishOnAgent)}>Соревнование из Session</h1>
) }));
vi.mock('@/features/arena/arena-full-duplex', () => ({ ArenaFullDuplex: () => <h1>FD из state</h1> }));
vi.mock('@/features/arena/arena-solo', () => ({ ArenaSolo: () => <h1>SOLO из state</h1> }));
afterEach(cleanup);
describe('canonical mode hydration', () => {
  it.each(['/arena/id', '/arena/id/results'])('uses Session.mode on %s instead of stale router state', (path) => {
    render(
      <MemoryRouter initialEntries={[{ pathname: path, state: { mode: 'FULL_DUPLEX' } }]}>
        <Routes><Route path={path} element={path.endsWith('/results') ? <ResultsPage /> : <ArenaPage />} /></Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: path.endsWith('/results') ? 'Результаты из Session' : 'Соревнование из Session' })).toBeTruthy();
    expect(screen.queryByText('FD из state')).toBeNull();
    if (!path.endsWith('/results')) expect(screen.getByRole('heading').getAttribute('data-auto-finish')).toBe('false');
  });
});
