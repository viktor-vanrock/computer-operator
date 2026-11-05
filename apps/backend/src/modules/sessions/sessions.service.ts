import { randomUUID } from 'node:crypto';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { agentManager, fullDuplexAgentManager } from '@/lib/agent/agent-manager.client.js';
import {
  FullDuplexClosedPayload, FullDuplexHandle,
  SoloSessionClosedReason, SoloSessionHandle, SoloStepPayload,
} from '@/lib/agent/agent-manager.types.js';
import { env } from '@/lib/config/env.js';
import { prisma } from '@/lib/db/prisma.js';
import { guacamoleClient } from '@/lib/guacamole/index.js';
import { BadRequestException, HttpError, NotFoundException, UnauthorizedException } from '@/lib/http/errors.js';
import { logger } from '@/lib/logger.js';
import {
  agentStartDurationSeconds,
  metricsService,
  sessionDurationSeconds,
  sessionsActive,
  sessionsCompletedTotal,
  sessionsCreatedTotal,
  sessionsFailedTotal,
} from '@/lib/metrics/metrics.js';
import { sessionRuntimeOwner } from '@/lib/session-runtime-owner.js';
import { WS_EVENT_TYPES } from '../arena/arena.constants.js';
import { broadcast } from '../arena/arena.router.js';
import { tasksService } from '../tasks/tasks.service.js';
import { recoverLegacySessions } from './legacy-session-recovery.js';
import { creationHash } from './race/race-actions.service.js';
import { raceCoordinator } from './race/race-coordinator.js';
import { recoverRaces } from './race/race-recovery.js';
import { raceStateRepository } from './race/race-state.repository.js';
import { runtimeProfile, selectedProfile } from './session-profiles.js';
import { DEFAULT_IMAGE_BY_OS, FULL_DUPLEX_DEFAULTS, FAILURE_REASONS, PREPARING_TIMEOUT_MS, PRISMA_RECORD_NOT_EXIST_ERROR, SESSION_STATUSES, SOLO_DEFAULTS } from './sessions.constants.js';
import { serialize } from './sessions.util.js';
import { vmClaimsService } from './vm-claims/vm-claims.service.js';
import { vmCleanupService } from './vm-claims/vm-cleanup.service.js';
import type { OsOption } from './sessions.constants.js';
import type { CreateSessionInput, Session, UpdateSessionInput, RawSession, SessionStatus, ModelOption } from './sessions.types.js';


const log = logger.child({ module: 'sessions' });
const creationReceipts = new WeakSet<Session>();

// Heartbeat-функции для поддержания Guacamole-токена живым (TTL ≈60 мин)
const guacHeartbeatStops = new Map<string, () => void>();

// Хранилища для SOLO v1-протокола (единый WS-канал на всю сессию)
const soloSessionHandles = new Map<string, SoloSessionHandle>();
// Сессии, для которых уже выставлен статус RUNNING — используется как guard от
// лишнего sessionsActive.dec()/consumeSessionStart(), если сокет упал раньше этого момента.
const soloRunningSessions = new Set<string>();
// Guard от двойного вызова _finalizeSolo (гонка handle.close() + onClosed).
const soloFinalizingSessionIds = new Set<string>();

// authToken Guacamole, полученный при startAgent — переиспользуется в completeAgentStart
const pendingGuacTokens = new Map<string, string>();

// Таймер ожидания /guacamole-ready после перехода в PREPARING (SOLO и FULL_DUPLEX).
// Если фронтенд не подтвердил подключение за PREPARING_TIMEOUT_MS — сессия считается зависшей.
const preparingTimeouts = new Map<string, NodeJS.Timeout>();

// Хранилища для Full Duplex-режима
const fullDuplexHandles = new Map<string, FullDuplexHandle>();
// Сессии, для которых пришёл SESSION_OPENED — используется как guard от лишнего
// sessionsActive.dec()/consumeSessionStart(), если сессия упала ещё в STARTING.
const fullDuplexRunningSessions = new Set<string>();
// Guard от двойного вызова _finalizeFullDuplex (гонка handle.close() + onClosed).
// Проверяется и выставляется синхронно до первого await, что гарантирует эксклюзивность
// в однопоточной event-loop Node.js.
const fullDuplexFinalizingSessionIds = new Set<string>();

// Дедуплицирует параллельные restart-запросы внутри одного процесса. Уникальный
// индекс в БД остаётся окончательной защитой при нескольких инстансах backend.
const restartPromises = new Map<string, Promise<Session>>();
const startingSessions = new Map<string, Promise<void>>();

// Единая точка разрешения image для резервирования VM из пула: явный customImageId
// приоритетнее дефолтного образа выбранной ОС. Вызывающий код (startAgent) уже
// гарантирует, что хотя бы одно из полей задано — здесь остаётся только случай
// устаревшего/неизвестного значения arenaOs, отсутствующего в DEFAULT_IMAGE_BY_OS.
function resolveImage(
  session: { arenaOs: string | null; customImageId: string | null; resolvedImageId?: string | null | undefined }
): string {
  if (session.resolvedImageId) return session.resolvedImageId;
  if (session.customImageId) return session.customImageId;
  const image = session.arenaOs ? DEFAULT_IMAGE_BY_OS[session.arenaOs as OsOption] : undefined;
  if (!image) {
    throw new BadRequestException(
      `No default image configured for arenaOs "${session.arenaOs}"`,
      FAILURE_REASONS.ARENA_OS_UNMAPPED
    );
  }
  return image;
}

function deleteVmSilent(_vmName: string, sessionId: string): void {
  void vmCleanupService.cleanup(sessionId, true).catch((err: unknown) => {
    log.warn({ sessionId, err }, 'Durable VM cleanup failed; persisted resources remain queued');
  });
}

function clearPreparingTimeout(sessionId: string): void {
  const timeout = preparingTimeouts.get(sessionId);
  if (timeout) {
    clearTimeout(timeout);
    preparingTimeouts.delete(sessionId);
  }
}

// Атомарно переводит сессию в терминальный статус, только если она ещё не COMPLETED/FAILED.
// Возвращает true, если именно этот вызов выполнил переход — используется как guard от
// двойного инкремента sessionsCompletedTotal/sessionsFailedTotal/sessionsActive при гонке
// между несколькими путями финализации одной сессии (например, stopAgent и
// onClosed-колбэк агент-менеджера могут сработать почти одновременно).
async function tryFinalizeStatus(
  sessionId: string,
  status: typeof SESSION_STATUSES.COMPLETED | typeof SESSION_STATUSES.FAILED,
  extraData: Record<string, unknown> = {}
): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, status: { notIn: [SESSION_STATUSES.COMPLETED, SESSION_STATUSES.FAILED] } },
    data: { ...extraData, status },
  });
  if (result.count > 0) {
    log.info({ sessionId, status }, 'session status changed');
  }
  return result.count > 0;
}

// Фронтенд обязан прислать /guacamole-ready вскоре после PREPARING (получив sync+resize
// от Guacamole-туннеля). Если этого не произошло — рабочий стол не отрисовался (чёрный экран,
// зависшая ВМ и т.п.), а фронтенд бесконечно показывает PreparingLoader. Этот таймер —
// единственный сторож на бэкенде, который выводит такую сессию из подвешенного состояния.
function schedulePreparingTimeout(sessionId: string): void {
  clearPreparingTimeout(sessionId);
  const timeout = setTimeout(() => {
    preparingTimeouts.delete(sessionId);
    void (async () => {
      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!session || session.status !== SESSION_STATUSES.PREPARING) return;

      log.warn({ sessionId }, 'pipeline: PREPARING timed out waiting for guacamole-ready, marking FAILED');
      pendingGuacTokens.delete(sessionId);
      sessionsFailedTotal.inc({ reason: 'PREPARING_TIMEOUT' });
      await sessionsService.setStatus(sessionId, SESSION_STATUSES.FAILED);
      broadcast(sessionId, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: SESSION_STATUSES.FAILED } });

      if (session.vmName) deleteVmSilent(session.vmName, sessionId);
    })().catch((err: unknown) => {
      log.error({ sessionId, err }, 'schedulePreparingTimeout: cleanup failed, session may be stuck in PREPARING');
    });
  }, PREPARING_TIMEOUT_MS);
  preparingTimeouts.set(sessionId, timeout);
}

const SOLO_OUTCOME_MAPPING = {
  DONE: { kind: 'finished', value: 'positive' },
  FAILED: { kind: 'finished', value: 'negative' },
  CANCELLED: { kind: 'aborted', value: 'user' },
} as const;

// Терминальный STEP.status ('DONE'/'FAILED'/'CANCELLED') транслируется фронтенду
// как AGENT_OUTCOME — переиспользуем существующую схему события вместо ввода нового типа.
function mapSoloOutcome(payload: SoloStepPayload): { step: number; ts: number; kind: 'finished' | 'aborted'; value: 'positive' | 'negative' | 'user' | 'env' } {
  const mapping = SOLO_OUTCOME_MAPPING[payload.status as keyof typeof SOLO_OUTCOME_MAPPING];
  return { step: payload.step, ts: payload.ts, kind: mapping.kind, value: mapping.value };
}

export const sessionsService = {
  wasCreated(session: Session): boolean { return creationReceipts.has(session); },
  drainRuntime(): void {
    raceCoordinator.drainRuntime();
    for (const handle of soloSessionHandles.values()) handle.close();
    for (const handle of fullDuplexHandles.values()) handle.close();
    soloSessionHandles.clear();
    fullDuplexHandles.clear();
    for (const stop of guacHeartbeatStops.values()) stop();
    guacHeartbeatStops.clear();
    for (const timeout of preparingTimeouts.values()) clearTimeout(timeout);
    preparingTimeouts.clear();
    pendingGuacTokens.clear();
  },

  async recoverRuntime(): Promise<void> {
    await recoverLegacySessions();
    const uncertainPending = await prisma.vmAcquisitionAttempt.findMany({ where: {
      session: { status: SESSION_STATUSES.PENDING, mode: { not: 'HUMAN_VS_AGENT' } }, status: { in: ['PENDING', 'ASSIGNED', 'COMPENSATING'] },
    }, select: { sessionId: true } });
    for (const attempt of uncertainPending) await tryFinalizeStatus(attempt.sessionId, SESSION_STATUSES.FAILED);
    await vmCleanupService.retryTerminal();
    await recoverRaces();
  },

  async create(input: CreateSessionInput, key: string | null = null, hash = creationHash(input)): Promise<Session> {
    if (key) {
      const previous = await prisma.session.findUnique({ where: { creationKey: key } });
      if (previous) {
        if (previous.creationHash !== hash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Different creation intent');
        return this.findById(previous.id);
      }
    }
    const profile = input.mode === 'FULL_DUPLEX' ? null : await selectedProfile(input.agentLeftModel);
    if (input.mode === 'HUMAN_VS_AGENT') {
      if (!key) throw new BadRequestException('Creation key is required', 'IDEMPOTENCY_KEY_REQUIRED');
      const task = await tasksService.findById(input.taskId!);
      const imageId = input.customImageId ?? task.imageId ?? resolveImage({ arenaOs: input.arenaOs ?? null, customImageId: null });
      const state = await raceStateRepository.create({
        taskId: task.id, difficulty: input.difficulty, imageId, title: task.title, prompt: task.prompt,
        creationKey: key, creationHash: hash, modelLabel: profile!.displayName, config: { difficulty: input.difficulty,
          arenaOs: input.arenaOs ?? null, customImageId: input.customImageId ?? null,
          agentLeftModel: profile!.id,
          maxIterations: input.maxIterations ?? SOLO_DEFAULTS.MAX_ITERATIONS,
          modelRetries: input.modelRetries ?? SOLO_DEFAULTS.MODEL_RETRIES,
          mouseClickDelay: input.mouseClickDelay ?? SOLO_DEFAULTS.MOUSE_CLICK_DELAY,
          minOperationDelay: input.minOperationDelay ?? SOLO_DEFAULTS.MIN_OPERATION_DELAY,
        },
        autoFinishOnAgent: input.autoFinishOnAgent ?? true,
      });
      const result = serialize(state as unknown as RawSession);
      if (state.created) creationReceipts.add(result);
      return result;
    }
    let taskId: string | null = null;
    let taskImageId: string | null = null;
    if (input.mode !== 'FULL_DUPLEX') {
      if (!input.taskId) {
        throw new BadRequestException('taskId is required for SOLO', 'TASK_ID_MISSING');
      }
      const task = await tasksService.findById(input.taskId);
      if (!task) {
        throw new BadRequestException('Task not found');
      }
      taskId = task.id;
      taskImageId = task.imageId;
    }

    let created = true;
    const session = await prisma.session.create({
      data: {
        taskId,
        creationKey: key,
        creationHash: key ? hash : null,
        mode: input.mode,
        difficulty: input.difficulty,
        arenaOs: input.arenaOs ?? (input.mode === 'FULL_DUPLEX' && !input.customImageId ? 'ubuntu2204' : null),
        customImageId: input.customImageId ?? taskImageId ?? null,
        resolvedImageId: input.mode === 'FULL_DUPLEX'
          ? resolveImage({ arenaOs: input.arenaOs ?? 'ubuntu2204', customImageId: input.customImageId ?? null }) : null,
        agentLeftModel: 'SOLO' === input.mode ? (input.agentLeftModel ?? 'computer-operator') : null,
        ...(input.mode === 'FULL_DUPLEX' && {
          historyMaxStepsCount: input.historyMaxStepsCount ?? FULL_DUPLEX_DEFAULTS.HISTORY_MAX_STEPS_COUNT,
          maxScreenshotsDelay: input.maxScreenshotsDelay ?? FULL_DUPLEX_DEFAULTS.MAX_SCREENSHOTS_DELAY,
        }),
        ...(input.mode === 'SOLO' && {
          maxIterations: input.maxIterations ?? SOLO_DEFAULTS.MAX_ITERATIONS,
          modelRetries: input.modelRetries ?? SOLO_DEFAULTS.MODEL_RETRIES,
          mouseClickDelay: input.mouseClickDelay ?? SOLO_DEFAULTS.MOUSE_CLICK_DELAY,
          minOperationDelay: input.minOperationDelay ?? SOLO_DEFAULTS.MIN_OPERATION_DELAY,
        }),
      },
      include: { metrics: true },
    }).catch(async (err: unknown) => {
      if (key && err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        const saved = await prisma.session.findUnique({ where: { creationKey: key }, include: { metrics: true } });
        if (saved?.creationHash === hash) { created = false; return saved; }
        if (saved) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Different creation intent');
      }
      throw err;
    });

    sessionsCreatedTotal.inc({ mode: session.mode, difficulty: String(session.difficulty) });
    log.info({ sessionId: session.id, taskId: session.taskId }, 'session created');
    const result = serialize(session as unknown as RawSession);
    if (created) creationReceipts.add(result);
    return result;
  },

  async findById(id: string): Promise<Session> {
    const session = await prisma.session.findUnique({
      where: { id },
      include: { metrics: true },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    if (session.mode === 'HUMAN_VS_AGENT') {
      return serialize(await raceStateRepository.snapshot(id) as unknown as RawSession);
    }
    return serialize(session as unknown as RawSession);
  },

  async update(id: string, input: UpdateSessionInput): Promise<Session> {
    if ((await this.findById(id)).mode === 'HUMAN_VS_AGENT') throw new HttpError(409, 'RACE_MANAGED_STATE', 'Race manages its state');
    const { status, metrics } = input;

    try {
      const session = await prisma.$transaction(async (tx) => {
        return tx.session.update({
          where: { id },
          data: {
            ...(status && { status }),
            ...(metrics && {
              metrics: {
                upsert: metrics.map((m) => ({
                  where: { sessionId_participant: { sessionId: id, participant: m.participant } },
                  create: m,
                  update: m,
                })),
              },
            }),
          },
          include: { metrics: true },
        });
      });

      if (status) {
        log.info({ sessionId: id, status }, 'session status changed');
      }
      return serialize(session as unknown as RawSession);
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === PRISMA_RECORD_NOT_EXIST_ERROR) {
        log.error({ err, sessionId: id }, 'prisma error on session update');
        throw new NotFoundException('Session not found');
      }
      log.error({ err, sessionId: id }, 'unexpected error on session update');
      throw err;
    }
  },

  async setConnectArgs(id: string, connectArgs: string): Promise<Session> {
    try {
      const session = await prisma.session.update({
        where: { id },
        data: { connectArgs },
        include: { metrics: true },
      });
      return serialize(session as unknown as RawSession);
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === PRISMA_RECORD_NOT_EXIST_ERROR) {
        throw new NotFoundException('Session not found');
      }
      throw err;
    }
  },

  async setStatus(id: string, status: SessionStatus): Promise<Session> {
    try {
      const session = await prisma.session.update({
        where: { id },
        data: { status },
        include: { metrics: true },
      });
      log.info({ sessionId: id, status }, 'session status changed');
      return serialize(session as unknown as RawSession);
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === PRISMA_RECORD_NOT_EXIST_ERROR) {
        log.error({ err, sessionId: id }, 'prisma error on setStatus');
        throw new NotFoundException('Session not found');
      }
      log.error({ err, sessionId: id }, 'unexpected error on setStatus');
      throw err;
    }
  },

  async startAgent(id: string): Promise<Session> {
    sessionRuntimeOwner.requireReady();
    const session = await this.findById(id);

    if (session.mode === 'HUMAN_VS_AGENT') {
      void raceCoordinator.prepare(id).catch((err: unknown) => {
        log.error({ sessionId: id, err }, 'Race preparation failed');
        void raceCoordinator.finish(id, 'START_FAILED').catch(() => {});
      });
      return this.findById(id);
    }
    if (session.status !== SESSION_STATUSES.PENDING) {
      log.warn({ sessionId: id }, 'session has already been started');
      throw new BadRequestException('Session has already been started', 'SESSION_ALREADY_STARTED');
    }

    if (!session.arenaOs && !session.customImageId) {
      throw new BadRequestException('arenaOs or customImageId is required', 'ARENA_OS_MISSING');
    }

    return this._startWithReservedVm(id, session);
  },

  async _startWithReservedVm(id: string, session: Session): Promise<Session> {
    const agentStartedAt = Date.now();

    let image: string;
    try {
      image = resolveImage(session);
    } catch (err) {
      log.error({ sessionId: id, err }, 'Failed to resolve image for VM reservation');
      sessionsFailedTotal.inc({ reason: FAILURE_REASONS.ARENA_OS_UNMAPPED });
      await this.setStatus(id, SESSION_STATUSES.FAILED);
      broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: SESSION_STATUSES.FAILED } });
      throw err;
    }

    const transition = await prisma.session.updateMany({
      where: { id, status: SESSION_STATUSES.PENDING },
      data: { status: SESSION_STATUSES.PREPARING, resolvedImageId: image },
    });
    if (!transition.count) return this.findById(id);
    schedulePreparingTimeout(id);
    try {
      const vm = await vmClaimsService.acquire(id, 'AGENT', image);
      sessionRuntimeOwner.requireReady();
      const claimed = await prisma.session.updateMany({
        where: { id, status: SESSION_STATUSES.PREPARING },
        data: { vmName: vm.vmName, guacId: vm.connectionId },
      });
      if (!claimed.count) {
        await vmCleanupService.cleanup(id, true);
        return this.findById(id);
      }
      return this._completeVmAcquisition(id, vm.vmName, vm.connectionId, agentStartedAt);
    } catch (err) {
      log.error({ sessionId: id, err }, 'VM acquisition failed');
      const transitioned = await tryFinalizeStatus(id, SESSION_STATUSES.FAILED);
      if (transitioned) {
        sessionsFailedTotal.inc({ reason: FAILURE_REASONS.VM_RESERVATION_EXHAUSTED });
        broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: SESSION_STATUSES.FAILED } });
      }
      clearPreparingTimeout(id);
      deleteVmSilent('', id);
      throw new BadRequestException('Не удалось подготовить виртуальную машину', FAILURE_REASONS.VM_RESERVATION_EXHAUSTED);
    }
  },

  async _completeVmAcquisition(id: string, vmName: string, guacId: string, agentStartedAt: number): Promise<Session> {
    let connectArgs: string;
    try {
      log.info({ sessionId: id, step: 'getAuthToken' }, 'pipeline: getting Guacamole auth token');
      const authToken = await guacamoleClient.getAuthToken();
      pendingGuacTokens.set(id, authToken);
      connectArgs = guacamoleClient.buildConnectArgs(authToken, guacId);
      log.info({ sessionId: id, step: 'buildConnectArgs' }, 'pipeline: connectArgs built, saving to DB');
    } catch (err) {
      log.error({ sessionId: id, err, step: 'getAuthToken' }, 'pipeline: Guacamole auth failed');
      pendingGuacTokens.delete(id);
      const didTransition = await tryFinalizeStatus(id, SESSION_STATUSES.FAILED);
      if (didTransition) {
        sessionsFailedTotal.inc({ reason: FAILURE_REASONS.GUACAMOLE_AUTH_FAILED });
        broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: SESSION_STATUSES.FAILED } });
      }
      deleteVmSilent(vmName, id);
      const { message } = err as Error;
      throw new BadRequestException(message, FAILURE_REASONS.GUACAMOLE_AUTH_FAILED);
    }

    log.info({ sessionId: id, step: 'PREPARING' }, 'pipeline: saving connectArgs, status → PREPARING');
    const authToken = pendingGuacTokens.get(id);
    // updateMany с условием по статусу вместо простого update: сессия могла быть
    // параллельно остановлена через /stop, пока провижининг ждал готовности VM
    // (окно — минуты). Если она уже COMPLETED/FAILED, count будет 0 — не затираем
    // терминальный статус и не подключаем никому не нужную VM.
    const transition = await prisma.session.updateMany({
      where: { id, status: { notIn: [SESSION_STATUSES.COMPLETED, SESSION_STATUSES.FAILED] } },
      data: { connectArgs, guacAuthToken: authToken ?? null, status: SESSION_STATUSES.PREPARING },
    });

    if (transition.count === 0) {
      log.warn({ sessionId: id }, 'pipeline: session already finalized, discarding PREPARING transition');
      deleteVmSilent(vmName, id);
      return this.findById(id);
    }

    const updated = await this.findById(id);
    broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: SESSION_STATUSES.PREPARING, connectArgs } });
    agentStartDurationSeconds.observe((Date.now() - agentStartedAt) / 1000);
    return updated;
  },

  async completeAgentStart(id: string, tunnelId?: string): Promise<void> {
    const running = startingSessions.get(id);
    if (running) return running;
    const operation = this._completeAgentStart(id, tunnelId);
    startingSessions.set(id, operation);
    try { await operation; } finally { startingSessions.delete(id); }
  },

  async _completeAgentStart(id: string, tunnelId?: string): Promise<void> {
    sessionRuntimeOwner.requireReady();
    const session = await this.findById(id);

    if (session.status !== SESSION_STATUSES.PREPARING) {
      log.warn({ sessionId: id, status: session.status }, 'pipeline: completeAgentStart called in wrong status, ignoring');
      return;
    }

    clearPreparingTimeout(id);

    if (!session.vmName || !session.guacId) {
      log.error({ sessionId: id }, 'pipeline: vmName or guacId missing in completeAgentStart');
      await this.setStatus(id, SESSION_STATUSES.FAILED);
      broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: SESSION_STATUSES.FAILED } });
      return;
    }

    if (session.mode === 'FULL_DUPLEX') {
      return this._completeFullDuplexStart(id, session, session.vmName, session.guacId);
    }

    if (!session.taskId) {
      log.error({ sessionId: id }, 'pipeline: taskId missing for SOLO session');
      await this.setStatus(id, SESSION_STATUSES.FAILED);
      broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: SESSION_STATUSES.FAILED } });
      deleteVmSilent(session.vmName, id);
      return;
    }

    const task = await tasksService.findById(session.taskId);
    const taskPrompt = task.prompt;

    let sharingProfileId: string;
    let sharingParams: { connectionId: string; datasource: string; guacToken: string };
    // Объявляем в outer scope — нужен после try-блока для запуска heartbeat
    let guacAuthToken: string;
    try {
      log.info({ sessionId: id, guacId: session.guacId, step: 'buildSharingParams' }, 'pipeline: building sharing params');
      // pendingGuacTokens хранится только в памяти — при рестарте сервера падает.
      // Fallback: читаем токен из БД, куда он был сохранён в startAgent.
      const authToken = pendingGuacTokens.get(id) ?? session.guacAuthToken;
      pendingGuacTokens.delete(id);
      guacAuthToken = authToken ?? '';
      if (!authToken) {
        throw new UnauthorizedException('Guacamole auth token not found — session may have expired');
      }
      const sp = tunnelId
        ? await guacamoleClient.buildSharingParamsWithTunnel(authToken, session.guacId, tunnelId)
        : await guacamoleClient.buildSharingParams(authToken, session.guacId);
      sharingProfileId = sp.sharingProfileId;
      sharingParams = { connectionId: sp.connectionId, datasource: sp.datasource, guacToken: sp.guacToken };
      // Сохраняем tunnelId в БД — он нужен для startNextTask.getSharingKey,
      // так как /api/session/tunnels/ работает только с оригинальным токеном.
      await prisma.session.update({ where: { id }, data: { guacTunnelId: sp.tunnelId } });
      log.info({
        sessionId: id,
        sharingProfileId,
        tunnelId: sp.tunnelId,
        connectionId: sp.connectionId,
        datasource: sp.datasource,
        guacTokenLength: sp.guacToken.length,
        step: 'buildSharingParams',
      }, 'pipeline: sharing params ready');
    } catch (err) {
      log.error({ sessionId: id, err, step: 'buildSharingParams' }, 'pipeline: Guacamole sharing params failed');
      sessionsFailedTotal.inc({ reason: FAILURE_REASONS.GUACAMOLE_SHARING_FAILED });
      if (await tryFinalizeStatus(id, SESSION_STATUSES.FAILED)) {
        broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: SESSION_STATUSES.FAILED } });
      }
      deleteVmSilent(session.vmName, id);
      return;
    }

    const profile = await runtimeProfile(session.agentLeftModel);
    const initialTaskId = randomUUID();
    sessionRuntimeOwner.requireReady();
    const ready = await prisma.session.updateMany({
      where: { id, status: SESSION_STATUSES.PREPARING },
      data: { agentTaskUuid: initialTaskId, sharingProfileId },
    });
    if (!ready.count) {
      deleteVmSilent(session.vmName, id);
      return;
    }

    log.info({ sessionId: id, taskId: initialTaskId, step: 'connectSession' }, 'pipeline: opening SOLO v1 WS');
    const handle = agentManager.connectSession(
      id,
      {
        profile,
        vmName: session.vmName,
        connectionId: sharingParams.connectionId,
        datasource: sharingParams.datasource,
        guacToken: sharingParams.guacToken,
        configOverride: {
          maxIterations: session.maxIterations ?? SOLO_DEFAULTS.MAX_ITERATIONS,
          modelRetries: session.modelRetries ?? SOLO_DEFAULTS.MODEL_RETRIES,
          mouseClickDelay: session.mouseClickDelay ?? SOLO_DEFAULTS.MOUSE_CLICK_DELAY,
          minOperationDelay: session.minOperationDelay ?? SOLO_DEFAULTS.MIN_OPERATION_DELAY,
        },
      },
      { taskId: initialTaskId, text: taskPrompt },
      {
        onStep: (payload) => {
          broadcast(id, { type: WS_EVENT_TYPES.AGENT_THOUGHT, payload });
          if (payload.status !== 'INCOMPLETE') {
            broadcast(id, { type: WS_EVENT_TYPES.AGENT_OUTCOME, payload: mapSoloOutcome(payload) });
          }
        },
        onDiagnostics: (payload) => {
          if (payload.level === 'FATAL' || payload.level === 'CRITICAL') {
            const severity = 'FATAL' === payload.level ? 'фатальной' : 'критической';
            broadcast(id, {
              type: WS_EVENT_TYPES.AGENT_ERROR,
              payload: {
                code: payload.event,
                message: `Agent-manager сообщил о ${severity} ошибке: ${payload.event}`,
                fatal: true,
                step: null,
                ts: payload.ts,
              },
            });
          }
        },
        onClosed: (reason) => {
          soloSessionHandles.delete(id);
          this._finalizeSolo(id, reason).catch((err: unknown) => {
            log.error({ sessionId: id, err }, 'SOLO: finalize failed');
          });
        },
      }
    );
    soloSessionHandles.set(id, handle);

    // Heartbeat продлевает TTL оригинального Guacamole-токена каждые 30 мин.
    // Без него следующий TASK в этой же сессии рискует упереться в протухший токен.
    guacHeartbeatStops.set(id, guacamoleClient.startHeartbeat(guacAuthToken, env.GUAC_HEARTBEAT_INTERVAL_MS));

    log.info({ sessionId: id, step: 'RUNNING' }, 'pipeline: status → RUNNING');
    const started = await prisma.session.updateMany({
      where: { id, status: SESSION_STATUSES.PREPARING }, data: { status: SESSION_STATUSES.RUNNING },
    });
    if (!started.count) {
      handle.close();
      deleteVmSilent(session.vmName, id);
      return;
    }
    soloRunningSessions.add(id);
    sessionsActive.inc();
    metricsService.recordSessionStart(id);
    broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: SESSION_STATUSES.RUNNING } });
  },

  async _finalizeSolo(id: string, reason: SoloSessionClosedReason): Promise<void> {
    // Синхронный guard от двойного вызова (гонка handle.close() + onClosed).
    if (soloFinalizingSessionIds.has(id)) {
      log.warn({ sessionId: id, reason }, 'SOLO finalize: already in progress, skipping');
      return;
    }
    soloFinalizingSessionIds.add(id);

    try {
      soloSessionHandles.delete(id);
      const stopHb = guacHeartbeatStops.get(id);
      if (stopHb) {
        stopHb();
        guacHeartbeatStops.delete(id);
      }

      const session = await this.findById(id).catch(() => null);
      if (session?.status === SESSION_STATUSES.COMPLETED || session?.status === SESSION_STATUSES.FAILED) {
        log.info({ sessionId: id, reason, status: session.status }, 'SOLO finalize: session already finalized, skipping');
        return;
      }
      if (session?.vmName) {
        deleteVmSilent(session.vmName, id);
      }

      const wasRunning = soloRunningSessions.delete(id);
      // COMPLETED только если сессия реально дошла до RUNNING и остановлена клиентом
      // (кнопка «Завершить» → CLOSE_SESSION). Любая другая причина — FAILED.
      const targetStatus = 'client_request' === reason && wasRunning
        ? SESSION_STATUSES.COMPLETED
        : SESSION_STATUSES.FAILED;

      const didTransition = await tryFinalizeStatus(id, targetStatus);
      if (!didTransition) {
        log.warn({ sessionId: id, reason }, 'SOLO finalize: session already finalized elsewhere, skipping metrics/broadcast');
        return;
      }

      if (wasRunning) {
        if (SESSION_STATUSES.COMPLETED === targetStatus) {
          const durationSeconds = metricsService.consumeSessionStart(id);
          if (durationSeconds !== undefined) {
            sessionDurationSeconds.observe(durationSeconds);
            await prisma.sessionMetrics.upsert({
              where: { sessionId_participant: { sessionId: id, participant: 'AGENT' } },
              create: { sessionId: id, participant: 'AGENT', time: Math.round(durationSeconds), steps: 0, clicks: 0, errors: 0, retries: 0 },
              update: { time: Math.round(durationSeconds) },
            });
          }
          sessionsCompletedTotal.inc({ mode: 'SOLO' });
        } else {
          sessionsFailedTotal.inc({ reason: `SOLO_${reason.toUpperCase()}` });
        }
        sessionsActive.dec();
      }

      log.info({ sessionId: id, reason, targetStatus }, 'SOLO session finalized');
      broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: targetStatus } });
    } finally {
      soloFinalizingSessionIds.delete(id);
    }
  },

  async _completeFullDuplexStart(id: string, session: Session, vmName: string, guacId: string): Promise<void> {
    let sharingParams: { connectionId: string; datasource: string; guacToken: string };
    let guacAuthToken: string;
    try {
      log.info({ sessionId: id, guacId, step: 'buildSharingParams' }, 'pipeline: building sharing params (Full Duplex)');
      const authToken = pendingGuacTokens.get(id) ?? session.guacAuthToken;
      pendingGuacTokens.delete(id);
      guacAuthToken = authToken ?? '';
      if (!authToken) {
        throw new UnauthorizedException('Guacamole auth token not found — session may have expired');
      }
      const sp = await guacamoleClient.buildSharingParams(authToken, guacId);
      sharingParams = { connectionId: sp.connectionId, datasource: sp.datasource, guacToken: sp.guacToken };
      await prisma.session.update({ where: { id }, data: { guacTunnelId: sp.tunnelId } });
    } catch (err) {
      log.error({ sessionId: id, err, step: 'buildSharingParams' }, 'pipeline: Guacamole sharing params failed (Full Duplex)');
      sessionsFailedTotal.inc({ reason: 'AGENT_START_FAILED' });
      if (await tryFinalizeStatus(id, SESSION_STATUSES.FAILED)) {
        broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: SESSION_STATUSES.FAILED } });
      }
      deleteVmSilent(vmName, id);
      return;
    }

    const historyMaxStepsCount = session.historyMaxStepsCount ?? FULL_DUPLEX_DEFAULTS.HISTORY_MAX_STEPS_COUNT;
    const maxScreenshotsDelay = session.maxScreenshotsDelay ?? FULL_DUPLEX_DEFAULTS.MAX_SCREENSHOTS_DELAY;
    sessionRuntimeOwner.requireReady();
    const current = await this.findById(id);
    if (current.status !== SESSION_STATUSES.PREPARING) {
      deleteVmSilent(vmName, id);
      return;
    }

    log.info({ sessionId: id, vmName, historyMaxStepsCount, maxScreenshotsDelay, step: 'connectFullDuplex' }, 'pipeline: opening full-duplex WS');
    const handle = fullDuplexAgentManager.connectFullDuplex(
      id,
      vmName,
      {
        historyMaxStepsCount,
        maxScreenshotsDelay,
        sharingParams,
        ...(session.agentLeftModel && { model: session.agentLeftModel as ModelOption }),
      },
      {
        onSessionOpened: () => {
          log.info({ sessionId: id, step: 'SESSION_OPENED' }, 'pipeline: Full Duplex session opened, status → RUNNING');
          if (!sessionRuntimeOwner.isReady()) { fullDuplexHandles.get(id)?.close(); return; }
          prisma.session.updateMany({
            where: { id, status: SESSION_STATUSES.PREPARING }, data: { status: SESSION_STATUSES.RUNNING },
          })
            .then((transition) => {
              if (!transition.count) { fullDuplexHandles.get(id)?.close(); return; }
              fullDuplexRunningSessions.add(id);
              sessionsActive.inc();
              metricsService.recordSessionStart(id);
              broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: SESSION_STATUSES.RUNNING } });
            })
            .catch((err: unknown) => { log.error({ sessionId: id, err }, 'Full Duplex: failed to set RUNNING'); });
        },
        onStep: (payload) => {
          broadcast(id, { type: WS_EVENT_TYPES.AGENT_STEP, payload });
        },
        onOutcome: (payload) => {
          broadcast(id, { type: WS_EVENT_TYPES.AGENT_OUTCOME, payload });
        },
        onError: (payload) => {
          broadcast(id, { type: WS_EVENT_TYPES.AGENT_ERROR, payload });
        },
        onClosed: (payload) => {
          fullDuplexHandles.delete(id);
          this._finalizeFullDuplex(id, payload.reason).catch((err: unknown) => {
            log.error({ sessionId: id, err }, 'Full Duplex: finalize failed');
          });
        },
      }
    );

    fullDuplexHandles.set(id, handle);
    guacHeartbeatStops.set(id, guacamoleClient.startHeartbeat(guacAuthToken, env.GUAC_HEARTBEAT_INTERVAL_MS));
  },

  async _finalizeFullDuplex(id: string, reason: FullDuplexClosedPayload['reason']): Promise<void> {
    // Синхронный guard от двойного вызова (гонка handle.close() + onClosed).
    if (fullDuplexFinalizingSessionIds.has(id)) {
      log.warn({ sessionId: id, reason }, 'Full Duplex finalize: already in progress, skipping');
      return;
    }
    fullDuplexFinalizingSessionIds.add(id);

    try {
      const stopHb = guacHeartbeatStops.get(id);
      if (stopHb) {
        stopHb();
        guacHeartbeatStops.delete(id);
      }

      const session = await this.findById(id).catch(() => null);
      if (session?.status === SESSION_STATUSES.COMPLETED || session?.status === SESSION_STATUSES.FAILED) {
        log.info({ sessionId: id, reason, status: session.status }, 'Full Duplex finalize: session already finalized, skipping');
        return;
      }
      if (session?.vmName) {
        deleteVmSilent(session.vmName, id);
      }

      const wasRunning = fullDuplexRunningSessions.delete(id);
      // COMPLETED только если сессия реально дошла до RUNNING (wasRunning=true) и остановлена
      // клиентом. PENDING/PREPARING при client_request → FAILED: сессия не выполнялась.
      const targetStatus = 'client_request' === reason && wasRunning
        ? SESSION_STATUSES.COMPLETED
        : SESSION_STATUSES.FAILED;

      const didTransition = await tryFinalizeStatus(id, targetStatus);
      if (!didTransition) {
        log.warn({ sessionId: id, reason }, 'Full Duplex finalize: session already finalized elsewhere, skipping metrics/broadcast');
        return;
      }

      if (wasRunning) {
        if (SESSION_STATUSES.COMPLETED === targetStatus) {
          const durationSeconds = metricsService.consumeSessionStart(id);
          if (durationSeconds !== undefined) {
            sessionDurationSeconds.observe(durationSeconds);
            await prisma.sessionMetrics.upsert({
              where: { sessionId_participant: { sessionId: id, participant: 'AGENT' } },
              create: { sessionId: id, participant: 'AGENT', time: Math.round(durationSeconds), steps: 0, clicks: 0, errors: 0, retries: 0 },
              update: { time: Math.round(durationSeconds) },
            });
          }
          sessionsCompletedTotal.inc({ mode: 'FULL_DUPLEX' });
        } else {
          sessionsFailedTotal.inc({ reason: `FULL_DUPLEX_${reason.toUpperCase()}` });
        }
        sessionsActive.dec();
      }

      log.info({ sessionId: id, reason, targetStatus }, 'Full Duplex session finalized');
      broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: targetStatus } });
    } finally {
      fullDuplexFinalizingSessionIds.delete(id);
    }
  },

  async sendFullDuplexMessage(id: string, text: string): Promise<void> {
    sessionRuntimeOwner.requireReady();
    const session = await this.findById(id);
    if (session.mode === 'HUMAN_VS_AGENT') throw new HttpError(409, 'SESSION_MODE_MISMATCH', 'Command is unavailable for race');

    if (session.mode !== 'FULL_DUPLEX' || session.status !== SESSION_STATUSES.RUNNING) {
      throw new BadRequestException('Session is not a running Full Duplex session', 'SESSION_NOT_RUNNING');
    }
    const handle = fullDuplexHandles.get(id);
    if (!handle) {
      throw new BadRequestException('Full Duplex session channel is not connected', 'FULL_DUPLEX_CHANNEL_NOT_CONNECTED');
    }
    try { handle.sendTask(text); }
    catch { throw new BadRequestException('Full Duplex session channel is not connected', 'FULL_DUPLEX_CHANNEL_NOT_CONNECTED'); }
  },

  async startNextTask(id: string, taskDescription: string): Promise<Session> {
    sessionRuntimeOwner.requireReady();
    const session = await sessionsService.findById(id);
    if (session.mode === 'HUMAN_VS_AGENT') throw new HttpError(409, 'SESSION_MODE_MISMATCH', 'Command is unavailable for race');


    if (session.status !== SESSION_STATUSES.RUNNING || session.mode !== 'SOLO') {
      throw new BadRequestException('Session is not a running SOLO session', 'SESSION_NOT_RUNNING');
    }

    const handle = soloSessionHandles.get(id);
    if (!handle) {
      throw new BadRequestException('SOLO session channel is not connected', 'SOLO_CHANNEL_NOT_CONNECTED');
    }

    const taskId = randomUUID();
    handle.sendTask(taskDescription, taskId);
    await prisma.session.update({ where: { id }, data: { agentTaskUuid: taskId } });

    log.info({ sessionId: id, taskId }, 'startNextTask: TASK sent over existing SOLO channel');
    return sessionsService.findById(id);
  },

  async stopTask(id: string): Promise<void> {
    const session = await sessionsService.findById(id);
    if (session.mode === 'HUMAN_VS_AGENT') throw new HttpError(409, 'SESSION_MODE_MISMATCH', 'Command is unavailable for race');


    if (session.status !== SESSION_STATUSES.RUNNING || session.mode !== 'SOLO') {
      throw new BadRequestException('Session is not a running SOLO session', 'SESSION_NOT_RUNNING');
    }

    const handle = soloSessionHandles.get(id);
    if (!handle) {
      log.warn({ sessionId: id }, 'stop_task: SOLO channel not connected, nothing to cancel');
      return;
    }

    handle.cancelTask();
    log.info({ sessionId: id }, 'stop_task: CANCEL_TASK sent, session remains RUNNING');
  },

  async stopAgent(id: string): Promise<Session> {
    const session = await sessionsService.findById(id);
    if (session.mode === 'HUMAN_VS_AGENT') {
      await raceCoordinator.finish(id, 'USER_STOP');
      return this.findById(id);
    }

    if (session.status === SESSION_STATUSES.COMPLETED || session.status === SESSION_STATUSES.FAILED) {
      log.info({ sessionId: id, status: session.status }, 'stopAgent: session already finished, skipping');
      return session;
    }

    clearPreparingTimeout(id);

    if (session.mode === 'FULL_DUPLEX') {
      const handle = fullDuplexHandles.get(id);
      if (handle) {
        // handle.close() шлёт CLOSE_SESSION; финализация (deleteVm, статус,
        // метрики, broadcast) произойдёт асинхронно в onClosed → _finalizeFullDuplex,
        // когда придёт SESSION_CLOSED (или сработает форс-таймаут).
        handle.close();
      } else {
        // WS уже закрылся сам (или ещё не был открыт) — финализируем напрямую.
        await this._finalizeFullDuplex(id, 'client_request');
      }
      return sessionsService.findById(id);
    }

    const handle = soloSessionHandles.get(id);
    if (handle) {
      // handle.close() шлёт CLOSE_SESSION; финализация (deleteVm, статус,
      // метрики, broadcast) произойдёт асинхронно в onClosed → _finalizeSolo,
      // когда сокет реально закроется (ack на CLOSE_SESSION протокол не предусматривает).
      handle.close();
    } else {
      // WS уже закрылся сам (или ещё не был открыт) — финализируем напрямую.
      await this._finalizeSolo(id, 'client_request');
    }
    return sessionsService.findById(id);
  },

  // Guacamole-туннель пользователя оборвался уже после запуска агента. Это не
  // штатное завершение по кнопке «Завершить»: освобождаем VM и фиксируем FAILED,
  // чтобы следующий WS/GET не вернул UI обратно в бесконечный loader.
  async failGuacamoleConnection(id: string): Promise<Session> {
    const session = await sessionsService.findById(id);
    if (session.mode === 'HUMAN_VS_AGENT') {
      await raceCoordinator.finish(id, 'CONNECTION_LOST');
      return this.findById(id);
    }

    if (session.status === SESSION_STATUSES.COMPLETED || session.status === SESSION_STATUSES.FAILED) {
      return session;
    }

    clearPreparingTimeout(id);
    pendingGuacTokens.delete(id);

    if (session.mode === 'FULL_DUPLEX') {
      fullDuplexHandles.get(id)?.close();
      await this._finalizeFullDuplex(id, 'guacamole_error');
      return sessionsService.findById(id);
    }

    soloSessionHandles.get(id)?.close('guacamole_error');
    await this._finalizeSolo(id, 'guacamole_error');
    return sessionsService.findById(id);
  },

  async restart(id: string): Promise<Session> {
    const existingPromise = restartPromises.get(id);
    if (existingPromise) return existingPromise;

    const restartPromise = this._restart(id);
    restartPromises.set(id, restartPromise);
    try {
      return await restartPromise;
    } finally {
      restartPromises.delete(id);
    }
  },

  async _restart(id: string): Promise<Session> {
    const alreadyCreated = await prisma.session.findUnique({
      where: { restartedFromSessionId: id },
      include: { metrics: true },
    });
    if (alreadyCreated) return this.findById(alreadyCreated.id);

    const source = await this.findById(id);
    if (source.mode === 'HUMAN_VS_AGENT') {
      await raceCoordinator.finish(id, 'USER_STOP');
      await raceCoordinator.cleanup(id);
      const original = await raceStateRepository.read(id);
      if (original.race!.cleanupStatus !== 'COMPLETE') throw new HttpError(409, 'CLEANUP_PENDING', 'Race cleanup is still pending');
      const replacement = await raceStateRepository.create({
        difficulty: source.difficulty, taskId: source.taskId!, title: original.race!.taskTitle,
        prompt: original.race!.taskPrompt, imageId: original.race!.resolvedImageId,
        creationKey: randomUUID(), creationHash: original.creationHash ?? id,
        autoFinishOnAgent: original.race!.autoFinishOnAgent,
        modelLabel: original.race!.modelLabel ?? 'Computer Operator',
        config: { difficulty: source.difficulty, restartedFromSessionId: id,
          agentLeftModel: source.agentLeftModel,
          maxIterations: source.maxIterations, modelRetries: source.modelRetries,
          mouseClickDelay: source.mouseClickDelay, minOperationDelay: source.minOperationDelay },
      });
      return serialize(replacement as unknown as RawSession);
    }
    try {
      const soloHandle = soloSessionHandles.get(id);
      const fullDuplexHandle = fullDuplexHandles.get(id);
      soloSessionHandles.delete(id);
      fullDuplexHandles.delete(id);
      clearPreparingTimeout(id);
      pendingGuacTokens.delete(id);
      const stopHeartbeat = guacHeartbeatStops.get(id);
      stopHeartbeat?.();
      guacHeartbeatStops.delete(id);

      if (source.status === SESSION_STATUSES.PENDING) {
        await tryFinalizeStatus(id, SESSION_STATUSES.FAILED);
      } else if (source.status === SESSION_STATUSES.PREPARING || source.status === SESSION_STATUSES.RUNNING) {
        const wasRunning = soloRunningSessions.delete(id) || fullDuplexRunningSessions.delete(id);
        const didTransition = await tryFinalizeStatus(id, SESSION_STATUSES.COMPLETED);
        if (didTransition && wasRunning) {
          metricsService.consumeSessionStart(id);
          sessionsActive.dec();
          sessionsCompletedTotal.inc({ mode: source.mode });
        }
        broadcast(id, { type: WS_EVENT_TYPES.STATUS_CHANGE, payload: { status: SESSION_STATUSES.COMPLETED } });
      }

      // Сначала фиксируем терминальный статус и убираем runtime-guards, затем
      // закрываем WS. Иначе onClosed может обогнать restart и запустить вторую
      // параллельную финализацию/удаление той же VM.
      soloHandle?.close();
      fullDuplexHandle?.close();

      // stopAgent финализирует открытые WS асинхронно, но очистка VM должна
      // закончиться до выдачи новой сессии, иначе стенд может занять две VM.
      if (!await vmCleanupService.cleanup(id, true)) {
        throw new Error('VM_CLEANUP_PENDING');
      }
    } catch (err) {
      log.error({ sessionId: id, err }, 'session restart cleanup failed');
      throw new BadRequestException(
        'Не удалось освободить ресурсы предыдущей сессии',
        'SESSION_RESTART_CLEANUP_FAILED'
      );
    }

    try {
      const replacement = await prisma.session.create({
        data: {
          taskId: source.taskId,
          mode: source.mode,
          difficulty: source.difficulty,
          arenaOs: source.arenaOs,
          customImageId: source.customImageId,
          resolvedImageId: source.resolvedImageId ?? null,
          agentLeftModel: source.agentLeftModel,
          historyMaxStepsCount: source.historyMaxStepsCount,
          maxScreenshotsDelay: source.maxScreenshotsDelay,
          maxIterations: source.maxIterations,
          modelRetries: source.modelRetries,
          mouseClickDelay: source.mouseClickDelay,
          minOperationDelay: source.minOperationDelay,
          restartedFromSessionId: id,
        },
        include: { metrics: true },
      });
      sessionsCreatedTotal.inc({ mode: replacement.mode, difficulty: String(replacement.difficulty) });
      log.info({ sessionId: replacement.id, restartedFromSessionId: id }, 'replacement session created');
      return serialize(replacement as unknown as RawSession);
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
        const replacement = await prisma.session.findUnique({
          where: { restartedFromSessionId: id },
          include: { metrics: true },
        });
        if (replacement) return serialize(replacement as unknown as RawSession);
      }
      throw err;
    }
  },
};
