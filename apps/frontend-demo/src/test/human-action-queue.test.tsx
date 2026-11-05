import { HumanActionQueue } from '@arena/ui/arena-human-agent/use-human-actions';
import { describe, expect, it, vi } from 'vitest';

describe('human FIFO batch sender', () => {
  it('does not let B overtake A when A acknowledgement is lost', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValueOnce(new Error('lost ACK')).mockImplementation(async (events) => ({
      accepted: events.map((event: { eventId: string }) => ({ eventId: event.eventId, sequence: 1 })),
    }));
    const queue = new HumanActionQueue(send, () => {});
    const a = { eventId: 'A', kind: 'CLICK' };
    const b = { eventId: 'B', kind: 'KEY_INPUT' };
    queue.push(a);
    await vi.advanceTimersByTimeAsync(100);
    queue.push(b);
    await vi.advanceTimersByTimeAsync(250);
    expect(send.mock.calls[0]?.[0]).toEqual([a]);
    expect(send.mock.calls[1]?.[0]).toEqual([a]);
    await vi.advanceTimersByTimeAsync(100);
    expect(send.mock.calls[2]?.[0]).toEqual([b]);
    queue.dispose();
    vi.useRealTimers();
  });

  it('bounds finish flush at 250 ms even while an input request never resolves', async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => new Promise<{ accepted: Array<{ eventId: string; sequence: number }> }>(() => {}));
    const queue = new HumanActionQueue(send, () => {});
    queue.push({ eventId: 'A' });
    let completed = false;
    const finish = queue.finishFlush().then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(249);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await finish;
    expect(completed).toBe(true);
    expect(queue.pending()).toEqual([{ eventId: 'A' }]);
    queue.dispose(); vi.useRealTimers();
  });
});

describe('failed human action tail', () => {
  it('retains a permanent failure visibly, prevents B overtaking it and marks terminal tail unsaved', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValue({ status: 409 });
    const queue = new HumanActionQueue(send, () => {});
    queue.push({ eventId: 'A' });
    expect(queue.status()).toBe('pending');
    await vi.advanceTimersByTimeAsync(100);
    expect(queue.status()).toBe('failed');
    queue.push({ eventId: 'B' });
    await vi.advanceTimersByTimeAsync(4000);
    expect(send).toHaveBeenCalledOnce(); expect(queue.pending()).toHaveLength(2);
    queue.dispose(); expect(queue.status()).toBe('unsaved'); vi.useRealTimers();
  });
});

describe('single sender during reconnect', () => {
  it('repeated flush while the head is awaiting ACK never starts a second sender', async () => {
    vi.useFakeTimers(); let resolve!: (value: { accepted: Array<{ eventId: string; sequence: number }> }) => void;
    const send = vi.fn(() => new Promise<{ accepted: Array<{ eventId: string; sequence: number }> }>(done => { resolve = done; }));
    const queue = new HumanActionQueue(send, () => {}); queue.push({ eventId: 'A' });
    await vi.advanceTimersByTimeAsync(100); await queue.flush(); await queue.flush();
    expect(send).toHaveBeenCalledOnce();
    resolve({ accepted: [{ eventId: 'A', sequence: 1 }] }); await vi.advanceTimersByTimeAsync(0);
    expect(queue.pending()).toHaveLength(0); queue.dispose(); vi.useRealTimers();
  });
});
