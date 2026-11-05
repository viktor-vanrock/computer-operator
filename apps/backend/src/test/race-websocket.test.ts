import { afterEach, describe, expect, it, vi } from 'vitest';

import { arenaRouter } from '@/modules/arena/arena.router.js';

const ws = vi.hoisted(() => ({ findUnique: vi.fn(), finish: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/db/prisma.js', () => ({ prisma: { session: { findUnique: ws.findUnique } } }));
vi.mock('@/lib/logger.js', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn() }) } }));
vi.mock('@/lib/metrics/metrics.js', () => ({ wsConnectionsActive: { inc: vi.fn(), dec: vi.fn() } }));
vi.mock('@/modules/sessions/race/race-coordinator.js', () => ({ raceCoordinator: {
  finish: ws.finish, setPublisher: vi.fn(), setActionPublisher: vi.fn(),
} }));
vi.mock('@/modules/sessions/race/race-state.repository.js', () => ({ raceStateRepository: {} }));
vi.mock('@/lib/config/env.js', () => ({ env: { DEFAULT_IMAGE_ID: 'fixture' } }));

class Socket {
  readyState = 1;
  OPEN = 1;
  send = vi.fn();
  ping = vi.fn();
  handlers = new Map<string, (data?: Buffer) => void>();
  on(type: string, callback: (data?: Buffer) => void) { this.handlers.set(type, callback); }
  message(payload: unknown) { this.handlers.get('message')?.(Buffer.from(JSON.stringify(payload))); }
  close() { this.readyState = 3; this.handlers.get('close')?.(); }
}
afterEach(() => vi.useRealTimers());

describe('race browser WS boundary', () => {
  it('rejects forged events, starts grace after the last connection and cancels it on reconnect', async () => {
    vi.useFakeTimers();
    let connect!: (socket: Socket, req: unknown) => void;
    const app = { get: (_path: string, _options: unknown, handler: typeof connect) => { connect = handler; } };
    // Minimal adapter exercises the registered connection lifecycle without network sockets.
    await arenaRouter(app as never, {});
    ws.findUnique.mockResolvedValue({ mode: 'HUMAN_VS_AGENT' });
    const req = { params: { id: 'race-ws' }, socket: { remoteAddress: 'fixture' } };
    const first = new Socket();
    connect(first, req);
    await vi.advanceTimersByTimeAsync(0);
    first.message({ type: 'RACE_STATE', payload: { winner: 'HUMAN' } });
    expect(first.send).toHaveBeenCalledWith(expect.stringContaining('INVALID_EVENT'));
    first.close();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(ws.finish).not.toHaveBeenCalled();
    const second = new Socket();
    connect(second, req);
    await vi.advanceTimersByTimeAsync(1);
    expect(ws.finish).not.toHaveBeenCalled();
    second.close();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ws.finish).toHaveBeenCalledExactlyOnceWith('race-ws', 'CONNECTION_LOST');
  });
});
