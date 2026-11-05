import { PendingLaunch } from '@arena/ui/hooks/use-pending-launch';
import { describe, expect, it, vi } from 'vitest';

describe('frozen pending launch', () => {
  it('retries only Session with the same known Task, key and body after a lost response', async () => {
    const task = vi.fn().mockResolvedValue('task-A');
    const createSession = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValue({ id: 'session-A' });
    const launch = new PendingLaunch(sessionStorage, 'test-launch');
    await expect(launch.run('intent-A', task, (taskId) => ({ mode: 'HUMAN_VS_AGENT', taskId, difficulty: 1 }), createSession)).rejects.toThrow();
    const frozen = launch.read();
    const afterRefresh = new PendingLaunch(sessionStorage, 'test-launch');
    await afterRefresh.run('intent-A', task, () => ({ mode: 'HUMAN_VS_AGENT', taskId: 'wrong', difficulty: 5 }), createSession);
    expect(task).toHaveBeenCalledOnce();
    expect(createSession.mock.calls[0]).toEqual(createSession.mock.calls[1]);
    expect(frozen?.taskId).toBe('task-A');
    sessionStorage.removeItem('test-launch');
  });
});

describe('resolved launch intents', () => {
  it('starts a new known intent with a new key only after the previous result was resolved', async () => {
    sessionStorage.clear();
    const launch = new PendingLaunch(sessionStorage, 'resolved-launch');
    const task = vi.fn().mockResolvedValue('task');
    const session = vi.fn().mockResolvedValueOnce({ id: 'first' }).mockResolvedValueOnce({ id: 'second' });
    await launch.run('first-intent', task, id => ({ taskId: id }), session);
    launch.clear();
    await launch.run('second-intent', task, id => ({ taskId: id }), session);
    expect(session.mock.calls[0]?.[1]).not.toBe(session.mock.calls[1]?.[1]);
    expect(launch.read()?.sessionId).toBe('second');
    sessionStorage.clear();
  });
});
