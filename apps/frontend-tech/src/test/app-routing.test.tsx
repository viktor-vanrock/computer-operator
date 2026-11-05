// @vitest-environment jsdom
import { MemoryRouter, useLocation } from 'react-router-dom';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '@/App';
vi.mock('@arena/ui/hooks/use-theme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }) }));
vi.mock('@/providers/auth-provider', () => ({ AuthProvider: ({ children }: { children: React.ReactNode }) => children, useAuthUser: () => ({ name: 'Тест' }) }));
vi.mock('@/features/task-selection', () => ({ TaskSelectionPage: () => <h1>Выбор задачи</h1> }));
vi.mock('@/features/task-management', () => ({ TaskManagementPage: () => <h1>Управление задачами</h1> }));
vi.mock('@/features/arena', () => ({ ArenaPage: () => <h1>Арена</h1> }));
vi.mock('@/features/results', () => ({ ResultsPage: () => <h1>Результаты</h1> }));
function Path() { return <output aria-label="Путь">{useLocation().pathname}</output>; }
afterEach(cleanup);
describe('tech navigation', () => {
  it.each(['/tasks/solo', '/tasks/human-vs-agent', '/tasks/full-duplex'])('keeps direct %s and management navigation', (path) => {
    render(<MemoryRouter initialEntries={[path]}><App /><Path /></MemoryRouter>);
    expect(screen.getByLabelText('Путь').textContent).toBe(path);
    for (const label of ['SOLO', 'Человек vs агент', 'Full Duplex', 'Задачи']) expect(screen.getByRole('link', { name: label })).toBeTruthy();
  });
  it('defaults to Full Duplex', async () => {
    render(<MemoryRouter initialEntries={['/']}><App /><Path /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Путь').textContent).toBe('/tasks/full-duplex'));
  });
});
