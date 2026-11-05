import { useCallback, useState } from 'react';

import { ArrowClockwiseIcon, ArrowLeftIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';

import { SESSION_STATUSES } from '../constants/session';
import type { SessionStatus } from '../types/session.types';

import type { AgentClick } from './arena-player.types';
import { ClickAnimationOverlay, PreparingLoader } from './components';
import { GuacamoleDisplay } from './GuacamoleDisplay';
import type { HumanInputAction } from './human-input';
import type { GuacamoleConnectionError } from './use-guacamole-client';
import { buildTunnelUrl } from './util';

import styles from './arena-player.module.css';

export interface ArenaPlayerProps {
  status: SessionStatus
  connectArgs: string | null
  onRestart: () => void
  onBack?: () => void
  isRestarting?: boolean
  restartError?: string | null
  onGuacamoleConnected?: (tunnelId?: string) => void
  onGuacamoleError?: (error: GuacamoleConnectionError) => void
  errorCode?: string | null
  errorMessage?: string | null
  suppressPreparation?: boolean
  inputEnabled?: boolean
  clipboardInputEnabled?: boolean
  onHumanAction?: (action: HumanInputAction) => void
}

export function ArenaPlayer({
  status, connectArgs, onRestart, onBack, isRestarting = false, restartError,
  onGuacamoleConnected, onGuacamoleError, errorCode, errorMessage,
  inputEnabled = false, clipboardInputEnabled = false, onHumanAction, suppressPreparation = false,
}: ArenaPlayerProps) {
  const [agentClicks, setAgentClicks] = useState<AgentClick[]>([]);

  const handleAgentClick = useCallback((x: number, y: number) => {
    setAgentClicks((prev) => [...prev, { id: crypto.randomUUID(), x, y, timestamp: Date.now() }]);
  }, []);

  const removeAgentClick = useCallback((id: string) => {
    setAgentClicks((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const isAlreadyStarted = 'SESSION_ALREADY_STARTED' === errorCode;
  const tunnelUrl = buildTunnelUrl(import.meta.env.VITE_GUACAMOLE_URL);
  const isRunning = SESSION_STATUSES.RUNNING === status;
  const isTerminal = SESSION_STATUSES.COMPLETED === status || SESSION_STATUSES.FAILED === status;

  return (
    <div className={styles.panel}>
      {/* Рендерим при наличии connectArgs чтобы туннель подключился и отправил GUACAMOLE_CONNECTED.
          Скрываем до RUNNING, показываем после. */}
      {connectArgs && !isTerminal && (
        <div className={isRunning ? `${styles.playerWrap} ${inputEnabled ? styles.interactive : ''}` : styles.guacFrameHidden}>
          <GuacamoleDisplay
            connectArgs={connectArgs}
            tunnelUrl={tunnelUrl}
            className={`${styles.guacFrame} ${inputEnabled && isRunning ? styles.interactive : ''}`}
            onConnected={onGuacamoleConnected}
            onError={onGuacamoleError}
            onAgentClick={handleAgentClick}
            inputEnabled={inputEnabled && isRunning}
            clipboardInputEnabled={clipboardInputEnabled}
            onHumanAction={onHumanAction}
          />
          <ClickAnimationOverlay clicks={agentClicks} onRemove={removeAgentClick} />
        </div>
      )}
      <AnimatePresence mode="wait">
        {isRunning && connectArgs ? null : isTerminal ? (
          <motion.div
            key="error"
            className={styles.centerState}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className={styles.errorCard}>
              <div className={styles.errorIconWrap}>
                <WarningCircleIcon weight="thin" size={40} />
              </div>
              {SESSION_STATUSES.COMPLETED === status ? (
                <>
                  <p className={styles.errorTitle}>Сессия завершена</p>
                  <p className={styles.errorSubtitle}>Работа с виртуальной машиной остановлена.</p>
                </>
              ) : isAlreadyStarted ? (
                <>
                  <p className={styles.errorTitle}>Сессия уже запущена</p>
                  <p className={styles.errorSubtitle}>
                    Эта сессия была запущена ранее.<br />Создайте новое задание.
                  </p>
                </>
              ) : (
                <>
                  <p className={styles.errorTitle}>Не удалось подключиться</p>
                  <p className={styles.errorSubtitle}>
                    {errorMessage ?? 'Агентная машина не успела подготовиться.'}
                  </p>
                </>
              )}
              {errorCode && (
                <span className={styles.errorCode}>{errorCode}</span>
              )}
              <div className={styles.errorActions}>
                <button
                  type="button"
                  className={styles.retryBtn}
                  onClick={onRestart}
                  disabled={isRestarting}
                  aria-busy={isRestarting}
                >
                  <ArrowClockwiseIcon weight="regular" size={14} />
                  {isRestarting ? 'Перезапускаем…' : 'Перезапустить'}
                </button>
                {onBack ? (
                  <button type="button" className={styles.backBtn} onClick={onBack} disabled={isRestarting}>
                    <ArrowLeftIcon weight="regular" size={14} />
                    Вернуться
                  </button>
                ) : null}
              </div>
              {restartError ? <p className={styles.restartError} role="alert">{restartError}</p> : null}
            </div>
          </motion.div>
        ) : suppressPreparation ? null : (
          <motion.div
            key="preparing"
            className={styles.centerState}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <PreparingLoader />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
