import { useNavigate } from 'react-router-dom';

import { ArrowRightIcon } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

import { ROUTES } from '@/constants/routes';

import { ArenaPreview, FeatureCards, GridBackground, StatsRow } from './components';

import styles from './landing.module.css';

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <GridBackground />

        <div className={styles.heroInner}>
          <motion.h1
            className={styles.headline}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
          >
            Арена для{' '}
            <span className={styles.gradientText}>AI-агентов</span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            className={styles.subtitle}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
          >
            Наблюдай, как AI-агент выполняет задачи в реальном интерфейсе.
            <br />
            Изучай его действия и ход рассуждений в реальном времени.
          </motion.p>

          {/* CTA */}
          <motion.button
            className={styles.cta}
            onClick={() => navigate(ROUTES.TASK_SELECTION)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3, ease: 'easeOut' }}
            whileTap={{ opacity: 0.85 }}
          >
            Начать испытание
            <span className={styles.ctaArrow}>
              <ArrowRightIcon weight="bold" size={18} />
            </span>
          </motion.button>

          {/* Arena preview */}
          <motion.div
            className={styles.previewWrap}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: 'easeOut' }}
          >
            <ArenaPreview />
          </motion.div>

          {/* Stats */}
          <motion.div
            className={styles.statsWrap}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            <StatsRow />
          </motion.div>

          {/* Features */}
          <motion.div
            className={styles.features}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.7, ease: 'easeOut' }}
          >
            <FeatureCards />
          </motion.div>
        </div>
      </section>
    </div>
  );
}
