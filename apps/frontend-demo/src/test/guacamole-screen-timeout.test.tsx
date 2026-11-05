import { useRef } from 'react';

import { useGuacamoleClient } from '@arena/ui/arena-player/use-guacamole-client';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('guacamole-common-js', () => {
  class MockTunnel {
    uuid: string | null = null;
    oninstruction: ((opcode: string, params: unknown[]) => void) | null = null;
    onstatechange: ((state: number) => void) | null = null;
  }

  class MockDisplay {
    onresize: (() => void) | null = null;
    private readonly element = document.createElement('div');

    getElement() { return this.element; }
    getWidth() { return 0; }
    getHeight() { return 0; }
    flatten() { return document.createElement('canvas'); }
    scale() {}
  }

  class MockClient {
    onsync: (() => void) | null = null;
    private readonly display = new MockDisplay();

    getDisplay() { return this.display; }
    connect() {}
    disconnect() {}
  }

  return { default: { WebSocketTunnel: MockTunnel, Client: MockClient } };
});

vi.mock('@arena/ui/arena-player/util', () => ({
  applyScale: vi.fn(),
}));

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

function Harness({ onError }: { onError: (error: { code: string }) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useGuacamoleClient({
    connectArgs: 'token=value',
    tunnelUrl: 'ws://guacamole',
    containerRef,
    onError,
  });
  return <div ref={containerRef} />;
}

describe('Guacamole screen timeout', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ожидает экран одну минуту по умолчанию на всех стендах', () => {
    const onError = vi.fn();
    render(<Harness onError={onError} />);

    vi.advanceTimersByTime(59_999);
    expect(onError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onError).toHaveBeenCalledWith({ code: 'GUACAMOLE_SCREEN_TIMEOUT' });
  });
});
