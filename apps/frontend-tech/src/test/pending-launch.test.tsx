// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskSelection } from '@/features/task-selection/use-task-selection';
const mocks = vi.hoisted(() => ({ task: vi.fn(), session: vi.fn(), navigate: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@arena/ui/api/tasks.api', () => ({ useCreateTask: () => ({ mutateAsync: mocks.task, isPending: false }) }));
vi.mock('@arena/ui/api/sessions.api', () => ({ useCreateSession: () => ({ mutateAsync: mocks.session, isPending: false }) }));
vi.mock('@arena/ui/lib/api-client', () => ({ apiClient: { post: mocks.session } }));
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();});
afterEach(()=>{cleanup();sessionStorage.clear();});
describe('tech frozen launch',()=>{
  it('reconciles lost Session response after refresh despite edited settings, without a second Task',async()=>{
    mocks.task.mockResolvedValue({ id:'task-A' });mocks.session.mockRejectedValueOnce(new Error('lost')).mockResolvedValue({ id:'session-A' });
    const first=renderHook(()=>useTaskSelection('HUMAN_VS_AGENT'));
    act(()=>{first.result.current.setTaskDraft('Задание человека и агента');first.result.current.setAgentModel('server-profile-v2');});
    await act(async()=>{await first.result.current.handleStart();});
    const frozen=mocks.session.mock.calls[0];first.unmount();
    const restored=renderHook(()=>useTaskSelection('HUMAN_VS_AGENT'));
    act(()=>{restored.result.current.setTaskDraft('Другая задача');restored.result.current.setMaxIterations(99);restored.result.current.setAgentModel('default');});
    await act(async()=>{await restored.result.current.handleStart();});
    expect(mocks.session.mock.calls[1]).toEqual(frozen);expect(mocks.task).toHaveBeenCalledOnce();
    expect(frozen?.[1]).toHaveProperty('agentLeftModel', 'server-profile-v2');
    expect(frozen?.[1]).toHaveProperty('autoFinishOnAgent', false);
    expect(mocks.navigate).toHaveBeenLastCalledWith('/arena/session-A',{ state:{ mode:'HUMAN_VS_AGENT' } });
  });
  it.each(['SOLO', 'HUMAN_VS_AGENT'] as const)('sends a dynamic profile key for %s and blocks removed profiles', async mode => {
    mocks.task.mockResolvedValue({ id: 'task' });mocks.session.mockResolvedValue({ id: 'session', mode });
    const hook=renderHook(()=>useTaskSelection(mode, null, new Set(['default', 'server-profile-v2'])));
    act(()=>{hook.result.current.setTaskDraft('Describe the screen');hook.result.current.setAgentModel('removed-profile');});
    expect(hook.result.current.canStart).toBe(false);
    await act(async()=>{await hook.result.current.handleStart();});
    expect(mocks.task).not.toHaveBeenCalled();
    act(()=>hook.result.current.setAgentModel('server-profile-v2'));
    await act(async()=>{await hook.result.current.handleStart();});
    expect(mocks.session.mock.calls[0]?.['SOLO' === mode ? 0 : 1]).toMatchObject({ agentLeftModel: 'server-profile-v2', mode });
  });

});
