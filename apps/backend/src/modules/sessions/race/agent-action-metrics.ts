import type { SoloStepPayload } from '@/lib/agent/agent-manager.types.js';

export function countAgentClicks(payload: Pick<SoloStepPayload, 'action_type' | 'action_inputs' | 'executedActions'>): number | null {
  const actions = payload.executedActions
    ?? (payload.action_type ? [{ type: payload.action_type, inputs: payload.action_inputs ?? {} }] : null);
  if (!actions) return null;
  return actions.reduce((total, { type, inputs }) => {
    const fixed: Record<string, number> = { left_double: 2, right_single: 1, triple_click: 3 };
    if (Object.hasOwn(fixed, type)) return total + fixed[type]!;
    if (type !== 'click') return total;
    const count = inputs['count'];
    return total + (typeof count === 'number' && Number.isSafeInteger(count) && count > 0 ? count : 1);
  }, 0);
}

export function countsAsAgentStep(payload: Pick<SoloStepPayload, 'status' | 'action_type'>): boolean {
  return payload.status === 'INCOMPLETE' && !['done', 'finished', 'finish', 'success', 'failed', 'cancelled'].includes(payload.action_type ?? '');
}

/** Derive the current display contract from the immutable action journal, including older saved results. */
export function summarizeAgentActions(actions: Array<{ step: number | null; details: unknown }>) {
  const steps = new Map<number, { counted: boolean; clicks: number | null }>();
  for (const action of actions) {
    if (action.step === null || typeof action.details !== 'object' || !action.details) continue;
    const payload = action.details as SoloStepPayload;
    const previous = steps.get(action.step) ?? { counted: false, clicks: null };
    const measured = countAgentClicks(payload);
    steps.set(action.step, {
      counted: previous.counted || countsAsAgentStep(payload),
      clicks: measured === null ? previous.clicks : Math.max(previous.clicks ?? 0, measured),
    });
  }
  const counted = [...steps.entries()].filter(([, value]) => value.counted);
  const measured = [...steps.values()].filter((value) => value.clicks !== null);
  return { steps: counted.length, lastStep: counted.length ? Math.max(...counted.map(([step]) => step)) : null,
    clicks: measured.length ? measured.reduce((total, value) => total + value.clicks!, 0) : null };
}
