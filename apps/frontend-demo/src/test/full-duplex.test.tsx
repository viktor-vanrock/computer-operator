import { type PropsWithChildren,StrictMode } from 'react';

import { useArenaFullDuplex } from '@arena/ui/arena-full-duplex/use-arena-full-duplex';
import { ArenaThoughts } from '@arena/ui/ui/arena-thoughts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDemoFullDuplexMessage } from '@/features/arena/use-demo-full-duplex-message';

const mocks = vi.hoisted(() => ({ validate: vi.fn(), send: vi.fn(), start: vi.fn(), stop: vi.fn(), post: vi.fn() }));
vi.mock('@arena/ui/api/moderation.api', () => ({ useValidateTask: () => ({ mutateAsync: mocks.validate }) }));
vi.mock('@arena/ui/api/sessions.api', () => ({
  sessionKeys: { detail: (id: string) => ['session', id] },
  useSession: () => ({ data: { mode: 'FULL_DUPLEX', status: 'RUNNING', difficulty: 1 } }),
  useSendFullDuplexMessage: () => ({ mutateAsync: mocks.send, isPending: false }),
  useStartSession: () => ({ mutateAsync: mocks.start }),
  useStopSession: () => ({ mutate: mocks.stop, mutateAsync: mocks.stop, isPending: false }),
  useFailGuacamoleConnection: () => ({ mutate: vi.fn() }),
  useRestartSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@arena/ui/lib/use-arena-socket', () => ({ useArenaSocket: () => {} }));
vi.mock('@arena/ui/lib/api-client', () => ({ apiClient: { post: mocks.post }, BASE_URL: 'http://offline.invalid', ApiError: class extends Error {} }));

const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
beforeEach(() => { vi.clearAllMocks(); mocks.post.mockResolvedValue({}); mocks.start.mockResolvedValue({ status: 'RUNNING', connectArgs: null }); });

describe('demo Full Duplex messages', () => {
  it('StrictMode effect replay does not stop a running session; actual unmount does', async () => {
    const strictWrapper = ({ children }: PropsWithChildren) => (
      <StrictMode><QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider></StrictMode>
    );
    const { unmount } = renderHook(() => useArenaFullDuplex('fd', { onBack: vi.fn(), onRestart: vi.fn() }), { wrapper: strictWrapper });
    await act(async () => { await Promise.resolve(); });
    expect(mocks.post).not.toHaveBeenCalled();
    unmount(); await act(async () => { await Promise.resolve(); });
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/sessions/fd/stop', {});
  });
  it('validates every normalized instruction before dispatch and does not dispatch rejection', async () => {
    mocks.validate.mockResolvedValue({ validationToken: 'token-1' }); mocks.send.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useDemoFullDuplexMessage('fd'));
    await result.current('  Открой меню  ');
    expect(mocks.validate).toHaveBeenCalledWith('Открой меню');
    expect(mocks.send).toHaveBeenCalledWith({ sessionId: 'fd', text: 'Открой меню', validationToken: 'token-1' });
    expect(mocks.validate.mock.invocationCallOrder[0]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]!);
    mocks.validate.mockRejectedValue(new Error('Задача не прошла проверку'));
    await expect(result.current('Закрой меню')).rejects.toThrow();
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it('does not present a rejected message as sent; records accepted history only after dispatch', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Сервис недоступен'));
    const { result } = renderHook(() => useArenaFullDuplex('fd', { onBack: vi.fn(), onRestart: vi.fn(), sendMessage }), { wrapper });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { expect(await result.current.handleSendMessage('Открой меню')).toBe(false); });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.sendError).toBeTruthy();
    sendMessage.mockResolvedValue(undefined);
    await act(async () => { expect(await result.current.handleSendMessage('Открой меню')).toBe(true); });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ kind: 'user', text: 'Открой меню' });
    expect(result.current.isIdleWarningOpen).toBe(false);
  });
  it('retains the draft when send fails', async () => {
    render(<ArenaThoughts messages={[]} status="RUNNING" alwaysOpenInput onNextTask={async () => false} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Моя инструкция' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отправить' })); });
    expect(input).toHaveValue('Моя инструкция');
  });
});
