import { prisma } from '@/lib/db/prisma.js';
import { logger } from '@/lib/logger.js';
import { wsConnectionsActive } from '@/lib/metrics/metrics.js';
import { raceCoordinator } from '../sessions/race/race-coordinator.js';
import { raceStateRepository } from '../sessions/race/race-state.repository.js';
import { WS_ERROR_CODES } from './arena.constants.js';
import { ClientEventSchema, WsEventSchema } from './arena.schema.js';
import { WsEvent } from './arena.types.js';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyPluginAsync } from 'fastify';

const connections = new Map<string, Set<WebSocket>>();
const log = logger.child({ module: 'arena' });
const disconnectGrace = new Map<string, ReturnType<typeof setTimeout>>();

function updateRacePresence(sessionId: string): void {
  clearTimeout(disconnectGrace.get(sessionId));
  disconnectGrace.delete(sessionId);
  if (connections.get(sessionId)?.size) return;
  disconnectGrace.set(sessionId, setTimeout(() => {
    disconnectGrace.delete(sessionId);
    if (!connections.get(sessionId)?.size) void raceCoordinator.finish(sessionId, 'CONNECTION_LOST').catch(() => {});
  }, 15_000));
}

export function broadcast(sessionId: string, event: WsEvent): void {
  const sockets = connections.get(sessionId);
  if (!sockets) return;
  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
};

export const arenaRouter: FastifyPluginAsync = async (app) => {
  raceCoordinator.setActionPublisher((id, action) => {
    broadcast(id, WsEventSchema.parse({ type: 'RACE_ACTION', payload: { sessionId: id, action } }));
  });
  raceCoordinator.setPublisher(async (id) => {
    const state = await raceStateRepository.snapshot(id);
    broadcast(id, { type: 'RACE_STATE', payload: {
      sessionId: id, revision: state.race.revision, status: state.status, race: state.race,
    } });
  });
  app.get('/session/:id', { websocket: true }, (socket: WebSocket, req) => {
    const { id: sessionId } = req.params as { id: string };
    const remoteAddress = req.socket.remoteAddress ?? 'unknown';
    let mode: string | null = null;
    void prisma.session.findUnique({ where: { id: sessionId }, select: { mode: true } }).then((session) => {
      mode = session?.mode ?? null;
      if (mode === 'HUMAN_VS_AGENT') updateRacePresence(sessionId);
    }).catch(() => {});

    if (!connections.has(sessionId)) {
      connections.set(sessionId, new Set());
    }
    connections.get(sessionId)?.add(socket);
    wsConnectionsActive.inc();
    log.info({ sessionId, remoteAddress }, 'WS client connected');

    const pingInterval = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        socket.ping();
      }
    }, 30_000);

    socket.on('message', (rawData: Buffer) => {
      try {
        const data = JSON.parse(rawData.toString()) as unknown;
        if (!mode || mode === 'HUMAN_VS_AGENT') throw new Error('INVALID_EVENT');
        const event = ClientEventSchema.parse(data);
        broadcast(sessionId, event);
      } catch {
        log.warn({ sessionId, rawData: rawData.toString() }, 'invalid WS message received');
        socket.send(
          JSON.stringify({ error: { code: WS_ERROR_CODES.INVALID_EVENT, message: 'Unknown event type' } })
        );
      }
    });

    socket.on('close', () => {
      clearInterval(pingInterval);
      connections.get(sessionId)?.delete(socket);
      if (connections.get(sessionId)?.size === 0) {
        connections.delete(sessionId);
        if (mode === 'HUMAN_VS_AGENT') updateRacePresence(sessionId);
      }
      wsConnectionsActive.dec();
      log.info({ sessionId }, 'WS client disconnected');
    });
  });
};
