import { ArenaThoughts } from '@arena/ui/ui/arena-thoughts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const firstMessage = {
  kind: 'agent' as const,
  id: 'message-1',
  thought: 'Открываю браузер',
  receivedAt: '12:00',
};

const secondMessage = {
  kind: 'agent' as const,
  id: 'message-2',
  thought: 'Перехожу на страницу',
  receivedAt: '12:01',
};

describe('ArenaThoughts', () => {
  it('показывает хоткей отдельной строкой внутри пузыря', () => {
    render(
      <ArenaThoughts
        messages={[{
          kind: 'agent', id: 'hotkey', thought: 'Выделяю всё', actionType: 'press',
          actionInputs: { hotkey: '<ctrl>+<a>', presses: 2 }, receivedAt: '12:00',
        }]}
        status="RUNNING"
        showDetails
      />
    );

    expect(screen.getByText('Горячие клавиши')).toBeInTheDocument();
    expect(screen.getByText('Комбинация клавиш: Ctrl+A ×2')).toBeInTheDocument();
  });

  it('показывает hotkey keys, текст type и неизвестный action с серым бейджем', () => {
    render(
      <ArenaThoughts
        messages={[
          {
            kind: 'agent', id: 'hotkey-keys', thought: 'Выделяю всё', actionType: 'hotkey',
            actionInputs: { keys: ['ctrl', 'a'] }, receivedAt: '12:00',
          },
          {
            kind: 'agent', id: 'type', thought: 'Ввожу запрос', actionType: 'type',
            actionInputs: { content: 'Что мы делаем?' }, receivedAt: '12:01',
          },
          {
            kind: 'agent', id: 'unknown', thought: 'Выполняю действие', actionType: 'future_action',
            receivedAt: '12:02',
          },
        ]}
        status="RUNNING"
        showDetails
      />
    );

    expect(screen.getByText('Комбинация клавиш: Ctrl+A')).toBeInTheDocument();
    expect(screen.getByText('Текст: Что мы делаем?')).toBeInTheDocument();
    const unknownBadge = screen.getByText('future_action');
    expect(unknownBadge.className).toContain('badgeDefault');
  });

  it('hides technical parameters on demo while keeping thoughts', () => {
    render(<ArenaThoughts messages={[{ kind: 'agent', id: 'details', thought: 'Открываю приложение', actionType: 'click', actionInputs: { x: 123, y: 456 }, receivedAt: '12:00' }]} status="RUNNING" />);
    expect(screen.getByText('Открываю приложение')).toBeTruthy();
    expect(screen.queryByText('Детали')).toBeNull(); expect(screen.queryByText(/123/)).toBeNull();
  });
  it('keeps thoughts and expandable action parameters on tech', () => {
    render(<ArenaThoughts messages={[{ kind: 'agent', id: 'details', thought: 'Открываю приложение', actionType: 'click', actionInputs: { x: 123, y: 456 }, receivedAt: '12:00' }]} status="RUNNING" showDetails />);
    expect(screen.getByText('Открываю приложение')).toBeTruthy();
    expect(screen.getByText('Детали')).toBeTruthy(); expect(screen.getByText(/"x": 123/)).toBeTruthy();
  });
  it('показывает ошибку новой задачи как toast вне формы и панели чата', () => {
    render(
      <ArenaThoughts
        messages={[]}
        status="RUNNING"
        isTaskDone
        onNextTask={vi.fn()}
        nextTaskError="Запрос не прошёл проверку"
      />
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Запрос не прошёл проверку');
    expect(alert.className).toContain('feedback');
    expect(alert.closest('form')).toBeNull();
    expect(alert.closest('aside')).toBeNull();
  });

  it('передаёт ошибку в поле новой задачи', () => {
    render(
      <ArenaThoughts
        messages={[]}
        status="RUNNING"
        isTaskDone
        onNextTask={vi.fn()}
        nextTaskError="Запрос не прошёл проверку"
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.focus(input);

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toBe(screen.getByRole('alert'));
  });

  it('продолжает прокручивать чат, когда пользователь находится у нижней границы', () => {
    const { rerender } = render(
      <ArenaThoughts messages={[firstMessage]} status="RUNNING" />
    );
    const chat = screen.getByRole('log');
    Object.defineProperties(chat, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 792, writable: true },
    });
    fireEvent.scroll(chat);
    Object.defineProperty(chat, 'scrollHeight', { configurable: true, value: 1_200 });

    rerender(<ArenaThoughts messages={[firstMessage, secondMessage]} status="RUNNING" />);

    expect(chat.scrollTop).toBe(1_200);
  });

  it('сохраняет позицию чата, когда пользователь читает историю', () => {
    const { rerender } = render(
      <ArenaThoughts messages={[firstMessage]} status="RUNNING" />
    );
    const chat = screen.getByRole('log');
    Object.defineProperties(chat, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 300, writable: true },
    });
    fireEvent.scroll(chat);
    Object.defineProperty(chat, 'scrollHeight', { configurable: true, value: 1_200 });

    rerender(<ArenaThoughts messages={[firstMessage, secondMessage]} status="RUNNING" />);

    expect(chat.scrollTop).toBe(300);
  });

  it('отправляет следующее задание по Enter, но оставляет Shift+Enter для переноса строки', () => {
    const onNextTask = vi.fn().mockResolvedValue(undefined);
    render(
      <ArenaThoughts
        messages={[]}
        status="RUNNING"
        isTaskDone
        onNextTask={onNextTask}
      />
    );
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'Открой новую вкладку' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onNextTask).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNextTask).toHaveBeenCalledOnce();
    expect(onNextTask).toHaveBeenCalledWith('Открой новую вкладку');
  });

  it('не отправляет следующее задание при повторном keydown или IME-композиции', () => {
    const onNextTask = vi.fn().mockResolvedValue(undefined);
    render(
      <ArenaThoughts
        messages={[]}
        status="RUNNING"
        isTaskDone
        onNextTask={onNextTask}
      />
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Открой новую вкладку' } });

    fireEvent.keyDown(input, { key: 'Enter', repeat: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(onNextTask).not.toHaveBeenCalled();
  });
});
