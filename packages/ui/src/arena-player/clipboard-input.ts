import Guacamole from 'guacamole-common-js';

export type InputClient = Pick<Guacamole.Client, 'sendKeyEvent' | 'sendMouseState' | 'createClipboardStream'>;
type Command = { kind: 'text'; text: string } | { kind: 'key'; pressed: 0 | 1; keysym: number; modifiers: readonly string[] }
  | { kind: 'mouse'; state: Guacamole.Mouse.State };

const BATCH_MS = 60;
// RDP offers no acknowledgement that the target application consumed a paste.
// These conservative gaps are an experimental pacing policy, not delivery proof.
const CLIPBOARD_READY_MS = 100;
const PASTE_SETTLE_MS = 150;
const MAX_QUEUE = 512;
const MAX_TEXT = 2048;
const CTRL = 0xffe3;
const V = 0x76;
const isModifier = (key: number) => key >= 0xffe1 && key <= 0xffee;
const MODIFIERS = [
  { name: 'Shift', left: 0xffe1, right: 0xffe2 }, { name: 'Ctrl', left: 0xffe3, right: 0xffe4 },
  { name: 'Alt', left: 0xffe9, right: 0xffea }, { name: 'Meta', left: 0xffeb, right: 0xffec },
];

export function clipboardCharacter(keysym: number): string | null {
  const codepoint = keysym - 0x01000000;
  return (codepoint >= 0x0400 && codepoint <= 0x052f) || 0x2116 === codepoint ? String.fromCodePoint(codepoint) : null;
}

/** Serializes clipboard pastes with subsequent keys and pointer actions. */
export class ClipboardInput {
  private queue: Command[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private disposed = false;
  private generation = 0;
  private remoteKeys = new Set<number>();
  private remoteMouse: Guacamole.Mouse.State | null = null;

  constructor(private client: InputClient, private canSend: () => boolean, private onError: () => void) {}

  text(text: string): void {
    if (this.disposed) return;
    const last = this.queue.at(-1);
    if ('text' === last?.kind && last.text.length + text.length <= MAX_TEXT) last.text += text;
    else this.queue.push({ kind: 'text', text });
    this.schedule(true);
  }

  key(pressed: 0 | 1, keysym: number, modifiers: readonly string[]): void {
    this.queue.push({ kind: 'key', pressed, keysym, modifiers: [...modifiers] });
    this.schedule(false);
  }

  mouse(state: Guacamole.Mouse.State): void {
    this.queue.push({ kind: 'mouse', state });
    this.schedule(false);
  }

  private schedule(batch: boolean): void {
    if (this.queue.length > MAX_QUEUE) { this.fail(); return; }
    if (this.busy || this.disposed) return;
    if (this.timer) {
      if (batch) return;
      clearTimeout(this.timer); this.timer = null;
    }
    if (batch) this.timer = setTimeout(() => { this.timer = null; this.drain(); }, BATCH_MS);
    else this.drain();
  }

  private sendKey(pressed: 0 | 1, keysym: number): void {
    this.client.sendKeyEvent(pressed, keysym);
    if (pressed) this.remoteKeys.add(keysym);
    else this.remoteKeys.delete(keysym);
  }

  private drain(): void {
    if (this.disposed) return;
    if (!this.canSend()) { this.reset(); return; }
    try {
      while (this.queue.length) {
        const command = this.queue.shift()!;
        if ('text' === command.kind) { this.paste(command.text); return; }
        if ('key' === command.kind) {
          // Error recovery releases remote keys. Reconcile still-held host modifiers
          // on the next keydown, even if Guacamole.Keyboard emits no new modifier-down.
          if (command.pressed && !isModifier(command.keysym)) for (const modifier of MODIFIERS) {
            if (command.modifiers.includes(modifier.name)
              && !this.remoteKeys.has(modifier.left) && !this.remoteKeys.has(modifier.right)) this.sendKey(1, modifier.left);
          }
          this.sendKey(command.pressed, command.keysym);
        }
        else {
          this.client.sendMouseState(command.state);
          this.remoteMouse = command.state;
        }
      }
    } catch { this.fail(); }
  }

  private paste(text: string): void {
    this.busy = true;
    const generation = this.generation;
    const writer = new Guacamole.StringWriter(this.client.createClipboardStream('text/plain'));
    writer.onack = status => {
      if (generation === this.generation && !this.disposed && status.isError()) this.fail();
    };
    writer.sendText(text);
    writer.sendEnd();
    if (generation !== this.generation) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation !== this.generation || this.disposed || !this.canSend()) { this.reset(); return; }
      try {
        // Uppercase Russian input may leave Shift held. Ctrl+V must be unshifted.
        const modifiers = [...this.remoteKeys].filter(isModifier);
        for (const key of modifiers) this.sendKey(0, key);
        this.sendKey(1, CTRL); this.sendKey(1, V);
        this.sendKey(0, V); this.sendKey(0, CTRL);
        for (const key of modifiers) this.sendKey(1, key);
        this.timer = setTimeout(() => { this.timer = null; this.busy = false; this.drain(); }, PASTE_SETTLE_MS);
      } catch { this.fail(); }
    }, CLIPBOARD_READY_MS);
  }

  private fail(): void { this.reset(); this.onError(); }

  /** Drop queued input on focus loss; never paste into a newly focused application. */
  reset(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.queue = []; this.busy = false;
    for (const key of this.remoteKeys) {
      try { this.client.sendKeyEvent(0, key); } catch { /* Disconnected. */ }
    }
    this.remoteKeys.clear();
    if (this.remoteMouse && (this.remoteMouse.left || this.remoteMouse.middle || this.remoteMouse.right
      || this.remoteMouse.up || this.remoteMouse.down)) {
      try {
        this.client.sendMouseState(new Guacamole.Mouse.State(
          this.remoteMouse.x, this.remoteMouse.y, false, false, false, false, false
        ));
      } catch { /* Disconnected. */ }
    }
    this.remoteMouse = null;
  }

  dispose(): void { this.reset(); this.disposed = true; }
}
