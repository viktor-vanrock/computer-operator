import { useEffect, useRef } from 'react';

import Guacamole from 'guacamole-common-js';

import type { HumanInputAction } from './human-input';
import { bindHumanInput } from './human-input';
import { isGuacamoleScreenReady } from './screen-readiness';
import { applyScale } from './util';

const GUAC_WIDTH = 1920;
const GUAC_HEIGHT = 1080;

export const DEFAULT_SCREEN_READY_TIMEOUT_MS = 60_000;

// Транзиентный обрыв Guacamole-туннеля (короткий сетевой сбой на стороне
// инфраструктуры/ВМ) не должен сразу убивать всю сессию — агент на своей
// стороне при точно таком же обрыве сам ретраится (до 10 попыток). Даём
// туннелю в просмотрщике аналогичный шанс переподключиться, прежде чем
// сообщать наверх о потере соединения.
const GUAC_RECONNECT_MAX_ATTEMPTS = 5;
const GUAC_RECONNECT_DELAY_MS = 1000;

export interface GuacamoleConnectionError {
  code: 'GUACAMOLE_CONNECTION_LOST' | 'GUACAMOLE_SCREEN_TIMEOUT'
}

interface UseGuacamoleClientOptions {
  connectArgs: string | null
  tunnelUrl: string
  containerRef: React.RefObject<HTMLDivElement | null>
  onConnected?: ((tunnelId?: string) => void) | undefined
  onError?: ((error: GuacamoleConnectionError) => void) | undefined
  onAgentClick?: ((x: number, y: number) => void) | undefined
  clipboardInputEnabled?: boolean | undefined
  inputEnabled?: boolean | undefined
  onHumanAction?: ((action: HumanInputAction) => void) | undefined
}

export function useGuacamoleClient(
  {
    connectArgs,
    tunnelUrl,
    containerRef,
    onConnected,
    onError,
    onAgentClick,
    inputEnabled = false,
    clipboardInputEnabled = false,
    onHumanAction,
  }: UseGuacamoleClientOptions
): void {
  const clientRef = useRef<Guacamole.Client | null>(null);
  const connectedNotifiedRef = useRef(false);
  const failedNotifiedRef = useRef(false);
  const hasSizedRef = useRef(false);
  const checkScreenReadyRef = useRef<() => void>(() => {});
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const disposeResizeRef = useRef<() => void>(() => {});
  const disposeInputRef = useRef<() => void>(() => {});
  const configureInputRef = useRef<() => void>(() => {});
  const inputEnabledRef = useRef(inputEnabled);
  const clipboardInputEnabledRef = useRef(clipboardInputEnabled);
  const onHumanActionRef = useRef(onHumanAction);
  useEffect(() => { onHumanActionRef.current = onHumanAction; }, [onHumanAction]);
  useEffect(() => {
    inputEnabledRef.current = inputEnabled;
    clipboardInputEnabledRef.current = clipboardInputEnabled;
    configureInputRef.current();
  }, [inputEnabled, clipboardInputEnabled]);
  // Ref чтобы всегда читать свежий колбэк без переподключения туннеля
  const onAgentClickRef = useRef(onAgentClick);
  useEffect(() => { onAgentClickRef.current = onAgentClick; });
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; });
  const onConnectedRef = useRef(onConnected);
  useEffect(() => { onConnectedRef.current = onConnected; });

  useEffect(() => {
    if (!connectArgs) return;
    let disposed = false;

    const prev = clientRef.current;
    if (prev) {
      prev.disconnect();
      clientRef.current = null;
    }

    failedNotifiedRef.current = false;
    reconnectAttemptsRef.current = 0;

    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    connectTimeoutRef.current = setTimeout(() => {
      if (!connectedNotifiedRef.current && !failedNotifiedRef.current) {
        failedNotifiedRef.current = true;
        onErrorRef.current?.({ code: 'GUACAMOLE_SCREEN_TIMEOUT' });
      }
    }, DEFAULT_SCREEN_READY_TIMEOUT_MS);

    // Отдельная функция, а не единоразовая настройка внутри эффекта: при
    // обрыве туннеля (state CLOSED) мы пересоздаём tunnel+client и вызываем
    // её же повторно, не трогая остальной жизненный цикл эффекта.
    const setupClient = (): void => {
      if (disposed) return;

      disposeResizeRef.current();
      disposeInputRef.current();
      connectedNotifiedRef.current = false;
      hasSizedRef.current = false;

      const tunnel = new Guacamole.WebSocketTunnel(tunnelUrl);
      const client = new Guacamole.Client(tunnel);
      clientRef.current = client;
      let tunnelOpen = false;
      configureInputRef.current = () => {
        disposeInputRef.current();
        disposeInputRef.current = () => {};
        const container = containerRef.current;
        if (!container || !inputEnabledRef.current || !connectedNotifiedRef.current || !tunnelOpen) return;
        disposeInputRef.current = bindHumanInput({
          container, client, clipboardInputEnabled: clipboardInputEnabledRef.current,
          canSend: () => !disposed && tunnelOpen && connectedNotifiedRef.current && inputEnabledRef.current,
          onAction: (action) => onHumanActionRef.current?.(action),
        });
      };

      checkScreenReadyRef.current = () => {
        if (connectedNotifiedRef.current || failedNotifiedRef.current || !hasSizedRef.current) return;
        try {
          sampleCanvasRef.current ??= document.createElement('canvas');
          if (!isGuacamoleScreenReady(client.getDisplay().flatten(), sampleCanvasRef.current)) return;

          connectedNotifiedRef.current = true;
          reconnectAttemptsRef.current = 0;
          if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current);
            connectTimeoutRef.current = null;
          }
          onConnectedRef.current?.(tunnel.uuid ?? undefined);
          configureInputRef.current();
        } catch {
          // A transient canvas error must not fail the session. The next sync retries.
        }
      };

      // sync означает, что все предшествующие инструкции кадра применены. Проверяем
      // итоговую композицию display, включая дочерние Guacamole-слои.
      client.onsync = () => {
        checkScreenReadyRef.current();
      };

      // Перехватываем mouse-инструкции от сервера (агент передаёт клики,
      // сервер транслирует их в наш туннель).
      const clientOnInstruction = tunnel.oninstruction;
      tunnel.oninstruction = (opcode: string, params: unknown[]) => {
        clientOnInstruction?.(opcode, params);
        if ('mouse' === opcode) {
          const rawX = parseInt(String(params[0] ?? '0'), 10);
          const rawY = parseInt(String(params[1] ?? '0'), 10);
          const buttonMask = parseInt(String(params[2] ?? '0'), 10);
          if (buttonMask > 0 && !isNaN(rawX) && !isNaN(rawY)) {
            onAgentClickRef.current?.(rawX / GUAC_WIDTH, rawY / GUAC_HEIGHT);
          }
        }
      };

      const guacDisplay = client.getDisplay();
      const displayEl = guacDisplay.getElement();

      if (containerRef.current) {
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(displayEl);
      }

      if (containerRef.current) {
        const container = containerRef.current;
        const handleResize = () => {
          applyScale(guacDisplay, container);
          if (!hasSizedRef.current && guacDisplay.getWidth() > 0 && guacDisplay.getHeight() > 0) {
            hasSizedRef.current = true;
          }
        };

        // Срабатывает когда Guacamole-сервер присылает инструкцию size (первый кадр).
        // Без этого applyScale вызывается до получения размеров и возвращается с displayW=0.
        guacDisplay.onresize = handleResize;

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(container);
        window.addEventListener('resize', handleResize);
        handleResize();

        disposeResizeRef.current = () => {
          guacDisplay.onresize = null;
          resizeObserver.disconnect();
          window.removeEventListener('resize', handleResize);
          disposeResizeRef.current = () => {};
        };
      }

      tunnel.onstatechange = (state: Guacamole.Tunnel.State) => {
        switch (state) {
          case 0: // CONNECTING
            break;
          case 1: // OPEN
            tunnelOpen = true;
            configureInputRef.current();
            break;
          case 2: { // CLOSED
            disposeInputRef.current();
            tunnelOpen = false;
            connectedNotifiedRef.current = false;
            if (disposed || failedNotifiedRef.current) break;
            clientRef.current?.disconnect();
            clientRef.current = null;

            if (reconnectAttemptsRef.current < GUAC_RECONNECT_MAX_ATTEMPTS) {
              reconnectAttemptsRef.current += 1;
              reconnectTimeoutRef.current = setTimeout(() => {
                reconnectTimeoutRef.current = null;
                setupClient();
              }, GUAC_RECONNECT_DELAY_MS);
            } else {
              failedNotifiedRef.current = true;
              onErrorRef.current?.({ code: 'GUACAMOLE_CONNECTION_LOST' });
            }
            break;
          }
          case 3: // UNSTABLE
            break;
        }
      };

      client.connect(connectArgs);
    };

    setupClient();

    return () => {
      disposed = true;
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      checkScreenReadyRef.current = () => {};
      disposeResizeRef.current();
      disposeInputRef.current();
      configureInputRef.current = () => {};
      if (clientRef.current) {
        clientRef.current.onsync = null;
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, [connectArgs, tunnelUrl]);
}
