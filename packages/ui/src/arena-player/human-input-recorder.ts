import type { HumanInputAction } from './human-input';

type InputRecord = Exclude<HumanInputAction, { kind: 'DRAG' }>;
type ClickDetails = Extract<InputRecord, { kind: 'CLICK' }>['details'];
const IDLE_MS = 400;
const CLICK_IDLE_MS = 500;
const MAX_DURATION_MS = 2000;
const MAX_KEYS = 128;

/** Aggregate telemetry only. Accepted mouse/key instructions reach the desktop immediately. */
export class HumanInputRecorder {
  private pending: InputRecord | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private clickDetail = 0;
  constructor(private readonly emit: (action: HumanInputAction) => void) {}

  /** Native detail distinguishes a multi-click from independent nearby clicks. */
  beginClick(details: ClickDetails, detail: number, tolerance: { x: number; y: number }): void {
    const previous = this.pending;
    const continuation = 'CLICK' === previous?.kind && (previous.details.count ?? 1) < 3
      && previous.details.button === details.button
      && Math.abs(previous.details.x - details.x) <= tolerance.x
      && Math.abs(previous.details.y - details.y) <= tolerance.y
      && ((0 === detail && 0 === this.clickDetail) || (detail > 1 && detail === this.clickDetail + 1));
    if (!continuation) this.flush();
    // Do not publish the first click while the next mouse button is held.
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    this.clickDetail = detail;
  }

  interruptClick(): void {
    if ('CLICK' === this.pending?.kind) this.flush();
  }

  record(action: InputRecord): void {
    const previous = this.pending;
    const sameKeys = 'KEY_INPUT' === previous?.kind && 'KEY_INPUT' === action.kind
      && previous.details.modifiers.join(',') === action.details.modifiers.join(',')
      && (previous.details.keysyms?.length ?? 1) < MAX_KEYS;
    const sameScroll = 'SCROLL' === previous?.kind && 'SCROLL' === action.kind
      && Math.sign(previous.details.deltaY) === Math.sign(action.details.deltaY);
    const sameClick = 'CLICK' === previous?.kind && 'CLICK' === action.kind
      && previous.details.button === action.details.button && (previous.details.count ?? 1) < 3;
    if (!sameKeys && !sameScroll && !sameClick) this.flush();
    if (sameKeys && 'KEY_INPUT' === previous?.kind && 'KEY_INPUT' === action.kind) {
      this.pending = { ...previous, details: { ...previous.details,
        keysyms: [...(previous.details.keysyms ?? [previous.details.keysym]), action.details.keysym] } };
    } else if (sameScroll && 'SCROLL' === previous?.kind && 'SCROLL' === action.kind) {
      this.pending = { ...previous, details: { ...action.details, deltaY: previous.details.deltaY + action.details.deltaY } };
    } else if (sameClick && 'CLICK' === previous?.kind && 'CLICK' === action.kind) {
      this.pending = { ...previous, details: { ...previous.details, count: (previous.details.count ?? 1) + 1 } };
    } else {
      this.pending = action;
      this.deadline = setTimeout(() => this.flush(), MAX_DURATION_MS);
    }
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.flush(), 'CLICK' === action.kind ? CLICK_IDLE_MS : IDLE_MS);
  }
  flush(): void {
    if (this.idle) clearTimeout(this.idle);
    if (this.deadline) clearTimeout(this.deadline);
    this.idle = null; this.deadline = null;
    const action = this.pending; this.pending = null;
    if (action) this.emit(action);
  }
}
