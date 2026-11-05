import { useArenaSocket } from '@arena/ui/lib/use-arena-socket';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor() { Socket.instances.push(this); }
  close() { this.readyState = 3; this.onclose?.(); }
}
afterEach(() => { vi.unstubAllGlobals(); Socket.instances = []; });

describe('arena socket disposal', () => {
  it('does not let a disposed connection overwrite the new connection state', () => {
    vi.stubGlobal('WebSocket', Socket);
    const onConnectionChange = vi.fn();
    const onEvent = vi.fn();
    const view = renderHook(({ id }) => useArenaSocket(id, { onEvent, onConnectionChange }), { initialProps: { id: 'one' } });
    const previous = Socket.instances[0]!;
    act(() => previous.onopen?.());
    expect(onConnectionChange).toHaveBeenLastCalledWith(true);
    view.rerender({ id: 'two' });
    const current = Socket.instances[1]!;
    act(() => current.onopen?.());
    onConnectionChange.mockClear();
    act(() => previous.onclose?.());
    expect(onConnectionChange).not.toHaveBeenCalled();
    act(() => previous.onmessage?.({ data: JSON.stringify({ type: 'STATUS_CHANGE', payload: { status: 'FAILED' } }) }));
    expect(onEvent).not.toHaveBeenCalled();
    view.unmount();
  });
});
