import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionRuntimeOwner } from '@/lib/session-runtime-owner.js';

vi.mock('@/lib/config/env.js', () => ({ env: { DATABASE_URL: 'postgresql://unused' } }));

function fixture(acquired = true) {
  const listeners = new Map<string, () => void>();
  const connection = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [{ acquired }] }),
    end: vi.fn().mockResolvedValue(undefined),
    on: (event: string, listener: () => void) => { listeners.set(event, listener); },
  };
  return { connection, listeners, owner: new SessionRuntimeOwner(() => connection) };
}

afterEach(() => vi.useRealTimers());

describe('single runtime owner', () => {
  it('remains unavailable until lock and recovery complete', async () => {
    const { owner, connection } = fixture();
    let recover!: () => void;
    const recovery = new Promise<void>((resolve) => { recover = resolve; });
    const starting = owner.start(() => recovery, vi.fn());
    expect(() => owner.requireReady()).toThrow('not ready');
    recover();
    await expect(starting).resolves.toBe(true);
    expect(connection.query).toHaveBeenCalledWith('SELECT pg_try_advisory_lock(1397048147, 1) AS acquired');
    expect(() => owner.requireReady()).not.toThrow();
    await owner.stop();
  });

  it('second process cannot recover or start while lock is held', async () => {
    const { owner, connection } = fixture(false);
    const recover = vi.fn();
    await expect(owner.start(recover, vi.fn())).resolves.toBe(false);
    expect(recover).not.toHaveBeenCalled();
    expect(owner.isReady()).toBe(false);
    expect(connection.end).toHaveBeenCalledOnce();
  });

  it('rejects starts immediately on connection loss and drains handles once', async () => {
    const { owner, listeners } = fixture();
    const drain = vi.fn();
    await owner.start(async () => {}, drain);
    listeners.get('error')?.();
    expect(() => owner.requireReady()).toThrow('not ready');
    listeners.get('end')?.();
    expect(drain).toHaveBeenCalledOnce();
    await owner.stop();
  });

  it('failed recovery releases lock and never advertises readiness', async () => {
    const { owner, connection } = fixture();
    await expect(owner.start(async () => { throw new Error('BACKFILL_CONFLICT'); }, vi.fn())).rejects.toThrow('BACKFILL_CONFLICT');
    expect(owner.isReady()).toBe(false);
    expect(connection.end).toHaveBeenCalledOnce();
  });
});
