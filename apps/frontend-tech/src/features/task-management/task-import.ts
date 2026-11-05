import type { PresetTaskInput } from '@arena/ui/api/tasks.api';

const isObject = (value: unknown): value is Record<string, unknown> =>
  'object' === typeof value && null !== value && !Array.isArray(value);

export function parsePresetImport(text: string): PresetTaskInput[] {
  const parsed: unknown = JSON.parse(text);
  const entries = Array.isArray(parsed)
    ? parsed
    : isObject(parsed) && Array.isArray(parsed['tasks'])
      ? parsed['tasks']
      : null;

  if (!entries || 0 === entries.length) {
    throw new Error('JSON должен содержать непустой массив задач или объект с полем tasks');
  }

  return entries.map((entry, index) => {
    if (!isObject(entry)) throw new Error(`Задача ${index + 1}: ожидается объект`);
    const title = entry['title'];
    const prompt = entry['prompt'];
    const imageId = entry['imageId'] ?? null;
    const difficulty = entry['difficulty'];
    const isVisible = entry['isVisible'] ?? true;

    if ('string' !== typeof title || !title.trim()) throw new Error(`Задача ${index + 1}: заполните title`);
    if ('string' !== typeof prompt || !prompt.trim()) throw new Error(`Задача ${index + 1}: заполните prompt`);
    if (null !== imageId && ('string' !== typeof imageId || !imageId.trim())) {
      throw new Error(`Задача ${index + 1}: imageId должен быть непустой строкой или null`);
    }
    if ('number' !== typeof difficulty || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
      throw new Error(`Задача ${index + 1}: difficulty должен быть целым числом от 1 до 5`);
    }
    if ('boolean' !== typeof isVisible) throw new Error(`Задача ${index + 1}: isVisible должен быть boolean`);

    return {
      title: title.trim(),
      prompt: prompt.trim(),
      imageId: 'string' === typeof imageId ? imageId.trim() : null,
      difficulty,
      isVisible,
    } as PresetTaskInput;
  });
}

export const PRESET_IMPORT_TEMPLATE = {
  tasks: [
    {
      title: 'Короткое название задачи для интерфейса',
      prompt: 'Полная инструкция, которую получит агент при запуске задачи',
      imageId: null,
      difficulty: 3,
      isVisible: true,
    },
  ],
};
