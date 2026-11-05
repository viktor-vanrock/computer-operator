import { describe, expect, it } from 'vitest';
import { countAgentClicks, countsAsAgentStep, summarizeAgentActions } from '@/modules/sessions/race/agent-action-metrics.js';

describe('race agent measurements', () => {
  it('uses executed actions instead of planned clicks and counts double/triple/right clicks', () => {
    expect(countAgentClicks({ action_type: 'click', executedActions: [{ type: 'scroll', inputs: {} }] })).toBe(0);
    expect(countAgentClicks({ executedActions: [{ type: 'click', inputs: { count: 2 } }, { type: 'right_single', inputs: {} }, { type: 'triple_click', inputs: {} }] })).toBe(6);
    expect(countAgentClicks({})).toBeNull();
  });
  it('excludes completion/failure/cancellation while keeping an actual action step', () => {
    expect(countsAsAgentStep({ status: 'INCOMPLETE', action_type: 'click' })).toBe(true);
    for (const status of ['DONE', 'FAILED', 'CANCELLED'] as const) expect(countsAsAgentStep({ status, action_type: 'click' })).toBe(false);
    expect(countsAsAgentStep({ status: 'INCOMPLETE', action_type: 'done' })).toBe(false);
  });
  it('reconstructs saved results from actions while deduplicating statuses and omitting the final summary', () => {
    expect(summarizeAgentActions([
      { step: 0, details: { status: 'INCOMPLETE', action_type: 'click', action_inputs: { count: 2 } } },
      { step: 0, details: { status: 'DONE', action_type: 'click', action_inputs: { count: 2 } } },
      { step: 1, details: { status: 'DONE', action_type: 'done' } },
    ])).toEqual({ steps: 1, clicks: 2, lastStep: 0 });
  });

});
