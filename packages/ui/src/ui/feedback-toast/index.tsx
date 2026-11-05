import { createPortal } from 'react-dom';

import { WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

import styles from './feedback-toast.module.css';

interface FeedbackToastProps {
  title: string;
  message?: string;
  id?: string;
  onDismiss: () => void;
}

export function FeedbackToast({ title, message, id, onDismiss }: FeedbackToastProps) {
  return createPortal(
    <motion.div
      className={styles.feedback}
      id={id}
      role="alert"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <span className={styles.icon}><WarningCircleIcon size={24} aria-hidden="true" /></span>
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        {message ? <p className={styles.text}>{message}</p> : null}
      </div>
      <button className={styles.close} type="button" onClick={onDismiss} aria-label="Закрыть сообщение">
        <XIcon size={16} aria-hidden="true" />
      </button>
    </motion.div>,
    document.body
  );
}
