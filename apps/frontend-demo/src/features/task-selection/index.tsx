import { useEffect } from 'react';

import { useTasks } from '@arena/ui/api/tasks.api';
import { FeedbackToast } from '@arena/ui/ui/feedback-toast';
import { AnimatePresence, motion } from 'framer-motion';

import decorativeWave from '@/assets/images/task-selection/decorative-wave.svg';

import { CustomTaskForm } from './components';
import { BASE_TRANSITION, FADE_UP } from './task-selection.constants';
import { useTaskSelection } from './use-task-selection';

import styles from './task-selection.module.css';

export function TaskSelectionPage() {
  const { data: tasks, isLoading: areTasksLoading, isError: areTasksError } = useTasks();
  const {
    customDraft,
    setCustomDraft,
    handleStart,
    isStarting,
    validationError,
    dismissValidationError,
    selectPreset,
    selectedTask,
    startError,
  } = useTaskSelection();

  useEffect(() => {
    if (!validationError) return undefined;

    const timeout = window.setTimeout(dismissValidationError, 5_000);
    return () => window.clearTimeout(timeout);
  }, [dismissValidationError, validationError]);

  return (
    <div className={styles.layout}>
      <img className={styles.wave} src={decorativeWave} alt="" aria-hidden="true" />
      <div className={styles.main}>
        <motion.div className={styles.titleBlock} {...FADE_UP}>
          <p className={styles.pageEyebrow}>Арена AI агентов</p>
          <h1 className={styles.pageTitle}>Введите запрос для агента</h1>
          <p className={styles.pageSubtitle}>Опишите своё задание или выберите готовое</p>
        </motion.div>

        <motion.div
          className={styles.requestArea}
          {...FADE_UP}
          transition={{ ...BASE_TRANSITION, delay: 0.05 }}
        >
          <CustomTaskForm
            value={customDraft}
            onChange={setCustomDraft}
            onSubmit={handleStart}
            disabled={isStarting}
            isSubmitting={isStarting}
            hasSelectedTask={Boolean(selectedTask)}
          />
          {startError && !validationError ? <p role="alert">{startError.message}</p> : null}
          <div className={styles.quickActions} aria-label="Готовые задания">
            {areTasksLoading ? <span className={styles.quickActionsStatus}>Загружаем задания…</span> : null}
            {areTasksError ? <span className={styles.quickActionsError}>Не удалось загрузить задания</span> : null}
            {tasks?.map((task) => (
              <button
                key={task.id}
                className={styles.quickAction}
                type="button"
                onClick={() => selectPreset(task)}
              >
                {task.title}
              </button>
            ))}
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {validationError ? (
          <FeedbackToast
            title="Ваш запрос не прошёл проверку"
            message="Пожалуйста, переформулируйте свой запрос или выберите из готовых"
            onDismiss={dismissValidationError}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
