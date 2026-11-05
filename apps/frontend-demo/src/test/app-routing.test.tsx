import { MemoryRouter, useLocation } from 'react-router-dom';

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from '@/App';

vi.mock('@/features', () => ({
  ArenaPage: () => <div>Экран арены</div>,
  LandingPage: () => <div>Старый лендинг</div>,
  TaskSelectionPage: () => <h1>Выберите задание</h1>,
}));

vi.mock('@arena/ui/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

function CurrentPath() {
  const location = useLocation();
  return <output aria-label="Текущий путь">{location.pathname}{location.search}</output>;
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <CurrentPath />
    </MemoryRouter>
  );
}

describe('demo routing', () => {
  it('убирает отключённый режим при legacy redirect', async () => {
    renderApp('/tasks?mode=human-vs-agent');
    await waitFor(() => expect(screen.getByLabelText('Текущий путь').textContent).toBe('/'));
  });
  it.each(['/?mode=full-duplex', '/?mode=human-vs-agent', '/arena/old-race/results'])('redirects disabled entry %s to SOLO task selection', async (path) => {
    renderApp(path);
    await waitFor(() => expect(screen.getByLabelText('Текущий путь').textContent).toBe('/'));
    expect(screen.getByRole('heading', { name: 'Выберите задание' })).toBeInTheDocument();
  });
  it('показывает выбор заданий на главной без навигационного меню', () => {
    renderApp('/');

    expect(screen.getByRole('heading', { name: 'Выберите задание' })).toBeInTheDocument();
    expect(screen.queryByText('Старый лендинг')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('перенаправляет старый адрес заданий на главную', async () => {
    renderApp('/tasks');

    await waitFor(() => expect(screen.getByLabelText('Текущий путь')).toHaveTextContent('/'));
    expect(screen.getByRole('heading', { name: 'Выберите задание' })).toBeInTheDocument();
  });
});
