import { useMemo, useRef, useState } from 'react';

import { useAvailableImages } from '@arena/ui/api/images.api';
import {
  useAdminPresetTasks,
  useCreatePresetTask,
  useDeletePresetTask,
  useImportPresetTasks,
  useUpdatePresetTask,
} from '@arena/ui/api/tasks.api';
import { ApiError } from '@arena/ui/lib/api-client';
import type { AdminTask } from '@arena/ui/types/task.types';
import {
  DownloadSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  FileArrowUpIcon,
  NotePencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react';

import { downloadPresetExport } from './task-export';
import { parsePresetImport, PRESET_IMPORT_TEMPLATE } from './task-import';
import type { TaskFormValue } from './task-management.types';
import { EMPTY_TASK_FORM } from './task-management.types';

import styles from './task-management.module.css';

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && 409 === error.status) {
    return 'Удаление невозможно: сначала удалите все сессии, связанные с этой задачей.';
  }
  if (error instanceof Error) return error.message;
  return 'Не удалось выполнить операцию. Попробуйте ещё раз.';
}

export function TaskManagementPage() {
  const { data: tasks = [], isPending, isError } = useAdminPresetTasks();
  const imagesQuery = useAvailableImages();
  const availableImages = imagesQuery.data ?? [];
  const createTask = useCreatePresetTask();
  const updateTask = useUpdatePresetTask();
  const deleteTask = useDeletePresetTask();
  const importTasks = useImportPresetTasks();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingTask, setEditingTask] = useState<AdminTask | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const visibleCount = useMemo(() => tasks.filter((task) => task.isVisible).length, [tasks]);
  const isMutating = createTask.isPending || updateTask.isPending || deleteTask.isPending || importTasks.isPending;

  const openCreate = () => {
    setEditingTask(null);
    setIsCreating(true);
    setFeedback(null);
  };

  const closeForm = () => {
    setEditingTask(null);
    setIsCreating(false);
  };

  const saveTask = async (value: TaskFormValue) => {
    try {
      if (editingTask) {
        await updateTask.mutateAsync({ id: editingTask.id, input: value });
        setFeedback({ kind: 'success', text: 'Изменения сохранены.' });
      } else {
        await createTask.mutateAsync(value);
        setFeedback({ kind: 'success', text: 'Пресет создан.' });
      }
      closeForm();
    } catch (error) {
      setFeedback({ kind: 'error', text: errorMessage(error) });
    }
  };

  const toggleVisibility = async (task: AdminTask) => {
    try {
      await updateTask.mutateAsync({
        id: task.id,
        input: {
          title: task.title,
          prompt: task.prompt,
          imageId: task.imageId,
          difficulty: task.difficulty,
          isVisible: !task.isVisible,
        },
      });
      setFeedback({ kind: 'success', text: task.isVisible ? 'Пресет скрыт из пользовательского интерфейса.' : 'Пресет снова виден.' });
    } catch (error) {
      setFeedback({ kind: 'error', text: errorMessage(error) });
    }
  };

  const removeTask = async (task: AdminTask) => {
    if (!window.confirm(`Удалить пресет «${task.title}»?`)) return;
    try {
      await deleteTask.mutateAsync(task.id);
      setFeedback({ kind: 'success', text: 'Пресет удалён.' });
    } catch (error) {
      setFeedback({ kind: 'error', text: errorMessage(error) });
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const entries = parsePresetImport(await file.text());
      await importTasks.mutateAsync(entries);
      setFeedback({ kind: 'success', text: `Импортировано пресетов: ${entries.length}.` });
    } catch (error) {
      setFeedback({ kind: 'error', text: errorMessage(error) });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([JSON.stringify(PRESET_IMPORT_TEMPLATE, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'task-presets-template.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <h1>Управление задачами</h1>
          <p>Создавайте и редактируйте пресеты. Промпт передаётся агенту при старте и показывается пользователю перед запуском.</p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => downloadPresetExport(tasks)}
            disabled={isPending || isError || 0 === tasks.length}
          >
            <DownloadSimpleIcon size={18} /> Экспорт
          </button>
          <button type="button" className={styles.secondaryButton} onClick={downloadTemplate}>
            <DownloadSimpleIcon size={18} /> Скачать шаблон
          </button>
          <input
            ref={fileInputRef}
            className={styles.fileInput}
            type="file"
            accept="application/json,.json"
            onChange={(event) => importFile(event.target.files?.[0])}
          />
          <button type="button" className={styles.secondaryButton} onClick={() => fileInputRef.current?.click()} disabled={isMutating}>
            <FileArrowUpIcon size={18} /> Импорт
          </button>
          <button type="button" className={styles.primaryButton} onClick={openCreate} disabled={isMutating}>
            <PlusIcon size={18} /> Добавить
          </button>
        </div>
      </section>

      <div className={styles.summary}>
        <span>Всего пресетов: <strong>{tasks.length}</strong></span>
        <span>Показываются: <strong>{visibleCount}</strong></span>
        <span>Скрыты: <strong>{tasks.length - visibleCount}</strong></span>
      </div>

      {feedback && <div className={'error' === feedback.kind ? styles.errorNotice : styles.successNotice}>{feedback.text}</div>}

      <section className={styles.tablePanel} aria-label="Пресеты задач">
        {isPending && <p className={styles.state}>Загружаем пресеты…</p>}
        {isError && <p className={styles.state}>Не удалось загрузить пресеты.</p>}
        {!isPending && !isError && 0 === tasks.length && (
          <p className={styles.state}>Пресетов пока нет. Создайте первый или импортируйте JSON.</p>
        )}
        {tasks.length > 0 && (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Название</th><th>Промпт агента</th><th>Образ</th><th>Видимость</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className={task.isVisible ? undefined : styles.hiddenRow}>
                    <td><strong>{task.title}</strong><span className={styles.id}>{task.id}</span></td>
                    <td><p className={styles.prompt}>{task.prompt}</p></td>
                    <td><span className={styles.imageName}>{imageName(task.imageId, availableImages)}</span></td>
                    <td>
                      <button
                        type="button"
                        className={styles.visibilityButton}
                        onClick={() => void toggleVisibility(task)}
                        disabled={isMutating}
                      >
                        {task.isVisible ? <EyeIcon size={17} /> : <EyeSlashIcon size={17} />}
                        {task.isVisible ? 'Показывается' : 'Скрыта'}
                      </button>
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`Редактировать ${task.title}`}
                          onClick={() => { setIsCreating(false); setEditingTask(task); setFeedback(null); }}
                        ><NotePencilIcon size={18} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.iconButton} ${styles.dangerButton}`}
                          aria-label={`Удалить ${task.title}`}
                          onClick={() => void removeTask(task)}
                        ><TrashIcon size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(isCreating || editingTask) && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => { if (event.currentTarget === event.target) closeForm(); }}
        >
          <TaskForm
            task={editingTask}
            images={availableImages}
            imagesLoading={imagesQuery.isPending}
            isSaving={createTask.isPending || updateTask.isPending}
            onCancel={closeForm}
            onSave={saveTask}
          />
        </div>
      )}
    </div>
  );
}

function imageName(imageId: string | null, images: { imageId: string; name: string }[]): string {
  if (!imageId) return 'По умолчанию';
  return images.find((image) => image.imageId === imageId)?.name ?? imageId;
}

function TaskForm({ task, images, imagesLoading, isSaving, onCancel, onSave }: {
  task: AdminTask | null;
  images: { imageId: string; name: string }[];
  imagesLoading: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (value: TaskFormValue) => Promise<void>;
}) {
  const [value, setValue] = useState<TaskFormValue>(() => task
    ? {
      title: task.title,
      prompt: task.prompt,
      imageId: task.imageId,
      difficulty: task.difficulty,
      isVisible: task.isVisible,
    }
    : EMPTY_TASK_FORM);
  const canSave = value.title.trim().length > 0 && value.prompt.trim().length > 0;

  return (
    <form
      className={styles.modal}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ ...value, title: value.title.trim(), prompt: value.prompt.trim() });
      }}
    >
      <div className={styles.modalHeader}>
        <div>
          <h2>{task ? 'Редактировать пресет' : 'Новый пресет'}</h2>
          <p>Название увидит пользователь, промпт получит только агент.</p>
        </div>
        <button type="button" className={styles.iconButton} aria-label="Закрыть" onClick={onCancel}>
          <XIcon size={20} />
        </button>
      </div>
      <label className={styles.field}>
        Название в UI
        <input
          value={value.title}
          onChange={(event) => setValue((current) => ({ ...current, title: event.target.value }))}
          autoFocus
        />
      </label>
      <label className={styles.field}>
        Промпт для агента
        <textarea
          rows={7}
          value={value.prompt}
          onChange={(event) => setValue((current) => ({ ...current, prompt: event.target.value }))}
        />
      </label>
      <label className={styles.field}>
        Образ виртуальной машины
        <select
          value={value.imageId ?? ''}
          onChange={(event) => setValue((current) => ({ ...current, imageId: event.target.value || null }))}
          disabled={imagesLoading}
        >
          <option value="">Образ по умолчанию (Ubuntu)</option>
          {value.imageId && !images.some((image) => image.imageId === value.imageId) && (
            <option value={value.imageId}>{value.imageId} (недоступен сейчас)</option>
          )}
          {images.map((image) => <option key={image.imageId} value={image.imageId}>{image.name}</option>)}
        </select>
        {imagesLoading && <span className={styles.fieldHint}>Загружаем доступные образы…</span>}
      </label>
      <div className={styles.formRow}>
        <label className={styles.switchField}>
          <input
            type="checkbox"
            checked={value.isVisible}
            onChange={(event) => setValue((current) => ({ ...current, isVisible: event.target.checked }))}
          />
          <span>Показывать пользователям</span>
        </label>
      </div>
      <div className={styles.modalActions}>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>Отмена</button>
        <button type="submit" className={styles.primaryButton} disabled={!canSave || isSaving}>
          {isSaving ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}
