import { motion } from 'framer-motion';

import { STATS } from '@/features/landing/constants';

import styles from './stats-row.module.css';

interface StatCardProps {
  base: number;
  label: string;
  suffix: string;
  delay: number;
}

function StatCard({ base, label, suffix, delay }: StatCardProps) {
  return (
    <motion.div
      className={styles.card}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    >
      <span className={styles.value}>
        {base}
        <span className={styles.suffix}>{suffix}</span>
      </span>
      <span className={styles.label}>{label}</span>
    </motion.div>
  );
}

export function StatsRow() {
  const featureFlag = 'true' === import.meta.env['VITE_FF_LAND_STAT'];

  if (!featureFlag) {
    return null;
  }

  return (
    <div className={styles.row}>
      {STATS.map((stat, i) => (
        <StatCard
          key={stat.id}
          base={stat.base}
          label={stat.label}
          suffix={stat.suffix}
          delay={i * 0.1}
        />
      ))}
    </div>
  );
}
