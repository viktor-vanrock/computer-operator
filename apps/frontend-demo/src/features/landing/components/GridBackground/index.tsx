import styles from './grid-background.module.css';

export function GridBackground() {
  return (
    <div className={styles.wrapper}>
      <div className={styles.aurora}>
        <div className={`${styles.auroraBlob} ${styles.auroraBlob1}`} />
        <div className={`${styles.auroraBlob} ${styles.auroraBlob2}`} />
        <div className={`${styles.auroraBlob} ${styles.auroraBlob3}`} />
      </div>
    </div>
  );
}
