import { ActionStrip } from '@arena/ui/arena-human-agent/action-strip';
import type { RaceAction } from '@arena/ui/arena-human-agent/race-state';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const action: RaceAction = { id: 'one', sessionId: 'one', eventId: 'event', sequence: 1, participant: 'AGENT',
  occurredAt: '2026-10-09T00:00:00Z', receivedAt: '2026-10-09T00:00:00Z', kind: 'type', details: { text: 'технические параметры' }, text: 'Ввожу запрос', step: 0 };
describe('race action presentation', () => {
  it.each([[2, 'Двойной клик'], [3, 'Тройной клик']] as const)('labels grouped human clicks before and after saving (%i)', (count, label) => {
    const event = { kind: 'CLICK' as const, details: { x: .5, y: .5, button: 'left' as const, count },
      occurredAt: action.occurredAt, eventId: action.eventId };
    const { rerender } = render(<ActionStrip events={[]} pending={[event]} />);
    expect(screen.getByText(label)).toBeTruthy();
    rerender(<ActionStrip events={[{ ...action, ...event, participant: 'HUMAN', text: null }]} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
  it('keeps thought and colored action badge but hides details by default', () => {
    render(<ActionStrip events={[action]} />);
    expect(screen.getByText('Ввожу запрос')).toBeTruthy();
    expect(screen.getByText('Ввод текста').className).toContain('badgeInput');
    expect(screen.queryByText('#1')).toBeNull();
    expect(screen.queryByText('Детали')).toBeNull();
    expect(screen.queryByText(/технические параметры/)).toBeNull();
  });
  it('shows details on tech and keeps the same animated card on updates/replay', () => {
    const { rerender } = render(<ActionStrip events={[action]} showDetails />);
    const card = screen.getByText('Ввожу запрос').closest('article');
    expect(screen.getByText('Детали')).toBeTruthy();
    rerender(<ActionStrip events={[{ ...action, text: 'Запрос введён' }]} showDetails />);
    expect(screen.getByText('Запрос введён').closest('article')).toBe(card);
  });
});
