import { Navigate, useParams } from 'react-router-dom';

import { useAvailableImages } from '@arena/ui/api/images.api';
import { FADE_UP } from '@arena/ui/constants/motion';
import { StyledSelect } from '@arena/ui/ui/styled-select';
import { TaskTextarea } from '@arena/ui/ui/task-textarea';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

import { ROUTES } from '@/constants/routes';

import type { ImageSelectionValue } from './image-options';
import { buildImageOptions, parseImageSelection } from './image-options';
import { useAgentProfiles } from './use-agent-profiles';
import { useTaskSelection } from './use-task-selection';

import styles from './task-selection.module.css';

export function TaskSelectionPage() {
  const { mode: modeParam } = useParams<{ mode: string }>();

  if (modeParam !== 'solo' && modeParam !== 'full-duplex' && modeParam !== 'human-vs-agent') {
    return <Navigate to={ROUTES.TASKS_FULL_DUPLEX} replace />;
  }

  const mode = 'solo' === modeParam ? 'SOLO' : 'human-vs-agent' === modeParam ? 'HUMAN_VS_AGENT' : 'FULL_DUPLEX';

  return <TaskSelectionForm key={mode} mode={mode} />;
}

function TaskSelectionForm({ mode }: { mode: 'SOLO' | 'FULL_DUPLEX' | 'HUMAN_VS_AGENT' }) {
  const profilesQuery = useAgentProfiles(mode !== 'FULL_DUPLEX');
  const availableProfiles = profilesQuery.isError ? [] : (profilesQuery.data ?? []);
  const profileOptions = availableProfiles.map((profile) => ({ value: profile.id, label: profile.displayName }));
  const availableProfileIds = new Set(profileOptions.map((profile) => profile.value));
  const imagesQuery = useAvailableImages();
  const availableImages = imagesQuery.isError ? [] : (imagesQuery.data ?? []);
  const availableImageIds = imagesQuery.isPending
    ? null
    : new Set(availableImages.map((image) => image.imageId));
  const {
    taskDraft,
    setTaskDraft,
    imageSelection,
    agentModel,
    setImageSelection,
    setAgentModel,
    historyMaxStepsCount,
    setHistoryMaxStepsCount,
    maxScreenshotsDelay,
    setMaxScreenshotsDelay,
    maxIterations,
    setMaxIterations,
    modelRetries,
    setModelRetries,
    mouseClickDelay,
    setMouseClickDelay,
    minOperationDelay,
    setMinOperationDelay,
    canStart,
    isStarting,
    startError,
    handleStart,
  } = useTaskSelection(mode, availableImageIds, availableProfileIds);

  const isFullDuplex = 'FULL_DUPLEX' === mode;

  return (
    <div className={styles.page}>
      <motion.div className={styles.titleBlock} {...FADE_UP}>
        <h1 className={styles.pageTitle}>{isFullDuplex ? 'Настройте Full Duplex-сессию' : 'HUMAN_VS_AGENT' === mode ? 'Настройте соревнование' : 'Настройте SOLO-сессию'}</h1>
        <p className={styles.pageSubtitle}>
          {isFullDuplex
            ? 'Свободный диалог с агентом без начальной задачи — инструкции вводятся в чате'
            : 'Выберите окружение и параметры запуска агента'}
        </p>
      </motion.div>

      {!isFullDuplex && (
        <motion.div {...FADE_UP} transition={{ ...FADE_UP.transition, delay: 0.05 }}>
          <label className={styles.label} htmlFor="taskDraft">Своё задание</label>
          <TaskTextarea
            id="taskDraft"
            value={taskDraft}
            onChange={setTaskDraft}
            placeholder="Например: откройте браузер и найдите…"
            hint="Текст будет передан агенту как промпт"
            disabled={isStarting}
            onKeyDown={(event) => {
              if ('Enter' !== event.key || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (canStart && !isStarting) void handleStart();
            }}
          />
        </motion.div>
      )}

      {isFullDuplex && (
        <motion.div className={styles.configRow} {...FADE_UP} transition={{ ...FADE_UP.transition, delay: 0.1 }}>
          <OsImageField
            value={imageSelection}
            onChange={setImageSelection}
            disabled={isStarting}
            options={buildImageOptions(availableImages)}
            isLoading={imagesQuery.isPending}
            hasError={imagesQuery.isError}
          />
        </motion.div>
      )}

      {!isFullDuplex && (
        <motion.div className={styles.configColumn} {...FADE_UP} transition={{ ...FADE_UP.transition, delay: 0.1 }}>
          <OsImageField
            value={imageSelection}
            onChange={setImageSelection}
            disabled={isStarting}
            options={buildImageOptions(availableImages)}
            isLoading={imagesQuery.isPending}
            hasError={imagesQuery.isError}
          />

          <div className={styles.field}>
            <label className={styles.label}>Модель агента</label>
            <StyledSelect
              value={agentModel}
              options={profileOptions}
              placeholder="Выберите модель"
              onChange={setAgentModel}
              disabled={isStarting || profilesQuery.isPending || profilesQuery.isError}
            />
            {profilesQuery.isPending && <span>Загружаем модели…</span>}
            {profilesQuery.isError && <span role="alert">Не удалось загрузить модели. <button type="button" onClick={() => { void profilesQuery.refetch(); }}>Повторить</button></span>}
            {!profilesQuery.isPending && !profilesQuery.isError && 0 === profileOptions.length && <span role="alert">Нет доступных моделей</span>}
          </div>

          <SoloNumberField
            id="maxIterations"
            label="Максимум итераций"
            value={maxIterations}
            onChange={setMaxIterations}
            disabled={isStarting}
            integer
          />
          <SoloNumberField
            id="modelRetries"
            label="Количество повторных попыток модели"
            value={modelRetries}
            onChange={setModelRetries}
            disabled={isStarting}
            integer
          />
          <SoloNumberField
            id="mouseClickDelay"
            label="Задержка клика мыши, сек"
            value={mouseClickDelay}
            onChange={setMouseClickDelay}
            disabled={isStarting}
          />
          <SoloNumberField
            id="minOperationDelay"
            label="Минимальная задержка между операциями, сек"
            value={minOperationDelay}
            onChange={setMinOperationDelay}
            disabled={isStarting}
          />
        </motion.div>
      )}

      {isFullDuplex && (
        <motion.div className={styles.configRow} {...FADE_UP} transition={{ ...FADE_UP.transition, delay: 0.12 }}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="historyMaxStepsCount">Длина истории</label>
            <input
              id="historyMaxStepsCount"
              type="number"
              min={1}
              className={styles.numberInput}
              value={historyMaxStepsCount}
              onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1) setHistoryMaxStepsCount(v); }}
              disabled={isStarting}
            />
            <span className={styles.inputHint}>Шагов памяти агента</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="maxScreenshotsDelay">Задержка между скриншотами, сек</label>
            <input
              id="maxScreenshotsDelay"
              type="number"
              min={1}
              className={styles.numberInput}
              value={maxScreenshotsDelay}
              onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1) setMaxScreenshotsDelay(v); }}
              disabled={isStarting}
            />
          </div>
        </motion.div>
      )}

      <motion.div {...FADE_UP} transition={{ ...FADE_UP.transition, delay: 0.15 }}>
        <button
          type="button"
          className={styles.startBtn}
          disabled={!canStart || isStarting}
          onClick={handleStart}
          aria-label="Начать испытание"
        >
          {!isStarting && <span className={styles.startBtnShimmer} aria-hidden="true" />}
          {isStarting ? 'Запускаем...' : 'Начать'}
        </button>

        {startError && (
          <p className={styles.inlineError}>
            <WarningCircleIcon weight="fill" size={14} />
            Не удалось создать сессию. Попробуйте ещё раз.
          </p>
        )}
      </motion.div>
    </div>
  );
}

function SoloNumberField({
  id, label, value, onChange, disabled, integer = false,
}: {
  id: string;
  label: string;
  value: number | '';
  onChange: (value: number | '') => void;
  disabled: boolean;
  integer?: boolean;
}) {
  const isValid = value !== '' && Number.isFinite(value) && value >= 0 && (!integer || Number.isInteger(value));

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={0}
        step={integer ? 1 : 'any'}
        className={styles.numberInput}
        value={value}
        onChange={(event) => onChange('' === event.target.value ? '' : event.target.valueAsNumber)}
        disabled={disabled}
        aria-invalid={!isValid}
        aria-describedby={isValid ? undefined : `${id}-error`}
      />
      {!isValid && (
        <span id={`${id}-error`} className={styles.inputWarning} role="alert">
          {integer ? 'Введите целое неотрицательное число' : 'Введите неотрицательное число'}
        </span>
      )}
    </div>
  );
}

function OsImageField({
  value, onChange, disabled, options, isLoading, hasError,
}: {
  value: ImageSelectionValue;
  onChange: (value: ImageSelectionValue) => void;
  disabled: boolean;
  options: ReturnType<typeof buildImageOptions>;
  isLoading: boolean;
  hasError: boolean;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>Операционная система</label>
      <StyledSelect
        value={value}
        options={options}
        placeholder="Выберите ОС или образ"
        onChange={(nextValue) => {
          if (nextValue) onChange(parseImageSelection(nextValue));
        }}
        disabled={disabled}
      />
      {isLoading && <span className={styles.inputHint}>Загрузка доступных образов…</span>}
      {hasError && (
        <span className={styles.inputWarning} role="status">
          Не удалось загрузить образы — доступна только Ubuntu
        </span>
      )}
    </div>
  );
}
