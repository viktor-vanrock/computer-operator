import { useFullDuplexMessages } from '@arena/ui/hooks/use-full-duplex-messages';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('Full Duplex thoughts and details', () => {
  it('keeps the thought readable and moves raw diagnostics into tech details', () => {
    const { result } = renderHook(() => useFullDuplexMessages());
    act(() => result.current.handleWsEvent({ type: 'AGENT_STEP', payload: { step: 0, ts: 1,
      reflection: 'Есть окно', think: 'Нажимаю кнопку', speak: 'Открываю приложение', raw: '{"x":123}',
      act: { name: 'click', arguments: { x: 123, y: 456 } } } }));
    expect(result.current.messages[0]).toMatchObject({ thought: 'Нажимаю кнопку\nОткрываю приложение\nЕсть окно',
      actionInputs: { x: 123, y: 456 }, details: { raw: '{"x":123}' } });
  });
  it('prefers the canonical thought while preserving action parameters', () => {
    const { result } = renderHook(() => useFullDuplexMessages());
    act(() => result.current.handleWsEvent({ type: 'AGENT_STEP', payload: { step: 0, ts: 1, thought: 'Открываю меню',
      reflection: '', think: 'Другая мысль', speak: '', act: { name: 'click', arguments: { x: 5 } } } }));
    expect(result.current.messages[0]).toMatchObject({ thought: 'Открываю меню', actionInputs: { x: 5 } });
  });
});
