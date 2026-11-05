import type { AdminTask } from '@arena/ui/types/task.types';

export function serializePresetExport(tasks: AdminTask[]): string {
  return JSON.stringify({
    tasks: tasks.map(({ title, prompt, imageId, difficulty, isVisible }) => ({
      title,
      prompt,
      imageId,
      difficulty,
      isVisible,
    })),
  }, null, 2);
}

export function downloadPresetExport(tasks: AdminTask[]): void {
  const blob = new Blob([serializePresetExport(tasks)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'task-presets.json';
  link.click();
  URL.revokeObjectURL(url);
}
