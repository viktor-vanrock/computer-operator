import { SessionSchema } from './sessions.schema.js';
import { RawMetrics, RawSession, Session, SessionMetrics } from './sessions.types.js';

export const serializeMetrics = (m: RawMetrics): SessionMetrics => ({
  participant: m.participant as SessionMetrics['participant'],
  time: m.time,
  steps: m.steps,
  clicks: m.clicks,
  errors: m.errors,
  retries: m.retries,
});

export const serialize = (session: RawSession): Session =>
  SessionSchema.parse({
    ...session,
    race: session.race ?? null,
    connectArgs: session.connectArgs ?? null,
    guacAuthToken: session.guacAuthToken ?? null,
    guacTunnelId: session.guacTunnelId ?? null,
    vmName: session.vmName ?? null,
    guacId: session.guacId ?? null,
    agentTaskUuid: session.agentTaskUuid ?? null,
    agentJobId: session.agentJobId ?? null,
    arenaOs: session.arenaOs ?? null,
    customImageId: session.customImageId ?? null,
    historyMaxStepsCount: session.historyMaxStepsCount ?? null,
    maxScreenshotsDelay: session.maxScreenshotsDelay ?? null,
    maxIterations: session.maxIterations ?? null,
    modelRetries: session.modelRetries ?? null,
    mouseClickDelay: session.mouseClickDelay ?? null,
    minOperationDelay: session.minOperationDelay ?? null,
    agentLeftModel: session.agentLeftModel ?? null,
    sharingProfileId: session.sharingProfileId ?? null,
    restartedFromSessionId: session.restartedFromSessionId ?? null,
    metrics: session.metrics.map(serializeMetrics),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  });
