import { useCallback, useEffect, useRef, useState } from 'react';

import type { HumanInputAction } from '../arena-player/human-input';
import { apiClient } from '../lib/api-client';
import { useArenaSocket } from '../lib/use-arena-socket';
import type { Participant, Session } from '../types/session.types';
import type { WsEvent } from '../types/websocket.types';

import type { RaceAction } from './race-state';
import { HumanActionQueue } from './use-human-actions';

export function useArenaHumanAgent(sessionId: string, { startOnPending = true, autoFinishOnAgent }: {
  startOnPending?: boolean; autoFinishOnAgent?: boolean;
} = {}) {
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<RaceAction[]>([]);
  const [pending, setPending] = useState<HumanInputAction[]>([]);
  const [pendingStatus, setPendingStatus] = useState<'pending' | 'failed' | 'unsaved'>('pending');
  const [connected, setConnected] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const canonical = useRef<Session | null>(null);
  const buffered = useRef<Array<Extract<WsEvent, { type: 'RACE_STATE' }>>>([]);
  const queue = useRef<HumanActionQueue<HumanInputAction> | null>(null);
  const generation = useRef(0);
  const completing = useRef(false);
  const accept = useCallback((state: Session) => {
    if (state.id !== sessionId || !state.race) return;
    const previous = canonical.current;
    if (previous?.id === state.id && previous.race && previous.race.revision > state.race.revision) return;
    let latest = state;
    for (const event of buffered.current) {
      if (event.payload.sessionId === state.id && event.payload.revision > (latest.race?.revision ?? -1)) {
        latest = { ...latest, status: event.payload.status, race: event.payload.race };
      }
    }
    buffered.current = [];
    canonical.current = latest;
    setSession(latest);
  }, [sessionId]);
  const merge = useCallback((incoming: RaceAction[]) => {
    setEvents((previous) => {
      const unique = new Map(previous.map((event) => [event.sequence, event]));
      for (const event of incoming) if (event.sessionId === sessionId) unique.set(event.sequence, event);
      return [...unique.values()].sort((a, b) => a.sequence - b.sequence).slice(-200);
    });
  }, [sessionId]);
  const hydrate = useCallback(async () => {
    const token = generation.current;
    setReconciled(false);
    try {
      const state = await apiClient.get<Session>(`/sessions/${sessionId}`);
      if (token !== generation.current) return;
      accept(state);
      let after = 0;
      while (true) {
        const page = await apiClient.get<{ events: RaceAction[]; nextAfterSequence: number; hasMore: boolean }>(
          `/sessions/${sessionId}/actions?afterSequence=${after}&limit=200`
        );
        if (token !== generation.current) return;
        merge(page.events);
        if (!page.hasMore) break;
        after = page.nextAfterSequence;
      }
      setReconciled(true);
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : 'Ошибка соединения'); }
  }, [accept, merge, sessionId]);
  useArenaSocket(sessionId, {
    onConnectionChange: (open) => { setConnected(open); if (!open) setReconciled(false); else void hydrate(); },
    onEvent: (event: WsEvent) => {
      if ('RACE_STATE' === event.type && event.payload.sessionId === sessionId) {
        const previous = canonical.current;
        if (!previous) buffered.current.push(event);
        if (previous && (!previous.race || event.payload.revision > previous.race.revision)) {
          accept({ ...previous, status: event.payload.status, race: event.payload.race });
        }
      } else if ('RACE_ACTION' === event.type && event.payload.sessionId === sessionId) merge([event.payload.action]);
    },
  });
  useEffect(() => {
    generation.current += 1;
    const token = generation.current;
    canonical.current = null;
    buffered.current = [];
    setSession(null); setEvents([]); setPending([]); setError(null); setBusy(false);
    const sender = new HumanActionQueue<HumanInputAction>(async (batch) => {
      const ack = await apiClient.post<{ accepted: Array<{ eventId: string; sequence: number }> }>(
        `/sessions/${sessionId}/human-actions`, { events: batch }
      );
      return ack;
    }, () => {
      if (token === generation.current) { setPending(sender.pending()); setPendingStatus(sender.status()); }
    });
    queue.current = sender;
    void hydrate().then(async () => {
      if (!startOnPending || token !== generation.current || canonical.current?.status !== 'PENDING') return;
      try { accept(await apiClient.post<Session>(`/sessions/${sessionId}/start`, {})); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось запустить'); }
    });
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => { generation.current += 1; sender.dispose(); clearInterval(tick); };
  }, [sessionId, startOnPending]);
  useEffect(() => {
    if (session?.race?.finishedAt) queue.current?.dispose();
  }, [session?.race?.finishedAt]);
  const command = async (path: string) => {
    const token = generation.current;
    setBusy(true); setError(null);
    try {
      const state = await apiClient.post<Session>(`/sessions/${sessionId}/${path}`, {});
      if (token !== generation.current) return null;
      accept(state);
      return state;
    } catch (reason) {
      if (token === generation.current) setError(reason instanceof Error ? reason.message : 'Ошибка команды');
      return null;
    } finally { if (token === generation.current) setBusy(false); }
  };
  const race = session?.race;
  const started = race?.startedAt ? new Date(race.startedAt).getTime() : null;
  const elapsed = null === started ? null : Math.max(0, (race?.finishedAt ? new Date(race.finishedAt).getTime() : now) - started);
  return {
    session, race, events, pending, pendingStatus, error, busy, elapsed,
    inputEnabled: 'RUNNING' === session?.status && !race?.finishedAt && connected && reconciled && !busy,
    onHumanAction: (action: HumanInputAction) => queue.current?.push(action),
    ready: (participant: Participant, tunnelId?: string) => {
      if (!tunnelId) return;
      void apiClient.post(`/sessions/${sessionId}/guacamole-ready`, {
        participant, tunnelId, ...(autoFinishOnAgent === undefined ? {} : { autoFinishOnAgent }),
      }).catch(() => void hydrate());
    },
    guacError: (participant: Participant) => {
      void apiClient.post<Session>(`/sessions/${sessionId}/guacamole-error`, {
        participant, code: 'GUACAMOLE_CONNECTION_LOST',
      }).then(accept).catch(() => void hydrate());
    },
    complete: async () => {
      if (completing.current) return null;
      completing.current = true;
      setBusy(true);
      try { await queue.current?.finishFlush(); return await command('human-complete'); }
      finally { completing.current = false; setBusy(false); }
    },
    stop: async () => {
      const token = generation.current;
      setBusy(true);
      await queue.current?.finishFlush();
      if (token !== generation.current) return null;
      return command('stop');
    },
    restart: () => command('restart'),
  };
}
