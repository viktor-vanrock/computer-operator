import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchRaceStop, raceCoordinator } from '@/modules/sessions/race/race-coordinator.js';

vi.mock('@/lib/config/env.js', () => ({ env: { DEFAULT_IMAGE_ID: 'image' } }));
vi.mock('@/lib/db/prisma.js', () => ({ prisma: {} }));
vi.mock('@/lib/vm-fleet/index.js', () => ({ vmFleetClient: {} }));

const lifecycle = vi.hoisted(() => ({
  state: { status: 'PENDING', agentLeftModel: 'default', race: { resolvedImageId: 'snapshot-image', taskPrompt: 'snapshot-task', autoFinishOnAgent: true,
    finishedAt: null as Date | null, cleanupStatus: 'PENDING',
    participants: ['HUMAN', 'AGENT'].map((participant) => ({
      participant, status: 'WAITING', vmName: null as string | null, guacId: null as string | null,
      guacAuthToken: null as string | null, guacTunnelId: null as string | null,
    })),
  } },
  agentAction: vi.fn(), acquire: vi.fn(), cleanup: vi.fn(), requireReady: vi.fn(), connectSession: vi.fn(),
  prepare: vi.fn(), read: vi.fn(), finalize: vi.fn(), ready: vi.fn(), start: vi.fn(), locked: vi.fn(),
  updateParticipant: vi.fn(), updateRace: vi.fn(), updateParticipants: vi.fn(),
  sharing: vi.fn(), token: vi.fn(), connectArgs: vi.fn((token: string, id: string) => `${token}:${id}`),
  cancel: vi.fn(), close: vi.fn(), send: vi.fn(),
}));
vi.mock('@/lib/session-runtime-owner.js', () => ({
  sessionRuntimeOwner: { requireReady: lifecycle.requireReady, isReady: () => true },
}));
vi.mock('@/modules/sessions/vm-claims/vm-claims.service.js', () => ({ vmClaimsService: { acquire: lifecycle.acquire } }));
vi.mock('@/modules/sessions/vm-claims/vm-cleanup.service.js', () => ({ vmCleanupService: { cleanup: lifecycle.cleanup } }));
vi.mock('@/modules/sessions/race/race-actions.service.js', () => ({ raceActionsService: { agent: lifecycle.agentAction } }));
vi.mock('@/modules/sessions/race/race-state.repository.js', () => ({ raceStateRepository: {
  prepare: lifecycle.prepare, read: lifecycle.read, finalize: lifecycle.finalize, ready: lifecycle.ready,
  start: lifecycle.start, locked: lifecycle.locked,
  db: { raceParticipant: { update: lifecycle.updateParticipant } },
} }));
vi.mock('@/lib/agent/agent-manager.client.js', () => ({ agentManager: { connectSession: lifecycle.connectSession } }));
vi.mock('@/lib/guacamole/index.js', () => ({ guacamoleClient: {
  getAuthToken: lifecycle.token, buildConnectArgs: lifecycle.connectArgs,
  buildSharingParamsWithTunnel: lifecycle.sharing, startHeartbeat: () => () => {},
} }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  lifecycle.state.status = 'PENDING';
  lifecycle.state.agentLeftModel = 'default';
  lifecycle.state.race.finishedAt = null;
  lifecycle.state.race.cleanupStatus = 'PENDING';
  lifecycle.state.race.autoFinishOnAgent = true;
  for (const p of lifecycle.state.race.participants) Object.assign(p, {
    status: 'WAITING', vmName: null, guacId: null, guacAuthToken: null, guacTunnelId: null,
  });
  lifecycle.read.mockImplementation(async () => lifecycle.state);
  lifecycle.prepare.mockImplementation(async () => {
    if (lifecycle.state.status !== 'PENDING') return false;
    lifecycle.state.status = 'PREPARING'; return true;
  });
  lifecycle.finalize.mockImplementation(async () => {
    if (lifecycle.state.race.finishedAt) return false;
    lifecycle.state.status = 'COMPLETED'; lifecycle.state.race.finishedAt = new Date(); return true;
  });
  lifecycle.cleanup.mockResolvedValue(true);
  lifecycle.acquire.mockImplementation(async (_id, participant) => ({ vmName: `vm-${participant}`, connectionId: `id-${participant}` }));
  lifecycle.token.mockResolvedValue('fixture-token');
  lifecycle.sharing.mockResolvedValue({ connectionId: 'sharing', datasource: 'fixture', guacToken: 'fixture', sharingProfileId: 'profile' });
  lifecycle.updateParticipant.mockImplementation(async ({ where, data }) => {
    Object.assign(lifecycle.state.race.participants.find((p) => p.participant === where.sessionId_participant.participant)!, data);
  });
  const tx = { raceParticipant: { update: lifecycle.updateParticipant, updateMany: lifecycle.updateParticipants },
    sessionRace: { update: lifecycle.updateRace } };
  lifecycle.locked.mockImplementation(async (_id, run) => run(tx, lifecycle.state));
  lifecycle.ready.mockImplementation(async (_id, participant, tunnelId) => {
    Object.assign(lifecycle.state.race.participants.find((p) => p.participant === participant)!, { status: 'READY', guacTunnelId: tunnelId });
  });
  lifecycle.start.mockImplementation(async () => {
    if (lifecycle.state.status !== 'PREPARING') return false;
    lifecycle.state.status = 'RUNNING'; return true;
  });
  lifecycle.connectSession.mockReturnValue({ cancelTask: lifecycle.cancel, close: lifecycle.close, sendTask: lifecycle.send });
  raceCoordinator.setPublisher(async () => {});
});
afterEach(() => { raceCoordinator.drainRuntime(); vi.useRealTimers(); });

describe('terminal side-effect ordering', () => {
  it('uses the selected profile when starting the race agent', async () => {
    lifecycle.state.agentLeftModel = 'Qwen3.8-27B';
    await raceCoordinator.prepare('profile-check');
    await raceCoordinator.ready('profile-check', 'HUMAN', 'human');
    await raceCoordinator.ready('profile-check', 'AGENT', 'agent');
    expect(lifecycle.connectSession.mock.calls[0]?.[1]).toMatchObject({ profile: 'Qwen3.8-27B', deferredFirstTask: true });
  });
  it('dispatches cancel and close before awaiting any cleanup', async () => {
    const timestamps: number[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const handle = {
      cancelTask: vi.fn(() => timestamps.push(performance.now())),
      close: vi.fn(() => timestamps.push(performance.now())), sendTask: vi.fn(),
    };
    const commitAt = performance.now();
    const finishing = dispatchRaceStop(handle, () => blocked);
    expect(handle.cancelTask).toHaveBeenCalledOnce();
    expect(handle.close).toHaveBeenCalledOnce();
    expect(Math.max(...timestamps) - commitAt).toBeLessThanOrEqual(100);
    release();
    await finishing;
  });

  it('uses two independent VMs with one image and waits for both actual-frame readiness signals', async () => {
    await raceCoordinator.prepare('barrier');
    expect(lifecycle.acquire).toHaveBeenNthCalledWith(1, 'barrier', 'HUMAN', 'snapshot-image');
    expect(lifecycle.acquire).toHaveBeenNthCalledWith(2, 'barrier', 'AGENT', 'snapshot-image');
    expect(lifecycle.connectArgs).toHaveBeenNthCalledWith(1, 'fixture-token', 'id-HUMAN', { dpi: 144 });
    expect(lifecycle.connectArgs).toHaveBeenNthCalledWith(2, 'fixture-token', 'id-AGENT', { dpi: 144 });
    await raceCoordinator.ready('barrier', 'HUMAN', 'human-tunnel');
    expect(lifecycle.connectSession).not.toHaveBeenCalled();
    await raceCoordinator.ready('barrier', 'AGENT', 'agent-tunnel');
    expect(lifecycle.connectSession).toHaveBeenCalledOnce();
    expect(lifecycle.connectSession.mock.calls[0]?.[1].deferredFirstTask).toBe(true);
    expect(lifecycle.sharing).toHaveBeenCalledWith('fixture-token', 'id-AGENT', 'agent-tunnel');
    expect(lifecycle.send).not.toHaveBeenCalled();
    lifecycle.connectSession.mock.calls[0]?.[3].onOpen();
    await vi.advanceTimersByTimeAsync(0);
    expect(lifecycle.send).toHaveBeenCalledOnce();
    await raceCoordinator.ready('barrier', 'AGENT', 'agent-tunnel');
    await raceCoordinator.prepare('barrier');
    expect(lifecycle.connectSession).toHaveBeenCalledOnce();
    expect(lifecycle.acquire).toHaveBeenCalledTimes(2);
  });

  it('compensates a late acquisition after stop without preparing its viewer', async () => {
    let resolve!: (value: unknown) => void;
    lifecycle.acquire.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const preparing = raceCoordinator.prepare('late');
    await vi.advanceTimersByTimeAsync(0);
    await raceCoordinator.finish('late', 'USER_STOP');
    resolve({ vmName: 'late', connectionId: 'late' });
    await preparing;
    expect(lifecycle.token).not.toHaveBeenCalled();
    expect(lifecycle.acquire).toHaveBeenCalledOnce();
    expect(lifecycle.cleanup).toHaveBeenCalledWith('late', true);
  });

  it('expires preparation at 60 seconds and closes a channel stopped during CONNECTING', async () => {
    await raceCoordinator.prepare('deadline');
    await vi.advanceTimersByTimeAsync(59_999);
    expect(lifecycle.finalize).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(lifecycle.finalize).toHaveBeenCalledWith('deadline', 'PREPARATION_FAILED');
  });

  it('does not wait for Fleet cleanup before cancel/close after a committed HUMAN result', async () => {
    await raceCoordinator.prepare('timing');
    await raceCoordinator.ready('timing', 'HUMAN', 'human');
    await raceCoordinator.ready('timing', 'AGENT', 'agent');
    lifecycle.connectSession.mock.calls[0]?.[3].onOpen();
    await vi.advanceTimersByTimeAsync(0);
    lifecycle.cleanup.mockReturnValue(new Promise(() => {}));
    let committedAt = 0;
    const dispatchAt: number[] = [];
    const finalize = lifecycle.finalize.getMockImplementation()!;
    lifecycle.finalize.mockImplementation(async (...args) => {
      const result = await finalize(...args); committedAt = performance.now(); return result;
    });
    lifecycle.cancel.mockImplementation(() => { dispatchAt.push(performance.now()); });
    lifecycle.close.mockImplementation(() => { dispatchAt.push(performance.now()); });
    await raceCoordinator.finish('timing', 'HUMAN_FINISHED');
    expect(lifecycle.cancel).toHaveBeenCalledOnce();
    expect(lifecycle.close).toHaveBeenCalledOnce();
    expect(dispatchAt).toHaveLength(2);
    expect(Math.max(...dispatchAt) - committedAt).toBeLessThanOrEqual(100);
  });
});

describe('race adverse lifecycle', () => {
  it('still finishes a normal race on agent success', async () => {
    await raceCoordinator.prepare('normal');
    await raceCoordinator.ready('normal', 'HUMAN', 'human');
    await raceCoordinator.ready('normal', 'AGENT', 'agent');
    const handlers = lifecycle.connectSession.mock.calls[0]?.[3];
    handlers.onOpen(); await vi.advanceTimersByTimeAsync(0);
    lifecycle.agentAction.mockResolvedValueOnce({ occurredAt: new Date(), receivedAt: new Date() });
    handlers.onStep({ step: 0, ts: Date.now(), text: 'Done', status: 'DONE' });
    await vi.advanceTimersByTimeAsync(0);
    expect(lifecycle.finalize).toHaveBeenCalledWith('normal', 'AGENT_FINISHED');
  });

  it.each(['DONE', 'FAILED', 'CANCELLED'])('keeps a technical arena open after agent %s until the user stops it', async status => {
    await raceCoordinator.prepare('debug');
    await raceCoordinator.ready('debug', 'HUMAN', 'human');
    await raceCoordinator.ready('debug', 'AGENT', 'agent');
    const handlers = lifecycle.connectSession.mock.calls[0]?.[3];
    handlers.onOpen(); await vi.advanceTimersByTimeAsync(0);
    lifecycle.state.race.autoFinishOnAgent = false;
    lifecycle.agentAction.mockResolvedValueOnce({ occurredAt: new Date(), receivedAt: new Date() });
    handlers.onStep({ step: 0, ts: Date.now(), text: 'Agent completed', status });
    await vi.advanceTimersByTimeAsync(0);
    handlers.onDiagnostics({ level: 'FATAL', event: 'agent-error', ts: Date.now() });
    handlers.onClosed('remote_closed');
    await vi.advanceTimersByTimeAsync(0);
    expect(lifecycle.agentAction).toHaveBeenCalled();
    expect(lifecycle.state.status).toBe('RUNNING');
    expect(lifecycle.finalize).not.toHaveBeenCalled();
    expect(lifecycle.cleanup).not.toHaveBeenCalled();
    expect(lifecycle.cancel).not.toHaveBeenCalled();
    const manualReason = status === 'DONE' ? 'HUMAN_FINISHED' : 'USER_STOP';
    await raceCoordinator.finish('debug', manualReason);
    expect(lifecycle.finalize).toHaveBeenCalledWith('debug', manualReason);
    expect(lifecycle.cleanup).toHaveBeenCalledWith('debug', true);
  });

  it('a failed first TASK send finalizes once; late open cannot launch after stop', async () => {
    await raceCoordinator.prepare('failed-send');
    await raceCoordinator.ready('failed-send', 'HUMAN', 'human');
    await raceCoordinator.ready('failed-send', 'AGENT', 'agent');
    lifecycle.send.mockImplementationOnce(() => { throw new Error('closed'); });
    lifecycle.connectSession.mock.calls[0]?.[3].onOpen();
    await vi.advanceTimersByTimeAsync(0);
    expect(lifecycle.finalize).toHaveBeenCalledWith('failed-send', 'START_FAILED');
    expect(lifecycle.cancel).toHaveBeenCalledOnce(); expect(lifecycle.close).toHaveBeenCalledOnce();
  });
  it('stop during CONNECTING dispatches cancel/close and a late open never sends TASK', async () => {
    await raceCoordinator.prepare('connecting');
    await raceCoordinator.ready('connecting', 'HUMAN', 'human');
    await raceCoordinator.ready('connecting', 'AGENT', 'agent');
    const handlers = lifecycle.connectSession.mock.calls[0]?.[3];
    await raceCoordinator.finish('connecting', 'USER_STOP');
    handlers.onOpen(); await vi.advanceTimersByTimeAsync(0);
    expect(lifecycle.send).not.toHaveBeenCalled();
    expect(lifecycle.cancel).toHaveBeenCalledOnce();
  });
  it.each(['FAILED', 'CANCELLED'])('agent %s terminates before victory and later DONE cannot overwrite', async status => {
    await raceCoordinator.prepare('agent-failure');
    await raceCoordinator.ready('agent-failure', 'HUMAN', 'human');
    await raceCoordinator.ready('agent-failure', 'AGENT', 'agent');
    const handlers = lifecycle.connectSession.mock.calls[0]?.[3];
    handlers.onOpen(); await vi.advanceTimersByTimeAsync(0);
    lifecycle.agentAction.mockResolvedValueOnce({ occurredAt: new Date(), receivedAt: new Date() });
    handlers.onStep({ step: 0, ts: Date.now(), text: 'failed', status });
    await vi.advanceTimersByTimeAsync(0);
    expect(lifecycle.finalize).toHaveBeenCalledWith('agent-failure', 'AGENT_FAILED');
    lifecycle.agentAction.mockResolvedValue(null);
    handlers.onStep({ step: 1, ts: Date.now(), text: 'late', status: 'DONE' });
    await vi.advanceTimersByTimeAsync(0);
    expect(lifecycle.finalize).toHaveBeenCalledOnce();
  });
});

describe('race cleanup failure', () => {
  it('reports FAILED cleanup without finalizing an already committed winner again', async () => {
    lifecycle.state.race.finishedAt = new Date(); lifecycle.state.status = 'COMPLETED';
    lifecycle.cleanup.mockResolvedValue(false);
    await raceCoordinator.cleanup('failed-delete');
    expect(lifecycle.updateRace).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cleanupStatus: 'FAILED' }) }));
    expect(lifecycle.finalize).not.toHaveBeenCalled();
  });
});
