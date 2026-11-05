interface LaunchRecord<B> {
  version: 1; fingerprint: string; idempotencyKey: string; taskId: string | null; sessionRequest: B | null; sessionId: string | null;
}

export function usePendingLaunch<B = Record<string, unknown>>(storageKey: string): PendingLaunch<B> {
  const [launch] = useState(() => new PendingLaunch<B>(sessionStorage, storageKey));
  return launch;
}

/** A tab-local intent survives a lost Session response, without storing credentials. */
export class PendingLaunch<B = Record<string, unknown>> {
  private running: Promise<{ id: string }> | null = null;
  constructor(private storage: Storage, private storageKey: string) {}

  read(): LaunchRecord<B> | null {
    try {
      const value = JSON.parse(this.storage.getItem(this.storageKey) ?? 'null') as LaunchRecord<B> | null;
      return 1 === value?.version && 'string' === typeof value.idempotencyKey ? value : null;
    } catch { return null; }
  }

  clear(): void { this.storage.removeItem(this.storageKey); }

  async run(
    fingerprint: string, task: () => Promise<string>, request: (taskId: string) => B,
    session: (body: B, key: string) => Promise<{ id: string }>
  ): Promise<{ id: string }> {
    if (this.running) return this.running;
    const operation = this.launch(fingerprint, task, request, session);
    this.running = operation;
    try { return await operation; } finally { this.running = null; }
  }

  private async launch(
    fingerprint: string, task: () => Promise<string>, request: (taskId: string) => B,
    session: (body: B, key: string) => Promise<{ id: string }>
  ): Promise<{ id: string }> {
    let record = this.read();
    // Unknown Session outcome is reconciled before accepting a different intent.
    if (record?.sessionId) return { id: record.sessionId };
    if (!record || (!record.sessionRequest && record.fingerprint !== fingerprint)) {
      record = { version: 1, fingerprint, idempotencyKey: crypto.randomUUID(), taskId: null, sessionRequest: null, sessionId: null };
      this.storage.setItem(this.storageKey, JSON.stringify(record));
    }
    if (!record.taskId) {
      record.taskId = await task();
      this.storage.setItem(this.storageKey, JSON.stringify(record));
    }
    if (!record.sessionRequest) {
      record.sessionRequest = request(record.taskId);
      this.storage.setItem(this.storageKey, JSON.stringify(record));
    }
    const result = await session(record.sessionRequest, record.idempotencyKey);
    record.sessionId = result.id;
    this.storage.setItem(this.storageKey, JSON.stringify(record));
    return result;
  }
}
import { useState } from 'react';
