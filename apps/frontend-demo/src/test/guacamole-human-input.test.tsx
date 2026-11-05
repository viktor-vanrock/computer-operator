import { useRef } from 'react';

import { useGuacamoleClient } from '@arena/ui/arena-player/use-guacamole-client';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ clients: [] as Array<{
  onsync: (() => void) | null;
  tunnel: { oninstruction: ((opcode: string, params: unknown[]) => void) | null; onstatechange: ((state: number) => void) | null };
  sendKeyEvent: ReturnType<typeof vi.fn>;
  sendMouseState: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}> }));

vi.mock('@arena/ui/arena-player/screen-readiness', () => ({ isGuacamoleScreenReady: () => true }));
vi.mock('@arena/ui/arena-player/util', () => ({ applyScale: () => {} }));
vi.mock('guacamole-common-js', () => {
  class Tunnel {
    uuid = 'tunnel';
    oninstruction = null;
    onstatechange = null;
  }
  class Display {
    onresize: (() => void) | null = null;
    element = document.createElement('div');
    getElement() { return this.element; }
    getWidth() { return 1920; }
    getHeight() { return 1080; }
    flatten() { return document.createElement('canvas'); }
  }
  class Client {
    onsync = null;
    sendKeyEvent = vi.fn();
    sendMouseState = vi.fn();
    disconnect = vi.fn();
    display = new Display();
    constructor(public tunnel: Tunnel) { mocks.clients.push(this); }
    getDisplay() { return this.display; }
    connect() {}
  }
  class Keyboard {
    onkeydown: ((key: number) => boolean) | null = null;
    onkeyup: ((key: number) => void) | null = null;
    constructor(element: HTMLElement) {
      element.addEventListener('keydown', (event) => this.onkeydown?.('Meta' === event.key ? 0xffeb : event.key.charCodeAt(0)));
      element.addEventListener('keyup', (event) => this.onkeyup?.('Meta' === event.key ? 0xffeb : event.key.charCodeAt(0)));
    }
    reset() {}
  }
  class MouseState {
    constructor(
      public x: number, public y: number, public left: boolean, public middle: boolean,
      public right: boolean, public up: boolean, public down: boolean
    ) {}
  }
  return { default: { WebSocketTunnel: Tunnel, Client, Keyboard, Mouse: { State: MouseState } } };
});

function Harness({ enabled = false, onAction = vi.fn(), connectArgs = 'viewer' }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useGuacamoleClient({
    connectArgs, tunnelUrl: 'ws://guacamole', containerRef, inputEnabled: enabled, onHumanAction: onAction,
  });
  return <div ref={containerRef} tabIndex={0} data-testid="desktop" />;
}

function ready() {
  const client = mocks.clients.at(-1)!;
  act(() => {
    client.tunnel.onstatechange?.(1);
    client.onsync?.();
  });
  return client;
}

describe('human Guacamole input', () => {
  beforeEach(() => {
    mocks.clients.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 50, left: 100, top: 50, right: 1060, bottom: 590, width: 960, height: 540, toJSON() {},
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('defaults to read-only and never records server mouse echoes as human actions', () => {
    const onAction = vi.fn();
    const view = render(<Harness onAction={onAction} />);
    const client = ready();
    const desktop = view.getByTestId('desktop');
    desktop.focus();
    fireEvent.keyDown(desktop, { key: 'a' });
    fireEvent.mouseDown(desktop, { button: 0, clientX: 580, clientY: 320 });
    client.tunnel.oninstruction?.('mouse', ['960', '540', '1']);
    expect(client.sendKeyEvent).not.toHaveBeenCalled();
    expect(client.sendMouseState).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('gates on actual frame, translates scaled coordinates and reports click only on release', () => {
    const onAction = vi.fn();
    const view = render(<Harness enabled onAction={onAction} />);
    const desktop = view.getByTestId('desktop');
    fireEvent.mouseDown(desktop, { button: 0, clientX: 580, clientY: 320 });
    expect(mocks.clients[0]?.sendMouseState).not.toHaveBeenCalled();
    const client = ready();
    fireEvent.mouseDown(desktop, { button: 0, clientX: 580, clientY: 320 });
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.mouseUp(desktop, { button: 0, clientX: 580, clientY: 320 });
    expect(client.sendMouseState).toHaveBeenCalledWith(expect.objectContaining({ x: 960, y: 540, left: true }));
    expect(onAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: 'CLICK', details: { x: 0.5, y: 0.5, button: 'left' },
    }));
  });

  it('groups typing/repeats while forwarding all keys and releases held input on blur', () => {
    const onAction = vi.fn();
    const view = render(<Harness enabled onAction={onAction} />);
    const client = ready();
    const desktop = view.getByTestId('desktop');
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(client.sendKeyEvent).not.toHaveBeenCalled();
    desktop.focus();
    fireEvent.keyDown(desktop, { key: 'a' });
    fireEvent.keyDown(desktop, { key: 'a', repeat: true });
    expect(onAction).not.toHaveBeenCalled();
    expect(client.sendKeyEvent).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(desktop, { button: 0, clientX: 580, clientY: 320 });
    fireEvent.blur(desktop);
    expect(client.sendKeyEvent).toHaveBeenLastCalledWith(0, 97);
    expect(client.sendMouseState).toHaveBeenLastCalledWith(expect.objectContaining({ left: false }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'KEY_INPUT', details: { keysym: 97, modifiers: [], keysyms: [97, 97] } }));
  });

  it.each([2, 3])('groups %i native clicks into one action without delaying desktop input', (count) => {
    const onAction = vi.fn();
    const view = render(<Harness enabled onAction={onAction} />);
    const client = ready();
    const desktop = view.getByTestId('desktop');
    for (let detail = 1; detail <= count; detail++) {
      fireEvent.mouseDown(desktop, { button: 0, clientX: 580, clientY: 320, detail });
      fireEvent.mouseUp(desktop, { button: 0, clientX: 580, clientY: 320, detail });
      act(() => vi.advanceTimersByTime(100));
    }
    expect(client.sendMouseState).toHaveBeenCalledTimes(count * 2);
    act(() => vi.advanceTimersByTime(500));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: 'CLICK', details: { x: .5, y: .5, button: 'left', count },
    }));
  });

  it.each([
    { name: 'independent nearby clicks', first: {}, second: { detail: 1 } },
    { name: 'different targets', first: {}, second: { clientX: 680, detail: 2 } },
    { name: 'different buttons', first: {}, second: { button: 2, detail: 2 } },
    { name: 'clicks after the grouping window', first: {}, second: { detail: 2 }, pause: 501 },
  ])('keeps $name separate', ({ first, second, pause = 100 }) => {
    const onAction = vi.fn(); const view = render(<Harness enabled onAction={onAction} />); ready();
    const desktop = view.getByTestId('desktop');
    for (const options of [first, second]) {
      const props = { button: 0, clientX: 580, clientY: 320, detail: 1, ...options };
      fireEvent.mouseDown(desktop, props); fireEvent.mouseUp(desktop, props);
      act(() => vi.advanceTimersByTime(pause));
    }
    fireEvent.blur(desktop);
    expect(onAction.mock.calls.map(([action]) => action.details.count ?? 1)).toEqual([1, 1]);
  });

  it('flushes a grouped click before keyboard, scroll and drag, and caps groups at three clicks', () => {
    const onAction = vi.fn(); const view = render(<Harness enabled onAction={onAction} />); ready();
    const desktop = view.getByTestId('desktop');
    const click = (detail: number) => {
      const props = { button: 0, clientX: 580, clientY: 320, detail };
      fireEvent.mouseDown(desktop, props); fireEvent.mouseUp(desktop, props);
    };
    click(1); click(2);
    fireEvent.keyDown(desktop, { key: 'a' }); fireEvent.keyUp(desktop, { key: 'a' });
    click(3); fireEvent.wheel(desktop, { deltaY: 120, clientX: 580, clientY: 320 });
    click(4);
    fireEvent.mouseDown(desktop, { button: 0, clientX: 580, clientY: 320, detail: 5 });
    fireEvent.mouseMove(document, { clientX: 800, clientY: 320 });
    fireEvent.mouseUp(document, { button: 0, clientX: 800, clientY: 320 });
    for (let detail = 1; detail <= 4; detail++) click(detail);
    fireEvent.blur(desktop);
    expect(onAction.mock.calls.map(([action]) => [action.kind, action.details.count ?? 1])).toEqual([
      ['CLICK', 2], ['KEY_INPUT', 1], ['CLICK', 1], ['SCROLL', 1], ['CLICK', 1], ['DRAG', 1], ['CLICK', 3], ['CLICK', 1],
    ]);
  });

  it('keeps simultaneous mouse buttons separate and records no failed click releases', () => {
    const onAction = vi.fn(); const view = render(<Harness enabled onAction={onAction} />); const client = ready();
    const desktop = view.getByTestId('desktop');
    for (const button of [0, 2]) fireEvent.mouseDown(desktop, { button, clientX: 580, clientY: 320, detail: 1 });
    for (const button of [2, 0]) fireEvent.mouseUp(desktop, { button, clientX: 580, clientY: 320, detail: 1 });
    fireEvent.blur(desktop);
    expect(onAction.mock.calls.map(([action]) => action.details.button)).toEqual(['right', 'left']);
    fireEvent.mouseDown(desktop, { button: 0, clientX: 580, clientY: 320, detail: 2 });
    client.sendMouseState.mockImplementation(() => { throw new Error('offline'); });
    fireEvent.mouseUp(desktop, { button: 0, clientX: 580, clientY: 320, detail: 2 });
    act(() => vi.advanceTimersByTime(2000));
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('records one drag and scroll; failed sends do not create telemetry', () => {
    const onAction = vi.fn();
    const view = render(<Harness enabled onAction={onAction} />);
    const client = ready();
    const desktop = view.getByTestId('desktop');
    fireEvent.mouseDown(desktop, { button: 0, clientX: 100, clientY: 50 });
    fireEvent.mouseMove(document, { clientX: 580, clientY: 320 });
    fireEvent.mouseUp(document, { button: 0, clientX: 580, clientY: 320 });
    expect(onAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'DRAG' }));
    fireEvent.wheel(desktop, { clientX: 580, clientY: 320, deltaY: 100 });
    act(() => vi.advanceTimersByTime(400));
    expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'SCROLL' }));
    client.sendKeyEvent.mockImplementation(() => { throw new Error('disconnected'); });
    fireEvent.keyDown(desktop, { key: 'b' });
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('normalizes pixel wheel deltas and records one continuous gesture', () => {
    const onAction = vi.fn(); const view = render(<Harness enabled onAction={onAction} />); const client = ready();
    const desktop = view.getByTestId('desktop');
    for (let i = 0; i < 120; i++) fireEvent.wheel(desktop, { clientX: 580, clientY: 320, deltaY: 1 });
    expect(client.sendMouseState.mock.calls.filter(([state]) => state.down)).toHaveLength(2);
    expect(onAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(400));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'SCROLL', details: { x: .5, y: .5, deltaX: 0, deltaY: 120 } }));
  });
  it('records a standalone modifier once instead of losing the menu key', () => {
    const onAction = vi.fn(); const view = render(<Harness enabled onAction={onAction} />); ready(); const desktop = view.getByTestId('desktop'); desktop.focus();
    fireEvent.keyDown(desktop, { key: 'Meta', metaKey: true }); fireEvent.keyUp(desktop, { key: 'Meta' });
    act(() => vi.advanceTimersByTime(400));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'KEY_INPUT', details: { keysym: 0xffeb, modifiers: ['Meta'] } }));
  });
  it('groups repeated shortcuts once, forwards repetitions and normalizes line wheel units', () => {
    const onAction = vi.fn(); const view = render(<Harness enabled onAction={onAction} />); const client = ready();
    const desktop = view.getByTestId('desktop');
    desktop.focus(); fireEvent.keyDown(desktop, { key: 'a', ctrlKey: true }); fireEvent.keyDown(desktop, { key: 'a', ctrlKey: true, repeat: true });
    expect(client.sendKeyEvent).toHaveBeenCalledTimes(2); expect(onAction).toHaveBeenCalledTimes(1);
    fireEvent.wheel(desktop, { clientX: 580, clientY: 320, deltaY: 4, deltaMode: 1 });
    expect(client.sendMouseState.mock.calls.filter(([state]) => state.down)).toHaveLength(1);
    act(() => vi.advanceTimersByTime(400)); expect(onAction).toHaveBeenCalledTimes(2);
  });
  it('does not record failed wheel pulses, flushes typing before click and clears delayed telemetry on disposal', () => {
    const onAction = vi.fn(); const view = render(<Harness enabled onAction={onAction} />); const client = ready();
    const desktop = view.getByTestId('desktop');
    client.sendMouseState.mockImplementation(() => { throw new Error('offline'); });
    fireEvent.wheel(desktop, { deltaY: 120 }); act(() => vi.advanceTimersByTime(400)); expect(onAction).not.toHaveBeenCalled();
    client.sendMouseState.mockReset(); desktop.focus();
    fireEvent.keyDown(desktop, { key: 'a' }); fireEvent.keyDown(desktop, { key: 'b' });
    fireEvent.mouseDown(desktop, { button: 0, clientX: 580, clientY: 320 });
    fireEvent.mouseUp(desktop, { button: 0, clientX: 580, clientY: 320 });
    expect(onAction.mock.calls.map(([action]) => action.kind)).toEqual(['KEY_INPUT']);
    view.unmount(); act(() => vi.advanceTimersByTime(1000)); expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls.map(([action]) => action.kind)).toEqual(['KEY_INPUT', 'CLICK']);
  });
  it('releases on disable/reconnect and removes old listeners on dispose', () => {
    const onAction = vi.fn();
    const view = render(<Harness enabled onAction={onAction} />);
    const desktop = view.getByTestId('desktop');
    const client = ready();
    desktop.focus();
    fireEvent.keyDown(desktop, { key: 'a' });
    view.rerender(<Harness onAction={onAction} />);
    expect(client.sendKeyEvent).toHaveBeenLastCalledWith(0, 97);
    view.rerender(<Harness enabled onAction={onAction} />);
    act(() => client.tunnel.onstatechange?.(2));
    act(() => vi.advanceTimersByTime(1000));
    const replacement = ready();
    fireEvent.keyDown(desktop, { key: 'b' });
    expect(replacement.sendKeyEvent).toHaveBeenCalledExactlyOnceWith(1, 98);
    view.unmount();
    fireEvent.keyDown(desktop, { key: 'c' });
    expect(replacement.sendKeyEvent).toHaveBeenCalledTimes(2); // b down, b release
  });
});
