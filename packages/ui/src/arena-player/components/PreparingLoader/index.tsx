/**
 * PreparingLoader — анимированный экран ожидания подготовки ВМ.
 * Показывает последовательные шаги с прогресс-индикатором.
 */
// import { useEffect } from 'react';

import {
  RobotIcon,
  // SpinnerIcon,
} from '@phosphor-icons/react';

// import { motion } from 'framer-motion';
// import { TOTAL_DURATION } from './constants';
import styles from './PreparingLoader.module.css';

export function PreparingLoader() {
  // const [activeStep, setActiveStep] = useState(0);
  // const [progress, setProgress] = useState(0);

  // Шаги
  // useEffect(() => {
  //   let elapsed = 0;
  //   const timers: ReturnType<typeof setTimeout>[] = [];

  //   STEPS.forEach((step, i) => {
  //     const t = setTimeout(() => {
  //       setActiveStep(i);
  //     }, elapsed);
  //     timers.push(t);
  //     elapsed += step.duration;
  //   });

  //   return () => { timers.forEach(clearTimeout); };
  // }, []);

  // Плавный прогресс
  // useEffect(() => {
  //   const start = Date.now();
  //   const frame = () => {
  //     const elapsed = Date.now() - start;
  //     setProgress(Math.min(elapsed / TOTAL_DURATION, 0.95)); // до 95% — финал при RUNNING
  //     if (elapsed < TOTAL_DURATION) {
  //       requestAnimationFrame(frame);
  //     }
  //   };
  //   const raf = requestAnimationFrame(frame);
  //   return () => cancelAnimationFrame(raf);
  // }, []);

  return (
    <div className={styles.preparingWrap}>
      {/* Центральная анимация */}
      <div className={styles.orbWrap}>
        <div className={styles.orbOuter} />
        <div className={styles.orbMiddle} />
        <div className={styles.orbInner}>
          <RobotIcon weight="thin" size={36} className={styles.orbIcon} />
        </div>
        {/* Орбитальные частицы */}
        <div className={styles.orbit1}><div className={styles.particle} /></div>
        <div className={styles.orbit2}><div className={styles.particle} /></div>
        <div className={styles.orbit3}><div className={styles.particleSm} /></div>
      </div>

      {/* Заголовок */}
      <div className={styles.preparingTitle}>Подготовка рабочей среды</div>
      <div className={styles.preparingSubtitle}>
        Разворачиваем виртуальную машину
        <br />
        Запускаем UI агента
      </div>

      {/* Список шагов */}
      {/* <div className={styles.stepsList}>
        {STEPS.map((step, i) => {
          const isDone = i < activeStep;
          const isActive = i === activeStep;
          return (
            <div
              key={step.label}
              className={`${styles.stepRow} ${isDone ? styles.stepDone : ''} ${isActive ? styles.stepActive : ''}`}
            >
              <div className={styles.stepIcon}>
                {isActive ? (
                  <SpinnerIcon weight="bold" size={14} className={styles.spinnerIcon} />
                ) : (
                  step.icon
                )}
              </div>
              <span className={styles.stepLabel}>{step.label}</span>
              {isDone && <span className={styles.stepCheck}>✓</span>}
            </div>
          );
        })}
      </div> */}

      {/* Прогресс-бар */}
      {/* <div className={styles.progressTrack}>
        <motion.div
          className={styles.progressFill}
          animate={{ width: `${progress * 100}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
      <div className={styles.progressLabel}>
        {Math.round(progress * 100)}%
      </div> */}
    </div>
  );
}
