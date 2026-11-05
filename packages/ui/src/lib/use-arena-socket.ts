/**
 * Hook для WebSocket-соединения с ареной.
 *
 * Lifecycle:
 * 1. Подключается при монтировании компонента
 * 2. Каждое входящее сообщение парсится и передаётся в onEvent
 * 3. При размонтировании — соединение закрывается (cleanup в useEffect)
 * 4. При разрыве — автоматический reconnect через 2 секунды
 *
 */
import { useEffect, useRef } from 'react';

import type { WsEvent } from '../types/websocket.types';

import { WsEventSchema } from './ws-event.schema';

const WS_URL = import.meta.env['VITE_WS_URL'] ?? 'ws://localhost:3001';

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;

interface Options {
  onEvent: (event: WsEvent) => void
  onReconnect?: () => void | Promise<void>
  enabled?: boolean
  onConnectionChange?: (connected: boolean) => void
}

export function useArenaSocket(sessionId: string, { onEvent, onReconnect, onConnectionChange, enabled = true }: Options): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;
  const onConnectionRef = useRef(onConnectionChange);
  onConnectionRef.current = onConnectionChange;

  useEffect(() => {
    if (!enabled || !sessionId) return;

    // ws объявлен во внешней области видимости, чтобы cleanup мог закрыть соединение
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let cancelled = false;
    let reconnectAttempt = 0;
    let hasOpened = false;

    function connect() {
      ws = new WebSocket(`${WS_URL}/ws/session/${sessionId}`);

      ws.onopen = () => {
        if (cancelled) return;
        onConnectionRef.current?.(true);
        const isReconnect = hasOpened || reconnectAttempt > 0;
        hasOpened = true;
        reconnectAttempt = 0;
        if (isReconnect) void onReconnectRef.current?.();
      };

      ws.onmessage = (e: MessageEvent<string>) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(e.data) as unknown;
          const event = WsEventSchema.parse(data) as WsEvent;
          onEventRef.current(event);
        } catch (err) {
          console.error('[WS] Invalid message received:', e.data, err);
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        onConnectionRef.current?.(false);
        ws = null;
        if (!cancelled) {
          const delayIndex = Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1);
          const delay = RECONNECT_DELAYS_MS[delayIndex] ?? RECONNECT_DELAYS_MS[0];
          reconnectAttempt += 1;
          reconnectTimeout = setTimeout(connect, delay);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimeout);
      ws?.close();
      ws = null;
    };
  }, [sessionId, enabled]);
}
