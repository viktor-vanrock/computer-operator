interface Ack { accepted: Array<{ eventId: string; sequence: number }> }

/** One immutable head batch; unknown acknowledgement never lets later input overtake it. */
export class HumanActionQueue<T extends { eventId: string }> {
  private queued: T[] = [];
  private head: T[] | null = null;
  private sending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private attempts = 0;
  private permanent = false;
  private failed = false;

  constructor(private send: (events: T[]) => Promise<Ack>, private onChange: () => void) {}

  pending(): T[] { return [...(this.head ?? []), ...this.queued]; }
  status(): 'pending' | 'failed' | 'unsaved' {
    return this.disposed ? 'unsaved' : this.failed || this.permanent ? 'failed' : 'pending';
  }

  push(event: T): void {
    if (this.disposed) return;
    this.queued.push(event);
    this.onChange();
    if (!this.head && !this.sending && !this.permanent) {
      if (this.queued.length >= 50) { void this.flush(); }
      else if (!this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 100);
    }
  }

  async flush(): Promise<void> {
    if (this.disposed || this.sending || this.permanent) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.head) this.head = this.queued.splice(0, 50);
    if (!this.head.length) { this.head = null; return; }
    this.sending = true;
    this.failed = false;
    this.onChange();
    try {
      const result = await this.send(this.head);
      if (!this.head.every((event) => result.accepted.some((item) => item.eventId === event.eventId))) {
        throw new Error('INCOMPLETE_ACTION_ACK');
      }
      this.head = null;
      this.attempts = 0;
    } catch (error) {
      this.failed = true;
      const status = 'object' === typeof error && error ? (error as { status?: number }).status : undefined;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) this.permanent = true;
      else {
        const delay = [250, 500, 1000, 2000][Math.min(this.attempts++, 3)] ?? 2000;
        this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, delay);
      }
    } finally {
      this.sending = false;
      this.onChange();
      if (!this.disposed && !this.head && this.queued.length && !this.permanent) {
        this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 0);
      }
    }
  }

  async finishFlush(): Promise<void> {
    await Promise.race([
      this.flush().then(async () => {
        if (this.pending().length) await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 250)),
    ]);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.onChange();
  }
}
