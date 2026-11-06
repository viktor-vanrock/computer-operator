import { MemoryRouter, useLocation } from 'react-router-dom';

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from '@/App';

vi.mock('@/features', () => ({
  ArenaPage: () => <div>Экран арены</div>,
  LandingPage: () => <div>Старый лендинг</div>,
  TaskSelectionPage: ({ mode }: { mode: string }) => <h1>{'HUMAN_VS_AGENT' === mode ? 'Выберите задание для соревнования' : 'Выберите задание'}</h1>,
}));

vi.mock('@/features/results', () => ({ ResultsPage: () => <h1>Результаты соревнования</h1> }));

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
  it.each(['/?mode=full-duplex', '/?mode=human-vs-agent'])('redirects legacy entry %s to SOLO task selection', async (path) => {
    renderApp(path);
    await waitFor(() => expect(screen.getByLabelText('Текущий путь').textContent).toBe('/'));
    expect(screen.getByRole('heading', { name: 'Выберите задание' })).toBeInTheDocument();
  });
  it('показывает выбор заданий и оба режима в навигации', () => {
    renderApp('/');

    expect(screen.getByRole('heading', { name: 'Выберите задание' })).toBeInTheDocument();
    expect(screen.queryByText('Старый лендинг')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Задание агенту' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Человек vs агент' })).toHaveAttribute('href', '/human-vs-agent');
  });

  it('открывает выбор задания соревнования по прямой ссылке', () => {
    renderApp('/human-vs-agent');
    expect(screen.getByRole('heading', { name: 'Выберите задание для соревнования' })).toBeInTheDocument();
  });

  it('открывает результаты соревнования', () => {
    renderApp('/arena/session/results');
    expect(screen.getByRole('heading', { name: 'Результаты соревнования' })).toBeInTheDocument();
  });

  it('перенаправляет старый адрес заданий на главную', async () => {
    renderApp('/tasks');

    await waitFor(() => expect(screen.getByLabelText('Текущий путь')).toHaveTextContent('/'));
    expect(screen.getByRole('heading', { name: 'Выберите задание' })).toBeInTheDocument();
  });
});
