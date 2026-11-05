import { bindHumanInput } from '@arena/ui/arena-player/human-input';
import Guacamole from 'guacamole-common-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

function setup(clipboardInputEnabled = true) {
  vi.useFakeTimers();
  const packets: Array<string | number[]> = [];
  const container = document.createElement('div'); container.tabIndex = 0;
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1920, 1080));
  document.body.appendChild(container); container.focus();
  const client = {
    getDisplay: () => ({ getElement: () => container, getWidth: () => 1920, getHeight: () => 1080 }),
    sendKeyEvent: vi.fn((pressed: number, key: number) => { packets.push([pressed, key]); }),
    sendMouseState: vi.fn(() => { packets.push('mouse'); }),
    createClipboardStream: vi.fn(() => {
      packets.push('clipboard');
      const stream: Guacamole.OutputStream = {
        index: 0, onack: null,
        sendBlob: data => { packets.push(new TextDecoder().decode(Uint8Array.from(atob(data), c => c.charCodeAt(0)))); },
        sendEnd: () => { packets.push('end'); },
      };
      return stream;
    }),
  };
  const onAction = vi.fn();
  const dispose = bindHumanInput({ container, client, canSend: () => true, onAction, clipboardInputEnabled });
  const type = (key: string, code = 'KeyA', keyCode = 65, shiftKey = false) => {
    for (const type of ['keydown', 'keypress', 'keyup']) container.dispatchEvent(new KeyboardEvent(type, {
      key, code, shiftKey, keyCode: 'keypress' === type ? key.charCodeAt(0) : keyCode,
      charCode: 'keypress' === type ? key.charCodeAt(0) : 0, bubbles: true, cancelable: true,
    }));
  };
  return { packets, container, dispose, type, onAction, client };
}

describe('seamless Cyrillic clipboard input', () => {
  it('batches Russian text without emitting its keysyms and keeps later English input after paste', () => {
    const h = setup();
    h.type('а'); h.type('ё', 'Backquote', 192); h.type('a');
    vi.advanceTimersByTime(1000);
    expect(h.packets).toEqual(['clipboard', 'аё', 'end', [1, 0xffe3], [1, 0x76], [0, 0x76], [0, 0xffe3], [1, 97], [0, 97]]);
    h.dispose();
  });

  it('sends English immediately and preserves the default direct Cyrillic transport outside the experiment', () => {
    const h = setup(false);
    h.type('a'); h.type('ё', 'Backquote', 192);
    expect(h.packets).toEqual([[1, 97], [0, 97], [1, 16778321], [0, 16778321]]);
    h.dispose();
  });

  it('serializes two clipboard batches and keeps Backspace and clicks after the last paste', () => {
    const h = setup(); h.type('а');
    vi.advanceTimersByTime(60);
    h.type('б', 'Comma', 188); h.type('Backspace', 'Backspace', 8);
    h.container.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    h.container.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    vi.advanceTimersByTime(1000);
    expect(h.packets).toEqual([
      'clipboard', 'а', 'end', [1, 65507], [1, 118], [0, 118], [0, 65507],
      'clipboard', 'б', 'end', [1, 65507], [1, 118], [0, 118], [0, 65507],
      [1, 65288], [0, 65288], 'mouse', 'mouse',
    ]);
    h.dispose();
  });

  it('temporarily releases Shift for paste and restores it until the real keyup', () => {
    const h = setup();
    h.container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', keyCode: 16, shiftKey: true }));
    for (const type of ['keydown', 'keypress', 'keyup']) h.container.dispatchEvent(new KeyboardEvent(type, {
      key: 'Ё', code: 'Backquote', shiftKey: true, keyCode: 'keypress' === type ? 1025 : 192,
      charCode: 'keypress' === type ? 1025 : 0, cancelable: true,
    }));
    vi.advanceTimersByTime(1000);
    h.container.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', keyCode: 16 }));
    expect(h.packets).toEqual([[1, 65505], 'clipboard', 'Ё', 'end', [0, 65505],
      [1, 65507], [1, 118], [0, 118], [0, 65507], [1, 65505], [0, 65505]]);
    h.dispose();
  });

  it('does not convert Ctrl shortcuts to clipboard text', () => {
    const h = setup();
    h.container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', keyCode: 17, ctrlKey: true }));
    h.container.dispatchEvent(new KeyboardEvent('keydown', { key: 'с', code: 'KeyC', keyCode: 67, ctrlKey: true }));
    h.container.dispatchEvent(new KeyboardEvent('keyup', { key: 'с', code: 'KeyC', keyCode: 67, ctrlKey: true }));
    h.container.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', keyCode: 17 }));
    expect(h.client.createClipboardStream).not.toHaveBeenCalled();
    expect(h.packets).toContainEqual([1, 99]);
    h.dispose();
  });

  it.each(['blur', 'dispose'])('cancels a delayed paste and queued keys on %s', action => {
    const h = setup(); h.type('а'); vi.advanceTimersByTime(60); h.type('a');
    if ('blur' === action) h.container.dispatchEvent(new FocusEvent('blur'));
    else h.dispose();
    vi.advanceTimersByTime(1000);
    expect(h.packets).toEqual(['clipboard', 'а', 'end']);
    h.dispose();
  });

  it('reports clipboard rejection and cancels the queued paste', () => {
    const h = setup(); h.type('а'); vi.advanceTimersByTime(60);
    const stream = h.client.createClipboardStream.mock.results[0]!.value;
    stream.onack?.(new Guacamole.Status(0x0100, 'Rejected'));
    vi.advanceTimersByTime(1000);
    expect(h.packets).toEqual(['clipboard', 'а', 'end']);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Не удалось вставить');
    h.dispose();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('releases a mouse button already sent when blur cancels its queued release', () => {
    const h = setup();
    h.container.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    h.type('а'); vi.advanceTimersByTime(60);
    h.container.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    h.container.dispatchEvent(new FocusEvent('blur'));
    vi.advanceTimersByTime(1000);
    expect(h.packets).toEqual(['mouse', 'clipboard', 'а', 'end', 'mouse']);
    h.dispose();
  });

  it('routes Russian numero sign through clipboard', () => {
    const h = setup(); h.type('№', 'Digit3', 51);
    vi.advanceTimersByTime(1000);
    expect(h.packets).toEqual(['clipboard', '№', 'end', [1, 65507], [1, 118], [0, 118], [0, 65507]]);
    h.dispose();
  });

  it('recovers a still-held Shift after a rejected clipboard stream', () => {
    const h = setup();
    h.container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', keyCode: 16, shiftKey: true }));
    h.type('Ё', 'Backquote', 192, true); vi.advanceTimersByTime(60);
    h.client.createClipboardStream.mock.results[0]!.value.onack?.(new Guacamole.Status(0x0100, 'Rejected'));
    h.packets.length = 0;
    h.container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', keyCode: 37, shiftKey: true }));
    expect(h.packets).toEqual([[1, 65505], [1, 65361]]);
    h.dispose();
  });
});
