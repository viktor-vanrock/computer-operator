import { BrainIcon, ChartBarIcon, LightningIcon, SwordIcon } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import type { CSSProperties } from 'react';

import { FEATURES } from '@/features/landing/constants';

import styles from './feature-cards.module.css';

const ICON_MAP = {
  Lightning: LightningIcon,
  ChartBar: ChartBarIcon,
  Brain: BrainIcon,
  Swords: SwordIcon,
} as const;

type IconKey = keyof typeof ICON_MAP;

interface FeatureCardProps {
  icon: IconKey;
  label: string;
  desc: string;
  accentVar: string;
  delay: number;
}

function FeatureCard({ icon, label, desc, accentVar, delay }: FeatureCardProps) {
  const Icon = ICON_MAP[icon];

  return (
    <div style={{ '--accent': `var(${accentVar})` } as CSSProperties}>
      <motion.div
        className={styles.card}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay, ease: 'easeOut' }}
      >
        <span className={styles.iconWrap}>
          <Icon weight="light" size={28} />
        </span>
        <h3 className={styles.cardLabel}>{label}</h3>
        <p className={styles.cardDesc}>{desc}</p>
      </motion.div>
    </div>
  );
}

export function FeatureCards() {
  return (
    <div className={styles.grid}>
      {FEATURES.map((f, i) => (
        <FeatureCard
          key={f.id}
          icon={f.icon as IconKey}
          label={f.label}
          desc={f.desc}
          accentVar={f.accentVar}
          delay={0.1 + i * 0.1}
        />
      ))}
    </div>
  );
}
