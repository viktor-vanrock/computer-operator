import { useEffect, useRef, useState } from 'react';

import { ArrowUpIcon, BrainIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';

import { SESSION_STATUSES } from '../../constants/session';
import { formatHotkeyCombo, getOutcomeLabel } from '../../lib/agent-thought';
import type { ChatMessage } from '../../types/chat.types';
import type { SessionStatus } from '../../types/session.types';
import { FeedbackToast } from '../feedback-toast';
import { TaskTextarea } from '../task-textarea';

import { getActionLabel, getActionModifier } from './constants';

import styles from './arena-thoughts.module.css';

const AUTO_SCROLL_THRESHOLD_PX = 8;

interface ArenaThoughtsProps {
  messages: ChatMessage[];
  status: SessionStatus;
  title?: string;
  isTaskDone?: boolean;
  onNextTask?: (task: string) => Promise<boolean | void>;
  isNextTaskPending?: boolean;
  nextTaskError?: string | null;
  /** Full Duplex: поле ввода открыто всегда, без гейта на isTaskDone */
  alwaysOpenInput?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  submitLabel?: string;
  submitPendingLabel?: string;
  onInputActivity?: () => void;
  submitOnEnter?: boolean;
  showDetails?: boolean;
}

export function ArenaThoughts({
  messages, status, title, isTaskDone, onNextTask, isNextTaskPending, nextTaskError,
  alwaysOpenInput, inputLabel, inputPlaceholder, submitLabel, submitPendingLabel,
  onInputActivity, submitOnEnter = true, showDetails = false,
}: ArenaThoughtsProps) {
  const isLive = SESSION_STATUSES.RUNNING === status;
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const [nextTaskValue, setNextTaskValue] = useState('');
  const [isErrorDismissed, setIsErrorDismissed] = useState(false);
  const visibleError = isErrorDismissed ? null : nextTaskError;

  useEffect(() => {
    if (!messages.length) {
      shouldAutoScrollRef.current = true;
      return;
    }

    const el = scrollRef.current;
    if (!el || !shouldAutoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <aside className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <BrainIcon weight="thin" className={styles.headerIcon} />
          <span className={styles.title}>{title ?? 'Размышления агента'}</span>
        </div>
        <div className={styles.headerRight}>
          <span className={`${styles.liveBadge} ${isLive ? styles.liveBadgeActive : ''}`}>
            <span className={`${styles.liveDot} ${isLive ? styles.liveDotActive : ''}`} />
            {isLive ? 'Live' : 'Остановлено'}
          </span>
        </div>
      </div>

      {/* Chat body */}
      {!messages.length ? (
        <div className={styles.placeholder}>
          <div className={styles.placeholderOrb}>
            <BrainIcon weight="thin" size={28} />
          </div>
          <p className={styles.placeholderTitle}>Ожидание агента...</p>
          <p className={styles.placeholderText}>
            Мысли появятся здесь, когда агент начнёт работу
          </p>
        </div>
      ) : (
        <div
          className={styles.chatList}
          ref={scrollRef}
          role="log"
          onScroll={(event) => {
            const element = event.currentTarget;
            const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
            shouldAutoScrollRef.current = distanceToBottom <= AUTO_SCROLL_THRESHOLD_PX;
          }}
        >
          <AnimatePresence initial={false}>
            {messages.map((msg) => {
              if ('user' === msg.kind) {
                return (
                  <motion.div
                    key={msg.id}
                    className={styles.userMessage}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    layout
                  >
                    <div className={styles.userMessageBubble}>
                      <p className={styles.userMessageText}>{msg.text}</p>
                    </div>
                    <span className={styles.messageTime}>{msg.receivedAt}</span>
                  </motion.div>
                );
              }

              if ('system' === msg.kind) {
                return (
                  <motion.div
                    key={msg.id}
                    className={styles.systemMessage}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    layout
                  >
                    <p className={styles.systemMessageText}>{msg.text}</p>
                  </motion.div>
                );
              }

              if ('outcome' === msg.kind) {
                return (
                  <motion.div
                    key={msg.id}
                    className={styles.systemMessage}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    layout
                  >
                    <p className={`${styles.systemMessageText} ${styles.outcomeMessageText}`} data-value={msg.value}>
                      {msg.text}
                    </p>
                  </motion.div>
                );
              }

              const isNonSuccess = undefined !== msg.rawOutcomeStatus && 'success' !== msg.outcomeStatus;
              const outcomeBadgeLabel = getOutcomeLabel(msg.outcomeStatus) ?? msg.rawOutcomeStatus;
              const badgeLabel = outcomeBadgeLabel ?? getActionLabel(msg.actionType, msg.actionInputs);
              const rawHotkey = msg.actionInputs?.['hotkey'];
              const rawKeys = msg.actionInputs?.['keys'];
              const keySequence = Array.isArray(rawKeys) && rawKeys.every((key): key is string => 'string' === typeof key)
                ? rawKeys.join('+')
                : undefined;
              const rawActionArguments = msg.actionInputs?.['arguments'];
              const actionArguments = 'object' === typeof rawActionArguments && null !== rawActionArguments && !Array.isArray(rawActionArguments)
                ? rawActionArguments as Record<string, unknown>
                : undefined;
              const argumentKeys = actionArguments?.['keys'];
              const argumentKeySequence = Array.isArray(argumentKeys) && argumentKeys.every((key): key is string => 'string' === typeof key)
                ? argumentKeys.join('+')
                : undefined;
              const hotkeyValue = 'string' === typeof rawHotkey
                ? rawHotkey
                : keySequence ?? argumentKeySequence ?? actionArguments?.['hotkey'];
              const hotkeyCombo = ('press' === msg.actionType || 'hotkey' === msg.actionType)
                && 'string' === typeof hotkeyValue
                ? formatHotkeyCombo(hotkeyValue)
                : undefined;
              const presses = msg.actionInputs?.['presses'];
              const pressCount = 'number' === typeof presses && 1 < presses ? ` ×${presses}` : '';
              const rawContent = msg.actionInputs?.['content'] ?? msg.actionInputs?.['text']
                ?? actionArguments?.['content'] ?? actionArguments?.['text'];
              const typedContent = 'type' === msg.actionType && 'string' === typeof rawContent ? rawContent : undefined;
              return (
                <motion.div
                  key={msg.id}
                  className={styles.agentMessage}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  layout
                >
                  <div className={`${styles.agentMessageBubble} ${isNonSuccess ? styles.agentMessageBubbleFailed : ''}`}>
                    {badgeLabel && (
                      <span className={`${styles.actionBadge} ${isNonSuccess ? styles.badgeFailed : getActionModifier(msg.actionType)}`}>
                        {badgeLabel}
                      </span>
                    )}
                    <p className={styles.messageText}>{msg.thought}</p>
                    {showDetails && hotkeyCombo && <p className={styles.hotkeyDetail}>Комбинация клавиш: {hotkeyCombo}{pressCount}</p>}
                    {showDetails && typedContent && <p className={styles.hotkeyDetail}>Текст: {typedContent}</p>}
                    {showDetails && (msg.details || msg.actionInputs) ? (
                      <details className={styles.details}>
                        <summary>Детали</summary>
                        <pre>{JSON.stringify(msg.details ?? msg.actionInputs, null, 2)}</pre>
                      </details>
                    ) : null}
                  </div>
                  <span className={styles.messageTime}>{msg.receivedAt}</span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {(alwaysOpenInput || isTaskDone) && onNextTask && (
        <motion.form
          className={styles.nextTaskForm}
          onFocusCapture={onInputActivity}
          onKeyDownCapture={onInputActivity}
          onPointerDownCapture={onInputActivity}
          onSubmit={(e) => {
            e.preventDefault();
            if (!nextTaskValue.trim() || isNextTaskPending) return;
            setIsErrorDismissed(false);
            onInputActivity?.();
            void onNextTask(nextTaskValue.trim()).then((wasAccepted) => {
              if (wasAccepted !== false) setNextTaskValue('');
            });
          }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {inputLabel ? <p className={styles.nextTaskLabel}>{inputLabel}</p> : null}
          <div className={styles.nextTaskInput}>
            <TaskTextarea
              className={styles.nextTaskTextarea}
              value={nextTaskValue}
              onChange={(value) => {
                onInputActivity?.();
                setNextTaskValue(value);
              }}
              onKeyDown={(event) => {
                if (!submitOnEnter) return;
                if (
                  'Enter' !== event.key
                  || event.shiftKey
                  || event.repeat
                  || event.nativeEvent.isComposing
                ) return;

                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              placeholder={inputPlaceholder ?? 'Опишите задачу'}
              disabled={isNextTaskPending}
              error={visibleError ?? undefined}
              errorMessageId="next-task-error"
              id="next-task"
            />
            <button
              type="submit"
              className={styles.nextTaskBtn}
              disabled={!nextTaskValue.trim() || isNextTaskPending}
              aria-label={isNextTaskPending ? (submitPendingLabel ?? 'Отправка...') : (submitLabel ?? 'Отправить')}
            >
              <ArrowUpIcon weight="bold" className={styles.nextTaskBtnIcon} aria-hidden="true" />
            </button>
          </div>
        </motion.form>
      )}
      <AnimatePresence>
        {visibleError ? (
          <FeedbackToast
            id="next-task-error"
            title={visibleError}
            onDismiss={() => setIsErrorDismissed(true)}
          />
        ) : null}
      </AnimatePresence>
    </aside>
  );
}
