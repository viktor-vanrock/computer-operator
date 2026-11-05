import { AnimatePresence, motion } from 'framer-motion';

import { toMMSS } from '@/utils/time';

import { AGENT_ACTIONS, AGENT_TOTAL, HUMAN_TOTAL } from './arena-preview.constants';
import { useArenaPreview } from './use-arena-preview';

import styles from './arena-preview.module.css';

export function ArenaPreview() {
  const state = useArenaPreview();

  const humanProgress = Math.min((state.elapsed / HUMAN_TOTAL) * 100, 85);
  const agentProgress = 'agent_wins' === state.phase
    ? 100
    : Math.min((state.elapsed / AGENT_TOTAL) * 100, 100);

  const agentAction = AGENT_ACTIONS[state.agentActionIdx];

  return (
    <div className={styles.wrapper}>

      <AnimatePresence mode="wait">
        <motion.div
          key={state.cycleKey}
          className={styles.window}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {/* Title bar */}
          <div className={styles.titleBar}>
            <span className={styles.dotRed} />
            <span className={styles.dotYellow} />
            <span className={styles.dotGreen} />
            <span className={styles.windowTitle}>arena.demo</span>
          </div>

          {/* Content */}
          <div className={styles.content}>
            <div className={styles.pane}>
              <div className={styles.paneHeader}>
                <span className={`${styles.paneDot} ${styles.humanDot}`} />
                <span className={styles.paneLabel}>Human</span>
              </div>
              <div className={styles.timer}>{toMMSS(state.elapsed)}</div>
              <div className={styles.progressTrack}>
                <motion.div
                  className={`${styles.progressBar} ${styles.humanBar}`}
                  animate={{ width: `${humanProgress}%` }}
                  transition={{ duration: 0.8, ease: 'linear' }}
                />
              </div>
              <div className={styles.statusLine}>
                <span className={styles.cursor} />
                <span className={styles.statusText}>Выполняет...</span>
              </div>
            </div>

            <div className={styles.divider} />

            <div className={styles.pane}>
              <div className={styles.paneHeader}>
                <span className={`${styles.paneDot} ${styles.agentDot}`} />
                <span className={styles.paneLabel}>Agent</span>
              </div>
              <div className={`${styles.timer} ${styles.agentTimer}`}>{toMMSS(state.elapsed)}</div>
              <div className={styles.progressTrack}>
                <motion.div
                  className={`${styles.progressBar} ${styles.agentBar}`}
                  animate={{ width: `${agentProgress}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
              <div className={styles.statusLine}>
                {'agent_wins' === state.phase ? (
                  <motion.span
                    className={styles.doneText}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  >
                    Готово ✓
                  </motion.span>
                ) : (
                  <>
                    <span className={`${styles.cursor} ${styles.agentCursor}`} />
                    <span className={styles.statusText}>{agentAction}...</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
