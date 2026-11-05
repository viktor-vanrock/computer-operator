export const OS_OPTIONS = [
  { value: 'ubuntu2204', label: 'Ubuntu' },
] as const;

export const MODEL_OPTIONS = [
  { value: 'computer-operator', label: 'Computer Operator' },
  { value: 'holo3', label: 'Holo3' },
  { value: 'qwen36', label: 'Qwen 3.6' },
  { value: 'ui-tars', label: 'UI Tars 1.5' },
  { value: 'opencua', label: 'OpenCUA' },
  { value: 'evocua', label: 'EvoCUA' },
] as const;

export type OsValue = (typeof OS_OPTIONS)[number]['value'];
export type ModelValue = (typeof MODEL_OPTIONS)[number]['value'];

export function getModelLabel(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  return MODEL_OPTIONS.find((m) => m.value === modelId)?.label ?? modelId;
}
