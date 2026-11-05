import { describe, expect, it } from 'vitest';
import { HumanActionBatchSchema, RaceActionPageSchema } from '@/modules/sessions/race/race.schema.js';

const click = {
  eventId: '11111111-1111-4111-8111-111111111111', occurredAt: '2026-10-09T10:00:00.000Z',
  kind: 'CLICK', details: { x: 0.5, y: 0, button: 'left' },
};

describe('human event validation', () => {
  it('accepts double/triple clicks and preserves legacy details for duplicate replay', () => {
    expect(HumanActionBatchSchema.parse({ events: [click] }).events[0]).toEqual(click);
    for (const count of [1, 2, 3]) {
      expect(HumanActionBatchSchema.safeParse({ events: [{ ...click, details: { ...click.details, count } }] }).success).toBe(true);
    }
    for (const count of [0, 4, 1.5, '2']) {
      expect(HumanActionBatchSchema.safeParse({ events: [{ ...click, details: { ...click.details, count } }] }).success).toBe(false);
    }
  });
  it('accepts only the strict supported union with normalized coordinates', () => {
    expect(HumanActionBatchSchema.safeParse({ events: [click] }).success).toBe(true);
    expect(HumanActionBatchSchema.safeParse({ events: [{ ...click, explanation: 'invented' }] }).success).toBe(false);
    expect(HumanActionBatchSchema.safeParse({ events: [{ ...click, winner: 'HUMAN' }] }).success).toBe(false);
    expect(HumanActionBatchSchema.safeParse({ events: [{ ...click, details: { ...click.details, x: 1.1 } }] }).success).toBe(false);
    expect(HumanActionBatchSchema.safeParse({ events: [{ ...click, details: { ...click.details, x: Infinity } }] }).success).toBe(false);
  });
  it('requires 1..50 events and paging in ASC windows of 1..200', () => {
    expect(HumanActionBatchSchema.safeParse({ events: [] }).success).toBe(false);
    expect(HumanActionBatchSchema.safeParse({ events: Array(51).fill(click) }).success).toBe(false);
    expect(RaceActionPageSchema.parse({})).toEqual({ afterSequence: 0, limit: 100 });
    expect(RaceActionPageSchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(RaceActionPageSchema.safeParse({ afterSequence: '-1' }).success).toBe(false);
  });
});

describe('human keys and gestures', () => {
  it('accepts supported gestures and validates key range/modifiers without explanation', () => {
    const base = { eventId: click.eventId, occurredAt: click.occurredAt };
    for (const event of [
      { ...base, kind: 'DRAG', details: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, button: 'right' } },
      { ...base, kind: 'SCROLL', details: { x: 0, y: 1, deltaX: -2, deltaY: 10 } },
      { ...base, kind: 'KEY_INPUT', details: { keysym: 0xffffffff, modifiers: ['Ctrl'] } },
      { ...base, kind: 'KEY_INPUT', details: { keysym: 97, keysyms: [97, 98, 99], modifiers: [] } },
    ]) expect(HumanActionBatchSchema.safeParse({ events: [event] }).success).toBe(true);
    for (const details of [{ keysym: -1, modifiers: [] }, { keysym: 0x100000000, modifiers: [] },
      { keysym: 97, modifiers: ['Ctrl', 'Ctrl'] }, { keysym: 97, modifiers: ['Unknown'] }]) {
      expect(HumanActionBatchSchema.safeParse({ events: [{ ...base, kind: 'KEY_INPUT', details }] }).success).toBe(false);
    }
  });
});
