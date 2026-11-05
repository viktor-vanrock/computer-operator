import Guacamole from 'guacamole-common-js';

import { clipboardCharacter, ClipboardInput } from './clipboard-input';
import { HumanInputRecorder } from './human-input-recorder';

import styles from './clipboard-input.module.css';

type Point = { x: number; y: number };
type Button = 'left' | 'middle' | 'right';
type Action =
  | { kind: 'CLICK'; details: Point & { button: Button; count?: number } }
  | { kind: 'DRAG'; details: { from: Point; to: Point; button: Button } }
  | { kind: 'SCROLL'; details: Point & { deltaX: number; deltaY: number } }
  | { kind: 'KEY_INPUT'; details: { keysym: number; modifiers: string[]; keysyms?: number[] } };

export type HumanInputAction = Action & { eventId: string; occurredAt: string };

interface InputOptions {
  container: HTMLDivElement;
  client: Pick<Guacamole.Client, 'sendKeyEvent' | 'sendMouseState' | 'createClipboardStream'> & {
    getDisplay: () => Pick<Guacamole.Display, 'getElement' | 'getWidth' | 'getHeight'>;
  };
  canSend: () => boolean;
  onAction: (action: HumanInputAction) => void;
  clipboardInputEnabled?: boolean;
}

/** Own listeners and pressed state per viewer. Server cursor echoes never enter here. */
export function bindHumanInput({ container, client, canSend, onAction, clipboardInputEnabled = false }: InputOptions): () => void {
  const display = client.getDisplay();
  const element = display.getElement();
  const keyboardTarget = document.createElement('div');
  // Guacamole.Keyboard has no unlisten API. Its private detached target ensures
  // reconnects never leave anonymous handlers attached to the real desktop.
  const keyboard = new Guacamole.Keyboard(keyboardTarget);
  const keys = new Set<number>();
  const modifierKeys = new Map<number, { used: boolean; modifiers: string[] }>();
  const pressed = new Map<Button, { from: Point; dragged: boolean }>();
  let last = { x: 0, y: 0 };
  let modifiers: string[] = [];
  let wheelPixels = 0;
  const recorder = new HumanInputRecorder(onAction);
  const clipboardKeys = new Set<number>();
  let inputError: HTMLDivElement | null = null;
  const clipboard = clipboardInputEnabled ? new ClipboardInput(client, canSend, () => {
    inputError?.remove();
    inputError = document.createElement('div');
    inputError.setAttribute('role', 'alert');
    inputError.textContent = 'Не удалось вставить текст в VM. Введите его повторно.';
    inputError.className = styles.error ?? '';
    document.body.appendChild(inputError);
  }) : null;
  const sendKey = (pressed: 0 | 1, keysym: number) => {
    if (clipboard) clipboard.key(pressed, keysym, modifiers);
    else client.sendKeyEvent(pressed, keysym);
  };
  const sendMouseState = (state: Guacamole.Mouse.State) => {
    if (clipboard) clipboard.mouse(state);
    else client.sendMouseState(state);
  };

  const point = (event: MouseEvent): Point => {
    const bounds = element.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const emit = (action: Action) => {
    const event = { ...action, eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() };
    if ('DRAG' !== event.kind) recorder.record(event);
    else { recorder.flush(); onAction(event); }
  };
  const sendMouse = (scroll = 0): boolean => {
    if (!canSend() || !Number.isFinite(last.x) || !Number.isFinite(last.y)) return false;
    try {
      sendMouseState(new Guacamole.Mouse.State(
        last.x * display.getWidth(), last.y * display.getHeight(),
        pressed.has('left'), pressed.has('middle'), pressed.has('right'), scroll < 0, scroll > 0
      ));
      return true;
    } catch { return false; }
  };
  const release = () => {
    recorder.flush();
    wheelPixels = 0;
    clipboard?.reset();
    if (!clipboard) for (const key of keys) {
      try { client.sendKeyEvent(0, key); } catch { /* disconnected */ }
    }
    clipboardKeys.clear();
    keys.clear();
    for (const [keysym, state] of modifierKeys) {
      if (!state.used) emit({ kind: 'KEY_INPUT', details: { keysym, modifiers: state.modifiers } });
    }
    modifierKeys.clear();
    recorder.flush();
    if (pressed.size) {
      pressed.clear();
      try {
        sendMouseState(new Guacamole.Mouse.State(
          last.x * display.getWidth(), last.y * display.getHeight(), false, false, false, false, false
        ));
      } catch { /* disconnected */ }
    }
    keyboard.reset();
  };
  keyboard.onkeydown = (keysym) => {
    if (!canSend() || document.activeElement !== container) return true;
    try {
      inputError?.remove(); inputError = null;
      const text = clipboard && !modifiers.some(modifier => ['Ctrl', 'Alt', 'Meta'].includes(modifier))
        ? clipboardCharacter(keysym) : null;
      if (clipboard && text) { clipboard.text(text); clipboardKeys.add(keysym); }
      else sendKey(1, keysym);
      recorder.interruptClick();
      const repeat = keys.has(keysym);
      keys.add(keysym);
      // Modifier downs are transport state; the main key represents the shortcut.
      if (keysym >= 0xffe1 && keysym <= 0xffee) {
        if (!repeat) modifierKeys.set(keysym, { used: false, modifiers: [...modifiers] });
      } else {
        for (const state of modifierKeys.values()) state.used = true;
        if (modifiers.some((modifier) => ['Ctrl', 'Alt', 'Meta'].includes(modifier))) {
          if (!repeat) {
            recorder.flush();
            onAction({ kind: 'KEY_INPUT', details: { keysym, modifiers: [...modifiers] },
              eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() });
          }
        } else emit({ kind: 'KEY_INPUT', details: { keysym, modifiers: [...modifiers] } });
      }
      return false;
    } catch { return true; }
  };
  keyboard.onkeyup = (keysym) => {
    if (!keys.delete(keysym)) return;
    if (!clipboardKeys.delete(keysym)) {
      try { sendKey(0, keysym); } catch { /* disconnected */ }
    }
    const modifier = modifierKeys.get(keysym);
    if (modifier && !modifier.used) emit({ kind: 'KEY_INPUT', details: { keysym, modifiers: modifier.modifiers } });
    modifierKeys.delete(keysym);
  };
  const forwardKey = (event: KeyboardEvent) => {
    if (!canSend() || document.activeElement !== container) return;
    modifiers = [event.shiftKey && 'Shift', event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.metaKey && 'Meta']
      .filter((value): value is string => 'string' === typeof value);
    // Preserve physical Ctrl/Cmd shortcuts while the host produces Cyrillic letters.
    const shortcutLetter = clipboard && (event.ctrlKey || event.metaKey) && !event.altKey
      && /^[\u0400-\u052f]$/u.test(event.key) && /^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3) : null;
    const key = shortcutLetter ? (event.shiftKey ? shortcutLetter : shortcutLetter.toLowerCase()) : event.key;
    const forwarded = new KeyboardEvent(event.type, {
      key, code: event.code, keyCode: event.keyCode, charCode: event.charCode,
      shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
      repeat: event.repeat, cancelable: true,
    });
    keyboardTarget.dispatchEvent(forwarded);
    if (forwarded.defaultPrevented) event.preventDefault();
  };
  const input = (event: Event) => {
    if (!canSend() || document.activeElement !== container) return;
    if (event instanceof InputEvent) {
      keyboardTarget.dispatchEvent(new InputEvent('input', { data: event.data, isComposing: event.isComposing }));
    } else if (event instanceof CompositionEvent) {
      keyboardTarget.dispatchEvent(new CompositionEvent(event.type, { data: event.data }));
    }
  };
  const buttons: Button[] = ['left', 'middle', 'right'];
  const down = (event: MouseEvent) => {
    const button = buttons[event.button];
    if (!canSend() || !button) return;
    for (const state of modifierKeys.values()) state.used = true;
    container.focus();
    last = point(event);
    const bounds = element.getBoundingClientRect();
    recorder.beginClick({ ...last, button }, event.detail, { x: 4 / bounds.width, y: 4 / bounds.height });
    pressed.set(button, { from: last, dragged: false });
    if (!sendMouse()) {
      pressed.delete(button);
      recorder.flush();
    }
    event.preventDefault();
  };
  const move = (event: MouseEvent) => {
    if (!pressed.size && !container.contains(event.target as Node)) return;
    if (!canSend()) return;
    last = point(event);
    if (!sendMouse()) return;
    for (const state of pressed.values()) {
      if (Math.abs(last.x - state.from.x) * display.getWidth() > 3
        || Math.abs(last.y - state.from.y) * display.getHeight() > 3) {
        state.dragged = true;
        recorder.interruptClick();
      }
    }
  };
  const up = (event: MouseEvent) => {
    const button = buttons[event.button];
    if (!button) return;
    const state = pressed.get(button);
    if (!state) return;
    last = point(event);
    pressed.delete(button);
    if (!sendMouse()) {
      recorder.flush();
      return;
    }
    const dragged = state.dragged || Math.abs(last.x - state.from.x) * display.getWidth() > 3
      || Math.abs(last.y - state.from.y) * display.getHeight() > 3;
    emit(dragged
      ? { kind: 'DRAG', details: { from: state.from, to: last, button } }
      : { kind: 'CLICK', details: { ...last, button } });
  };
  const wheel = (event: WheelEvent) => {
    // Guacamole 1.5's mouse protocol supports vertical wheel buttons only.
    if (!canSend() || !event.deltaY) return;
    recorder.interruptClick();
    last = point(event);
    const pixels = event.deltaY * (1 === event.deltaMode ? 16 : 2 === event.deltaMode ? container.clientHeight || 600 : 1);
    if (!Number.isFinite(pixels)) return;
    wheelPixels += pixels;
    // Match wheel detents instead of mapping every trackpad pixel to a full wheel click.
    while (Math.abs(wheelPixels) >= 60) {
      const deltaY = Math.sign(wheelPixels) * 60;
      wheelPixels -= deltaY;
      if (!sendMouse(deltaY)) continue;
      sendMouse();
      emit({ kind: 'SCROLL', details: { ...last, deltaX: 0, deltaY } });
    }
    event.preventDefault();
  };
  const context = (event: Event) => { if (canSend()) event.preventDefault(); };
  container.addEventListener('keydown', forwardKey);
  container.addEventListener('keypress', forwardKey);
  container.addEventListener('keyup', forwardKey);
  container.addEventListener('input', input);
  container.addEventListener('compositionend', input);
  container.addEventListener('mousedown', down);
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  container.addEventListener('wheel', wheel, { passive: false });
  container.addEventListener('contextmenu', context);
  container.addEventListener('blur', release);
  window.addEventListener('blur', release);
  return () => {
    release();
    clipboard?.dispose();
    inputError?.remove();
    keyboard.onkeydown = null;
    keyboard.onkeyup = null;
    container.removeEventListener('keydown', forwardKey);
    container.removeEventListener('keypress', forwardKey);
    container.removeEventListener('keyup', forwardKey);
    container.removeEventListener('input', input);
    container.removeEventListener('compositionend', input);
    container.removeEventListener('mousedown', down);
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    container.removeEventListener('wheel', wheel);
    container.removeEventListener('contextmenu', context);
    container.removeEventListener('blur', release);
    window.removeEventListener('blur', release);
  };
}
