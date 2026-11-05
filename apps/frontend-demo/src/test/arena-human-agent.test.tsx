import { reconcileRace } from '@arena/ui/arena-human-agent/race-state';
import { useArenaHumanAgent } from '@arena/ui/arena-human-agent/use-arena-human-agent';
import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), socket: null as null | {
  onConnectionChange: (open: boolean) => void; onEvent: (event: unknown) => void;
} }));
vi.mock('@arena/ui/lib/api-client', () => ({ apiClient: { get: mocks.get, post: mocks.post } }));
vi.mock('@arena/ui/lib/use-arena-socket', () => ({ useArenaSocket: (_id: string, options: typeof mocks.socket) => { mocks.socket=options; } }));
const makeSession = (id='one', status='PREPARING', revision=1) => ({ id, status, difficulty:1, race:{ revision,
  taskTitle:'Задача', modelId:'computer-operator', modelLabel:'Computer Operator', startedAt:'RUNNING'===status?'2026-10-09T00:00:00Z':null,
  finishedAt:null,winner:null,finishReason:null,cleanupStatus:'PENDING',lastEventSequence:0,errorCode:null,errorMessage:null,
  participants:['HUMAN','AGENT'].map(participant=>({ participant,status:'WAITING',connectArgs:null,readyAt:null,endedAt:null,
    metrics:{ elapsedMs:null,time:null,steps:0,clicks:null,lastStep:null,eventCount:0 } })) } });
function View(){const arena=useArenaHumanAgent('one');return <div>{arena.events.map(e=><article key={e.eventId}>{e.text}</article>)}</div>;}
beforeEach(()=>{vi.clearAllMocks();mocks.get.mockImplementation(async path=>path.includes('/actions')?{ events:[],hasMore:false,nextAfterSequence:0 }:makeSession());mocks.post.mockResolvedValue(makeSession('one','RUNNING',2));});
describe('race reconciliation',()=>{
  it('applies the technical completion policy when attaching viewers to an existing session', async () => {
    const { result } = renderHook(() => useArenaHumanAgent('one', { autoFinishOnAgent: false }));
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.ready('HUMAN', 'tunnel'));
    expect(mocks.post).toHaveBeenCalledWith('/sessions/one/guacamole-ready', {
      participant: 'HUMAN', tunnelId: 'tunnel', autoFinishOnAgent: false,
    });
  });
  it('does not start a pending session when viewing its results', async () => {
    mocks.get.mockImplementation(async path => path.includes('/actions') ? { events: [], hasMore: false, nextAfterSequence: 0 } : makeSession('one', 'PENDING'));
    renderHook(() => useArenaHumanAgent('one', { startOnPending: false }));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('ignores a late command result after changing sessionId', async () => {
    let resolve!: (value: unknown) => void;
    mocks.post.mockReturnValue(new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(({ id }) => useArenaHumanAgent(id), { initialProps: { id: 'one' } });
    await act(async () => { await Promise.resolve(); });
    let command!: Promise<unknown>;
    act(() => { command = result.current.stop(); });
    mocks.get.mockImplementation(async path => path.includes('/actions') ? { events: [], hasMore: false, nextAfterSequence: 0 } : makeSession('two'));
    rerender({ id: 'two' }); await act(async () => { await Promise.resolve(); });
    await act(async () => { resolve(makeSession('one', 'COMPLETED', 99)); await command; });
    expect(result.current.session?.id).toBe('two'); expect(result.current.busy).toBe(false);
  });
  it('ignores stale revisions and actions for another session',()=>{
    const current={ sessionId:'one',revision:5,status:'COMPLETED',race:{ winner:'HUMAN' } };
    expect(reconcileRace(current,{ ...current,revision:4,status:'RUNNING' })).toBe(current);
    expect(reconcileRace(current,{ ...current,sessionId:'other',revision:6 })).toBe(current);
  });
  it('gates input on both canonical RUNNING and a reconciled connection, with no preparation timer',async()=>{
    const { result,rerender }=renderHook(({ id })=>useArenaHumanAgent(id),{ initialProps:{ id:'one' } });
    await act(async()=>{await Promise.resolve();});
    expect(result.current.inputEnabled).toBe(false);expect(result.current.elapsed).toBeNull();
    mocks.get.mockImplementation(async path=>path.includes('/actions')?{ events:[],hasMore:false,nextAfterSequence:0 }:makeSession('one','RUNNING',3));
    await act(async()=>{mocks.socket!.onConnectionChange(true);});
    expect(result.current.inputEnabled).toBe(true);expect(result.current.elapsed).not.toBeNull();
    await act(async()=>{mocks.socket!.onEvent({ type:'RACE_STATE',payload:{ sessionId:'one',status:'PREPARING',revision:2,race:makeSession().race } });});
    expect(result.current.session?.status).toBe('RUNNING');
    act(()=>mocks.socket!.onConnectionChange(false));expect(result.current.inputEnabled).toBe(false);
    mocks.get.mockImplementation(async path=>path.includes('/actions')?{ events:[],hasMore:false,nextAfterSequence:0 }:makeSession('two'));
    rerender({ id:'two' });await act(async()=>{await Promise.resolve();});expect(result.current.session?.id).toBe('two');expect(result.current.events).toHaveLength(0);
  });
  it('renders a processed RACE_ACTION within 1000 ms and deduplicates replay',async()=>{
    render(<View/>);await act(async()=>{await Promise.resolve();});
    const action={ id:'a',sessionId:'one',eventId:'a',sequence:1,participant:'AGENT',kind:'click',text:'Принятое действие',details:{},step:0,occurredAt:'2026-10-09T00:00:00Z',receivedAt:'2026-10-09T00:00:00Z' };
    const t0=performance.now();await act(async()=>{mocks.socket!.onEvent({ type:'RACE_ACTION',payload:{ sessionId:'one',action } });});
    expect(screen.getByText('Принятое действие')).toBeTruthy();expect(performance.now()-t0).toBeLessThanOrEqual(1000);
    await act(async()=>{mocks.socket!.onEvent({ type:'RACE_ACTION',payload:{ sessionId:'one',action } });});
    expect(screen.getAllByText('Принятое действие')).toHaveLength(1);
  });
});
