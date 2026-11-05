import { WebSocket } from 'ws';
import { z } from 'zod';
import { env } from '@/lib/config/env.js';
import { TimeoutException } from '@/lib/http/errors.js';
import { logger } from '@/lib/logger.js';
import { SoloIncomingMessageSchema, SoloModelCompletionSchema } from './agent-manager-v1.schema.js';
import {
  AGENT_MANAGER_V1_CLOSE_TIMEOUT_MS,
  AGENT_MANAGER_V1_HEALTH_PATH,
  AGENT_MANAGER_V1_HEARTBEAT_INTERVAL_MS,
  AGENT_MANAGER_V1_HEARTBEAT_TIMEOUT_MS,
  AGENT_MANAGER_V1_PROFILE_DEFAULT,
  AGENT_MANAGER_V1_WS_PATH,
  FULL_DUPLEX_TIMEOUT_MS, REQUEST_TIMEOUT_MS,
} from './agent-manager.constants.js';
import {
  FullDuplexOptions, FullDuplexHandlers, FullDuplexHandle,
  SoloSessionOptions, SoloSessionHandlers, SoloSessionHandle,
} from './agent-manager.types.js';
import { AgentProfileSchema } from './agent-profiles.schema.js';
import type { SoloSessionClosedReason } from './agent-manager.types.js';

const log = logger.child({ module: 'agent-manager-client' });
const logV1 = logger.child({ module: 'agent-manager-v1-client' });

function extractSoloStepDetails(
  diagnostics: Array<{
    event: string;
    completion?: string | undefined;
    action?: Record<string, unknown> | undefined;
  }> | undefined
): Pick<Parameters<SoloSessionHandlers['onStep']>[0], 'thought' | 'action_type' | 'action_inputs' | 'action_explanation'> {
  const completion = diagnostics?.find((item) => 'model_response' === item.event)?.completion;
  const executedAction = diagnostics?.find((item) => 'action' === item.event)?.action;
  const executedActionType = 'string' === typeof executedAction?.action_type
    ? executedAction.action_type
    : 'string' === typeof executedAction?.action ? executedAction.action : undefined;
  const executedArguments = executedAction?.['arguments'];
  const executedActionInputs = executedActionType && executedAction
    ? 'object' === typeof executedArguments && null !== executedArguments && !Array.isArray(executedArguments)
      ? executedArguments as Record<string, unknown>
      : Object.fromEntries(Object.entries(executedAction).filter(([key]) => 'action' !== key && 'action_type' !== key))
    : undefined;

  let modelDetails: ReturnType<typeof extractSoloStepDetails> = {};

  if (completion) {
    try {
      const result = SoloModelCompletionSchema.safeParse(JSON.parse(completion) as unknown);
      if (result.success) {
        const firstAction = result.data.actions?.[0];
        modelDetails = {
          ...(result.data.thought && { thought: result.data.thought }),
          ...(result.data.action_explanation && { action_explanation: result.data.action_explanation }),
          ...(firstAction && {
            action_type: firstAction.action_type,
            action_inputs: firstAction.arguments ?? {},
          }),
        };
      }
    } catch {
      // Невалидный model_response не должен скрывать фактически выполненное action.
    }
  }

  return {
    ...modelDetails,
    ...(executedActionType && {
      action_type: executedActionType,
      action_inputs: executedActionInputs ?? {},
    }),
  };
}

export interface AgentManagerOptions {
  // Путь health-check запроса и необходимость валидации JSON-тела ответа.
  // v1-сервис (SOLO) отдаёт голый 200 на /v1, старый REST-сервис (Full Duplex)
  // отдаёт {status:'ok'} на /health/live — поведение конфигурируется per-instance.
  healthCheckPath?: string;
  validateHealthBody?: boolean;
}

export class AgentManager {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly wsBase: string;
  private readonly healthCheckPath: string;
  private readonly validateHealthBody: boolean;
  constructor(baseUrl: string, username: string, password: string, options: AgentManagerOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    this.wsBase = this.baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    this.healthCheckPath = options.healthCheckPath ?? '/health/live';
    this.validateHealthBody = options.validateHealthBody ?? true;
  }

  private get authHeaders(): Record<string, string> {
    return { Authorization: this.authHeader };
  }

  private async fetch(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        log.warn({ url }, 'agent-manager: тайм-аут при обращении к API');
        throw new TimeoutException(`agent-manager: тайм-аут ${REQUEST_TIMEOUT_MS / 1000}s при обращении к ${url}`);
      }
      throw err;
    }
  }

  /** Получить ZIP логов Full Duplex-сессии без таймаута и буферизации тела. */
  async fetchFullDuplexSteps(sessionId: string, signal: AbortSignal): Promise<Response> {
    const url = `${this.baseUrl}/full_duplex/sessions/${encodeURIComponent(sessionId)}/steps.zip`;
    return fetch(url, {
      headers: this.authHeaders,
      signal,
    });
  }

  async listProfiles(): Promise<Array<{ id: string; displayName: string }>> {
    const response = await this.fetch(`${this.baseUrl}/profiles`, { headers: this.authHeaders });
    if (!response.ok) throw new Error(`Agent Manager profiles returned HTTP ${response.status}`);
    const profiles = z.record(z.string().min(1).max(200), AgentProfileSchema).parse(await response.json());
    return Object.entries(profiles).map(([id, profile]) => ({ id, displayName: profile.display_name }));
  }

  async isHealthy(): Promise<boolean> {
    const url = `${this.baseUrl}${this.healthCheckPath}`;
    try {
      const res = await this.fetch(url, { headers: this.authHeaders });
      if (!res.ok) return false;
      if (!this.validateHealthBody) {
        return true;
      }
      const data = (await res.json()) as { status?: string };
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  // Full-duplex-протокол: один двунаправленный WS на всё время сессии.
  // В отличие от connectThoughtStream — это read-write канал, и без автореконнекта:
  // OPEN_SESSION несёт лизинг VM/Guacamole-токен, разорванное соединение
  // равносильно потере сессии на стороне agent-сервиса (см. VM_LOST/VM_UNAVAILABLE
  // в контракте — оба fatal), повторный OPEN_SESSION её не восстановит.
  connectFullDuplex(
    sessionId: string,
    vmName: string,
    options: FullDuplexOptions,
    handlers: FullDuplexHandlers
  ): FullDuplexHandle {
    const url = `${this.wsBase}/full-duplex/${sessionId}`;
    log.info({ sessionId, url }, 'connecting to full-duplex WS');

    const ws = new WebSocket(url, { headers: { Authorization: this.authHeader } });
    // true, как только пришло сообщение SESSION_CLOSED — 'close' сокета после него
    // не должен повторно вызывать onClosed(ws_gone), причина уже известна.
    let sessionEnded = false;
    let closeRequested = false;
    let forceCloseTimer: ReturnType<typeof setTimeout> | null = null;

    const sendMessage = (msg: Record<string, unknown>): void => {
      log.info({ sessionId, direction: 'send', messageType: msg['type'] }, 'full-duplex WS: outgoing message');
      ws.send(JSON.stringify(msg));
    };

    ws.on('open', () => {
      if (closeRequested) { ws.close(); return; }
      log.info({ sessionId }, 'full-duplex WS connected, sending OPEN_SESSION');
      sendMessage({
        type: 'OPEN_SESSION',
        model_type: 'full-duplex',
        vm_name: vmName,
        connectionId: options.sharingParams.connectionId,
        datasource: options.sharingParams.datasource,
        guac_token: options.sharingParams.guacToken,
        history_max_steps_count: options.historyMaxStepsCount,
        max_screenshots_delay: options.maxScreenshotsDelay,
        // ...(options.model && { model: options.model }),
      });
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      try {
        const parsed = JSON.parse(data.toString('utf8')) as { type: string;[key: string]: unknown };
        log.info({ sessionId, direction: 'recv', payload: parsed }, 'full-duplex WS: incoming message');
        switch (parsed.type) {
          case 'SESSION_OPENED':
            handlers.onSessionOpened(parsed as unknown as Parameters<typeof handlers.onSessionOpened>[0]);
            break;
          case 'STEP':
            handlers.onStep(parsed as unknown as Parameters<typeof handlers.onStep>[0]);
            break;
          case 'OUTCOME':
            handlers.onOutcome(parsed as unknown as Parameters<typeof handlers.onOutcome>[0]);
            break;
          case 'ERROR':
            handlers.onError(parsed as unknown as Parameters<typeof handlers.onError>[0]);
            break;
          case 'SESSION_CLOSED':
            sessionEnded = true;
            if (forceCloseTimer) clearTimeout(forceCloseTimer);
            handlers.onClosed(parsed as unknown as Parameters<typeof handlers.onClosed>[0]);
            break;
          default:
            log.warn({ sessionId, messageType: parsed.type }, 'full-duplex WS: unknown message type');
        }
      } catch (err) {
        log.warn({ sessionId, err }, 'full-duplex WS: failed to parse message');
      }
    });

    ws.on('error', (err: Error) => {
      log.error({ sessionId, url, errorName: err.name, errorMessage: err.message }, 'full-duplex WS error');
    });

    ws.on('close', (code: number, reasonBuf: Buffer) => {
      log.info({ sessionId, code, reason: reasonBuf.toString('utf8'), sessionEnded }, 'full-duplex WS closed');
      if (forceCloseTimer) clearTimeout(forceCloseTimer);
      // Сокет закрылся, а сервер не успел прислать SESSION_CLOSED — сессия потеряна
      // не по нашей инициативе (сеть/рестарт сервиса), а не штатным CLOSE_SESSION.
      if (!sessionEnded) {
        sessionEnded = true;
        handlers.onClosed({ reason: 'ws_gone', step: -1, ts: Date.now() });
      }
    });

    return {
      sendTask: (text: string) => {
        if (closeRequested || ws.readyState !== ws.OPEN) throw new Error('FULL_DUPLEX_CHANNEL_NOT_CONNECTED');
        sendMessage({ type: 'TASK', task: text });
      },
      close: () => {
        if (closeRequested) return;
        closeRequested = true;
        if (ws.readyState !== ws.OPEN) { ws.close(); return; }
        sendMessage({ type: 'CLOSE_SESSION' });
        // Сервер сам закрывает соединение сразу после SESSION_CLOSED — форсим
        // закрытие только если он этого не сделал за разумное время.
        forceCloseTimer = setTimeout(() => ws.close(), FULL_DUPLEX_TIMEOUT_MS);
      },
    };
  }

  // SOLO v1-протокол: один двунаправленный WS на всю сессию (может пережить
  // несколько последовательных TASK). В отличие от Full Duplex, у CLOSE_SESSION
  // нет ack-сообщения от сервера — единственный сигнал завершения канала — само
  // событие 'close' сокета, поэтому onClosed вызывается только из него, а причина
  // закрытия определяется заранее через closedReason.
  connectSession(
    sessionId: string,
    options: SoloSessionOptions,
    initialTask: { taskId: string; text: string },
    handlers: SoloSessionHandlers
  ): SoloSessionHandle {
    const url = `${this.wsBase}${AGENT_MANAGER_V1_WS_PATH}`;
    logV1.info({ sessionId, url }, 'connecting to SOLO v1 WS');

    const ws = new WebSocket(url, {
      headers: { Authorization: this.authHeader, 'X-Request-Id': sessionId },
    });

    let closedReason: Parameters<SoloSessionHandlers['onClosed']>[0] | null = null;
    let closeRequested = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let forceCloseTimer: ReturnType<typeof setTimeout> | null = null;

    const sendMessage = (msg: Record<string, unknown>): void => {
      logV1.info({ sessionId, direction: 'send', messageType: msg['type'] }, 'SOLO v1 WS: outgoing message');
      ws.send(JSON.stringify(msg));
    };

    const clearTimers = (): void => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
      if (forceCloseTimer) { clearTimeout(forceCloseTimer); forceCloseTimer = null; }
    };

    const resetWatchdog = (): void => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        logV1.error({ sessionId }, 'SOLO v1 WS: no message from server within heartbeat timeout, terminating');
        closedReason = 'heartbeat_timeout';
        ws.terminate();
      }, AGENT_MANAGER_V1_HEARTBEAT_TIMEOUT_MS);
    };

    ws.on('open', () => {
      if (closeRequested) { ws.close(); return; }
      logV1.info({ sessionId }, 'SOLO v1 WS connected, sending OPEN_SESSION + TASK');
      sendMessage({
        type: 'OPEN_SESSION',
        vm_name: options.vmName,
        connection_id: options.connectionId,
        datasource: options.datasource,
        guac_token: options.guacToken,
        profile: options.profile ?? AGENT_MANAGER_V1_PROFILE_DEFAULT,
        config_override: {
          max_iterations: options.configOverride.maxIterations,
          model_retries: options.configOverride.modelRetries,
          actuator: {
            config: {
              mouse_click_delay: options.configOverride.mouseClickDelay,
              min_operation_delay: options.configOverride.minOperationDelay,
            },
          },
        },
      });
      // По протоколу задача отправляется сразу после OPEN_SESSION, без ожидания ответа сервера.
      if (!options.deferredFirstTask) sendMessage({ type: 'TASK', task_id: initialTask.taskId, text: initialTask.text });

      heartbeatTimer = setInterval(() => {
        if (ws.readyState === ws.OPEN) sendMessage({ type: 'IMALIVE' });
      }, AGENT_MANAGER_V1_HEARTBEAT_INTERVAL_MS);
      resetWatchdog();
      handlers.onOpen?.();
    });

    ws.on('message', (data, isBinary) => {
      if (closeRequested) return;
      resetWatchdog();
      if (isBinary) return;
      const raw = data.toString('utf8');
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch (err) {
        logV1.warn({ sessionId, err }, 'SOLO v1 WS: failed to parse message as JSON');
        return;
      }
      const result = SoloIncomingMessageSchema.safeParse(parsedJson);
      if (!result.success) {
        logV1.warn({ sessionId, raw: raw.slice(0, 1000), issues: result.error.issues }, 'SOLO v1 WS: message failed schema validation');
        return;
      }
      const message = result.data;
      logV1.info({ sessionId, direction: 'recv', payload: message }, 'SOLO v1 WS: incoming message');

      switch (message.type) {
        case 'STEP':
          handlers.onStep({
            step: message.step,
            ts: message.ts,
            text: message.text,
            status: message.status,
            ...extractSoloStepDetails(message.diagnostics),
            ...(message.diagnostics ? { executedActions: message.diagnostics
              .filter((item) => item.event === 'action' && item.action)
              .flatMap((item) => {
                const action = item.action!;
                const type = typeof action.action_type === 'string' ? action.action_type
                  : typeof action.action === 'string' ? action.action : null;
                if (!type) return [];
                const inputs = typeof action['arguments'] === 'object' && action['arguments'] !== null && !Array.isArray(action['arguments'])
                  ? action['arguments'] as Record<string, unknown>
                  : Object.fromEntries(Object.entries(action).filter(([key]) => key !== 'action' && key !== 'action_type'));
                return [{ type, inputs }];
              }) } : {}),
          });
          break;
        case 'DIAGNOSTICS':
          handlers.onDiagnostics({ ts: message.ts, level: message.level, event: message.event, raw });
          if (message.level === 'FATAL' || message.level === 'CRITICAL') {
            logV1.error({ sessionId, level: message.level, event: message.event }, 'SOLO v1 WS: fatal/critical diagnostics, closing session');
            closedReason = 'FATAL' === message.level ? 'fatal_diagnostics' : 'critical_diagnostics';
            ws.close();
          }
          break;
        case 'IMALIVE':
          break;
      }
    });

    ws.on('error', (err: Error) => {
      logV1.error({ sessionId, url, errorName: err.name, errorMessage: err.message }, 'SOLO v1 WS error');
    });

    ws.on('close', (code: number, reasonBuf: Buffer) => {
      logV1.info({ sessionId, code, reason: reasonBuf.toString('utf8'), closedReason }, 'SOLO v1 WS closed');
      clearTimers();
      handlers.onClosed(closedReason ?? 'ws_gone');
    });

    return {
      sendTask: (text: string, taskId: string) => {
        if (closeRequested || ws.readyState !== ws.OPEN) throw new Error('SOLO_CHANNEL_NOT_CONNECTED');
        sendMessage({ type: 'TASK', task_id: taskId, text });
      },
      cancelTask: () => {
        if (ws.readyState !== ws.OPEN) {
          logV1.warn({ sessionId }, 'SOLO v1: cancelTask called on non-open socket, ignoring');
          return;
        }
        sendMessage({ type: 'CANCEL_TASK' });
      },
      close: (reason: SoloSessionClosedReason = 'client_request') => {
        if (closeRequested) return;
        closeRequested = true;
        closedReason = reason;
        if (ws.readyState !== ws.OPEN) { clearTimers(); ws.close(); return; }
        sendMessage({ type: 'CLOSE_SESSION' });
        // Протокол не предусматривает ack на CLOSE_SESSION — форсим закрытие,
        // если сервер сам не закроет сокет за разумное время.
        forceCloseTimer = setTimeout(() => ws.close(), AGENT_MANAGER_V1_CLOSE_TIMEOUT_MS);
      },
    };
  }
}

// ─── Синглтон ─────────────────────────────────────────────────────────────────

export const agentManager = new AgentManager(
  env.AGENT_MANAGER_API_URL,
  env.AGENT_MANAGER_USERNAME,
  env.AGENT_MANAGER_PASSWORD,
  { healthCheckPath: AGENT_MANAGER_V1_HEALTH_PATH, validateHealthBody: false }
);

export const fullDuplexAgentManager = new AgentManager(
  env.FULL_DUPLEX_API_URL,
  env.FULL_DUPLEX_USERNAME,
  env.FULL_DUPLEX_PASSWORD
);
