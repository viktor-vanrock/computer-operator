import { AnimatePresence, motion } from 'framer-motion';

import type { AgentClick } from '../../arena-player.types';

import { DURATION_SEC } from './constants';
import { useClickPosition } from './use-click-position';

import styles from './click-animation.module.css';

function ClickMarker({
  click,
  resolvePosition,
  onDone,
}: {
  click: AgentClick
  resolvePosition: (relX: number, relY: number) => { x: number; y: number }
  onDone: () => void
}) {
  const pos = resolvePosition(click.x, click.y);

  return (
    <div className={styles.clickPoint} style={{ left: pos.x, top: pos.y }}>
      {/* Центральная точка */}
      <motion.div
        className={styles.centerDot}
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale: [0, 1.2, 1], opacity: [1, 1, 0] }}
        transition={{ duration: DURATION_SEC * 0.6, ease: 'easeOut' }}
      />
      {/* Первое кольцо */}
      <motion.div
        className={styles.rippleCircle}
        initial={{ scale: 0, opacity: 0.9 }}
        animate={{ scale: 1, opacity: 0 }}
        transition={{ duration: DURATION_SEC, ease: 'easeOut' }}
        onAnimationComplete={onDone}
      />
      {/* Второе кольцо с задержкой */}
      <motion.div
        className={styles.rippleCircleOuter}
        initial={{ scale: 0, opacity: 0.6 }}
        animate={{ scale: 1, opacity: 0 }}
        transition={{ duration: DURATION_SEC, ease: 'easeOut', delay: DURATION_SEC * 0.2 }}
      />
    </div>
  );
}

interface ClickAnimationOverlayProps {
  clicks: AgentClick[]
  onRemove: (id: string) => void
}

export function ClickAnimationOverlay({ clicks, onRemove }: ClickAnimationOverlayProps) {
  const { setRef, resolvePosition } = useClickPosition();

  return (
    <div ref={setRef} className={styles.overlay}>
      <AnimatePresence>
        {clicks.map((click) => (
          <ClickMarker
            key={click.id}
            click={click}
            resolvePosition={resolvePosition}
            onDone={() => onRemove(click.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
