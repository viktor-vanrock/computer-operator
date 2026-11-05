import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentManager } from '@/lib/agent/agent-manager.client.js';
import { SoloSessionHandlers } from '@/lib/agent/agent-manager.types.js';

vi.mock('@/lib/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('@/lib/config/env.js', () => ({
  env: {
    AGENT_MANAGER_API_URL: 'http://agent-manager.internal',
    AGENT_MANAGER_USERNAME: 'user',
    AGENT_MANAGER_PASSWORD: 'pass',
    FULL_DUPLEX_API_URL: 'http://full-duplex.internal',
    FULL_DUPLEX_USERNAME: 'user',
    FULL_DUPLEX_PASSWORD: 'pass',
  },
}));

// Не наследуемся от node:events.EventEmitter — при наличии vi.mock в файле
// vi.hoisted-фабрики выполняются раньше инициализации импортов модуля, обращение
// к любому импорту (даже встроенному) внутри неё падает с TDZ ReferenceError.
// Поэтому у фейкового сокета — свой минимальный листенер-реестр.
const { FakeWebSocket } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];

    readonly CONNECTING = FakeWebSocket.CONNECTING;
    readonly OPEN = FakeWebSocket.OPEN;
    readonly CLOSING = FakeWebSocket.CLOSING;
    readonly CLOSED = FakeWebSocket.CLOSED;

    readyState: number = FakeWebSocket.CONNECTING;
    sent: Record<string, unknown>[] = [];
    url: string;
    options: { headers?: Record<string, string> };
    private readonly listeners = new Map<string, Listener[]>();

    constructor(url: string, options: { headers?: Record<string, string> }) {
      this.url = url;
      this.options = options;
      FakeWebSocket.instances.push(this);
    }

    on(event: string, listener: Listener): this {
      const list = this.listeners.get(event) ?? [];
      list.push(listener);
      this.listeners.set(event, list);
      return this;
    }

    private fire(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }

    send(data: string): void {
      this.sent.push(JSON.parse(data) as Record<string, unknown>);
    }

    open(): void {
      this.readyState = FakeWebSocket.OPEN;
      this.fire('open');
    }

    receive(payload: Record<string, unknown>): void {
      this.fire('message', Buffer.from(JSON.stringify(payload)), false);
    }

    close(code = 1000, reason = ''): void {
      this.readyState = FakeWebSocket.CLOSED;
      this.fire('close', code, Buffer.from(reason));
    }

    terminate(): void {
      this.close(1006, 'terminated');
    }
  }

  return { FakeWebSocket };
});

vi.mock('ws', () => ({ WebSocket: FakeWebSocket }));

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeHandlers(): {
  onStep: ReturnType<typeof vi.fn<SoloSessionHandlers['onStep']>>;
  onDiagnostics: ReturnType<typeof vi.fn<SoloSessionHandlers['onDiagnostics']>>;
  onClosed: ReturnType<typeof vi.fn<SoloSessionHandlers['onClosed']>>;
} {
  return { onStep: vi.fn(), onDiagnostics: vi.fn(), onClosed: vi.fn() };
}

const SOLO_OPTIONS = {
  vmName: 'vm-1',
  connectionId: 'conn-1',
  datasource: 'ds-1',
  guacToken: 'token',
  configOverride: {
    maxIterations: 25,
    modelRetries: 4,
    mouseClickDelay: 0.1,
    minOperationDelay: 2,
  },
};

describe('AgentManager.connectSession (SOLO v1)', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('шлёт OPEN_SESSION и сразу TASK после открытия сокета, не дожидаясь ответа', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();

    agentManager.connectSession(
      'session-1',
      { ...SOLO_OPTIONS, guacToken: 'guac-token-1' },
      { taskId: 'task-1', text: 'Открой блокнот' },
      handlers
    );

    const ws = FakeWebSocket.instances[0]!;
    expect(ws.url).toBe('ws://agent.internal/v1/');
    expect(ws.options.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('user:pass').toString('base64')}`,
      'X-Request-Id': 'session-1',
    });

    ws.open();
    await flushMicrotasks();

    expect(ws.sent).toEqual([
      {
        type: 'OPEN_SESSION',
        vm_name: 'vm-1',
        connection_id: 'conn-1',
        datasource: 'ds-1',
        guac_token: 'guac-token-1',
        profile: 'default',
        config_override: {
          max_iterations: 25,
          model_retries: 4,
          actuator: {
            config: {
              mouse_click_delay: 0.1,
              min_operation_delay: 2,
            },
          },
        },
      },
      { type: 'TASK', task_id: 'task-1', text: 'Открой блокнот' },
    ]);
  });

  it('sends the selected profile at the OPEN_SESSION top level', () => {
    const manager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handle = manager.connectSession('profile-check', { ...SOLO_OPTIONS, profile: 'Qwen3.8-27B' },
      { taskId: 'task', text: 'Describe the screen' }, makeHandlers());
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    expect(ws.sent[0]).toMatchObject({ type: 'OPEN_SESSION', profile: 'Qwen3.8-27B' });
    expect(ws.sent[0]?.config_override).not.toHaveProperty('profile');
    handle.close();
  });

  it('forwards terminal STEP with null text instead of silently dropping the failure', () => {
    const manager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    const handle = manager.connectSession('failed-model', SOLO_OPTIONS, { taskId: 'task', text: 'Text' }, handlers);
    const ws = FakeWebSocket.instances[0]!; ws.open();
    ws.receive({ type: 'STEP', ts: 123, step: 0, text: null, status: 'FAILED', diagnostics: [] });
    expect(handlers.onStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', text: '', step: 0 }));
    handle.close();
  });

  it('close during CONNECTING prevents late OPEN_SESSION and TASK', () => {
    const manager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    const handle = manager.connectSession('cancelled', SOLO_OPTIONS, { taskId: 'task', text: 'Text' }, handlers);
    const ws = FakeWebSocket.instances[0]!;
    handle.close();
    ws.open();
    expect(ws.sent).toEqual([]);
    expect(handlers.onClosed).toHaveBeenCalledWith('client_request');
  });

  it('defers race TASK until its start gate and makes closed-channel send observable', () => {
    const manager = new AgentManager('http://agent.internal', 'user', 'pass');
    const onOpen = vi.fn();
    const handle = manager.connectSession('deferred', { ...SOLO_OPTIONS, deferredFirstTask: true },
      { taskId: 'task', text: 'Text' }, { ...makeHandlers(), onOpen });
    expect(() => handle.sendTask('Text', 'task')).toThrow('SOLO_CHANNEL_NOT_CONNECTED');
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(ws.sent.map((message) => message.type)).toEqual(['OPEN_SESSION']);
    handle.sendTask('Text', 'task');
    expect(ws.sent.map((message) => message.type)).toEqual(['OPEN_SESSION', 'TASK']);
    handle.close();
    expect(() => handle.sendTask('Text', 'late')).toThrow('SOLO_CHANNEL_NOT_CONNECTED');
  });

  it('транслирует STEP с status=INCOMPLETE через onStep', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    ws.receive({ type: 'STEP', ts: 123, step: 1, text: 'Нажимаю на иконку', status: 'INCOMPLETE' });

    expect(handlers.onStep).toHaveBeenCalledWith({ step: 1, ts: 123, text: 'Нажимаю на иконку', status: 'INCOMPLETE' });
    expect(handlers.onClosed).not.toHaveBeenCalled();
  });

  it('извлекает action_type и arguments из современного diagnostics.action', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    ws.receive({
      type: 'STEP', ts: 1, step: 1, text: 'Ввожу запрос', status: 'INCOMPLETE',
      diagnostics: [{
        event: 'action',
        action: { action_type: 'type', arguments: { content: 'Что мы делаем?' } },
      }],
    });

    expect(handlers.onStep).toHaveBeenCalledWith(expect.objectContaining({
      action_type: 'type',
      action_inputs: { content: 'Что мы делаем?' },
    }));
  });

  it('извлекает текст из model_response, а выполненное действие — из diagnostics.action', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    ws.receive({
      type: 'STEP',
      ts: 1788514020719,
      step: 19,
      text: 'Перехожу на ozon.ru',
      status: 'INCOMPLETE',
      diagnostics: [
        {
          event: 'model_response',
          completion: JSON.stringify({
            thought: 'Мне нужно перейти на ozon.ru',
            action_explanation: 'Нажимаю на адресную строку',
            actions: [
              { action_type: 'click', arguments: { point: [291, 115] } },
              { action_type: 'type', arguments: { content: 'ozon.ru' } },
            ],
          }),
        },
        { event: 'action', action: { action: 'scroll', scroll: [0, -3] } },
      ],
    });

    expect(handlers.onStep).toHaveBeenCalledWith({
      step: 19,
      ts: 1788514020719,
      text: 'Перехожу на ozon.ru',
      status: 'INCOMPLETE',
      thought: 'Мне нужно перейти на ozon.ru',
      action_explanation: 'Нажимаю на адресную строку',
      action_type: 'scroll',
      action_inputs: { scroll: [0, -3] },
      executedActions: [{ type: 'scroll', inputs: { scroll: [0, -3] } }],
    });
  });

  it('не отбрасывает STEP при невалидном completion в diagnostics', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    ws.receive({
      type: 'STEP', ts: 1, step: 1, text: 'Продолжаю', status: 'INCOMPLETE',
      diagnostics: [{ event: 'model_response', completion: '{invalid-json' }],
    });

    expect(handlers.onStep).toHaveBeenCalledWith({
      step: 1, ts: 1, text: 'Продолжаю', status: 'INCOMPLETE', executedActions: [],
    });
  });

  it('использует diagnostics.action при невалидном model_response', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    ws.receive({
      type: 'STEP', ts: 1, step: 1, text: 'Прокручиваю', status: 'INCOMPLETE',
      diagnostics: [
        { event: 'model_response', completion: '{invalid-json' },
        { event: 'action', action: { action: 'scroll', scroll: [0, -3] } },
      ],
    });

    expect(handlers.onStep).toHaveBeenCalledWith({
      step: 1, ts: 1, text: 'Прокручиваю', status: 'INCOMPLETE',
      action_type: 'scroll', action_inputs: { scroll: [0, -3] }, executedActions: [{ type: 'scroll', inputs: { scroll: [0, -3] } }],
    });
  });

  it('извлекает выполненное действие, если model_response отсутствует', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    ws.receive({
      type: 'STEP', ts: 1, step: 2, text: 'Кликаю', status: 'INCOMPLETE',
      diagnostics: [{ event: 'action', action: { action: 'scroll', scroll: [0, -3] } }],
    });

    expect(handlers.onStep).toHaveBeenCalledWith({
      step: 2, ts: 1, text: 'Кликаю', status: 'INCOMPLETE',
      action_type: 'scroll', action_inputs: { scroll: [0, -3] }, executedActions: [{ type: 'scroll', inputs: { scroll: [0, -3] } }],
    });
  });

  it('игнорирует сообщение, не прошедшее Zod-валидацию', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    ws.receive({ type: 'STEP', ts: 123, step: 1, text: 'x', status: 'UNKNOWN_STATUS' });

    expect(handlers.onStep).not.toHaveBeenCalled();
  });

  it('при DIAGNOSTICS level=FATAL вызывает onDiagnostics и закрывает сокет с reason=fatal_diagnostics', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    ws.receive({ type: 'DIAGNOSTICS', ts: 555, level: 'FATAL', event: 'guacamole_disconnected' });

    expect(handlers.onDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ ts: 555, level: 'FATAL', event: 'guacamole_disconnected' })
    );
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(handlers.onClosed).toHaveBeenCalledWith('fatal_diagnostics');
  });

  it('при DIAGNOSTICS level=CRITICAL вызывает onDiagnostics и закрывает сокет с reason=critical_diagnostics', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    ws.receive({ type: 'DIAGNOSTICS', ts: 555, level: 'CRITICAL', event: 'session_timeout' });

    expect(handlers.onDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ ts: 555, level: 'CRITICAL', event: 'session_timeout' })
    );
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(handlers.onClosed).toHaveBeenCalledWith('critical_diagnostics');
  });

  it('DIAGNOSTICS с level=WARN не закрывает сокет', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    ws.receive({ type: 'DIAGNOSTICS', ts: 555, level: 'WARN', event: 'something' });

    expect(handlers.onDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ ts: 555, level: 'WARN', event: 'something' })
    );
    expect(handlers.onClosed).not.toHaveBeenCalled();
  });

  it('DIAGNOSTICS с level=ERROR не закрывает сокет', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    ws.receive({ type: 'DIAGNOSTICS', ts: 555, level: 'ERROR', event: 'unknown_property' });

    expect(handlers.onDiagnostics).toHaveBeenCalled();
    expect(handlers.onClosed).not.toHaveBeenCalled();
  });

  it('handle.sendTask шлёт TASK с переданным task_id по существующему сокету', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    const handle = agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();
    ws.sent = [];

    handle.sendTask('Новая задача', 'task-2');

    expect(ws.sent).toEqual([{ type: 'TASK', task_id: 'task-2', text: 'Новая задача' }]);
  });

  it('handle.cancelTask шлёт CANCEL_TASK', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    const handle = agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();
    ws.sent = [];

    handle.cancelTask();

    expect(ws.sent).toEqual([{ type: 'CANCEL_TASK' }]);
  });

  it('handle.close шлёт CLOSE_SESSION и по факту закрытия сокета вызывает onClosed(client_request)', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    const handle = agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();
    ws.sent = [];

    handle.close();
    expect(ws.sent).toEqual([{ type: 'CLOSE_SESSION' }]);

    ws.close();
    expect(handlers.onClosed).toHaveBeenCalledWith('client_request');
  });

  it('handle.close сохраняет переданную причину закрытия Guacamole', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    const handle = agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    handle.close('guacamole_error');
    ws.close();

    expect(handlers.onClosed).toHaveBeenCalledWith('guacamole_error');
  });

  it('обрыв сокета без CLOSE_SESSION приводит к onClosed(ws_gone)', async () => {
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    ws.close(1006, 'abnormal');

    expect(handlers.onClosed).toHaveBeenCalledWith('ws_gone');
  });

  it('шлёт IMALIVE каждые 30 секунд, пока сокет открыт', async () => {
    vi.useFakeTimers();
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();
    ws.sent = [];

    await vi.advanceTimersByTimeAsync(29_999);

    expect(ws.sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);

    expect(ws.sent).toEqual([{ type: 'IMALIVE' }]);
  });

  it('без сообщений от сервера дольше 120 секунд разрывает сокет с reason=heartbeat_timeout', async () => {
    vi.useFakeTimers();
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(120_000);

    expect(handlers.onClosed).toHaveBeenCalledWith('heartbeat_timeout');
  });

  it('входящее сообщение сбрасывает watchdog-таймер', async () => {
    vi.useFakeTimers();
    const agentManager = new AgentManager('http://agent.internal', 'user', 'pass');
    const handlers = makeHandlers();
    agentManager.connectSession(
      'session-1',
      SOLO_OPTIONS,
      { taskId: 'task-1', text: 'text' },
      handlers
    );
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(100_000);
    ws.receive({ type: 'IMALIVE', ts: 1 });
    await vi.advanceTimersByTimeAsync(100_000);

    expect(handlers.onClosed).not.toHaveBeenCalled();
  });
});

describe('Full Duplex send acknowledgement boundary', () => {
  it('throws on CONNECTING/closed and dispatches only on open', () => {
    const manager = new AgentManager('http://offline.invalid', 'user', 'pass');
    const handle = manager.connectFullDuplex('fd-session', 'fixture-vm', {
      historyMaxStepsCount: 20, maxScreenshotsDelay: 10,
      sharingParams: { connectionId: 'fixture', datasource: 'fixture', guacToken: 'fixture' },
    }, { onSessionOpened: vi.fn(), onStep: vi.fn(), onOutcome: vi.fn(), onError: vi.fn(), onClosed: vi.fn() });
    const ws = FakeWebSocket.instances.at(-1)!;
    expect(() => handle.sendTask('message')).toThrow('FULL_DUPLEX_CHANNEL_NOT_CONNECTED');
    ws.open(); handle.sendTask('message');
    expect(ws.sent.at(-1)).toEqual({ type: 'TASK', task: 'message' });
    handle.close();
    expect(() => handle.sendTask('late')).toThrow('FULL_DUPLEX_CHANNEL_NOT_CONNECTED');
    ws.close();
  });
});
