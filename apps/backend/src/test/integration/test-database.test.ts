import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { SessionRuntimeOwner } from '@/lib/session-runtime-owner.js';
import { createTestConnection, TestDatabase, testDatabaseUrl } from './test-database.js';

vi.mock('@/lib/config/env.js', () => ({ env: { DATABASE_URL: 'postgresql://unused' } }));

describe('isolated PostgreSQL runner', () => {
  it('rejects missing URL, runtime alias and non-test databases before any mutation', () => {
    expect(() => testDatabaseUrl({ DATABASE_URL: 'postgresql://localhost/runtime' })).toThrow('required');
    expect(() => testDatabaseUrl({ TEST_DATABASE_URL: 'postgresql://localhost/runtime' })).toThrow('dedicated');
    expect(() => testDatabaseUrl({ TEST_DATABASE_URL: 'postgresql://example.com/arena_test' })).toThrow('local');
    expect(() => testDatabaseUrl({
      TEST_DATABASE_URL: 'postgresql://localhost:5432/arena_test',
      DATABASE_URL: 'postgresql://127.0.0.1/arena_test',
    })).toThrow('different');
  });

  it('opens independent connections and cleans up only its own fixture', async () => {
    const first = await createTestConnection();
    const second = await createTestConnection();
    const db = new TestDatabase();
    const taskId = randomUUID();
    db.taskIds.add(taskId);
    try {
      const a = await first.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const b = await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      expect(a.rows[0]?.pid).not.toBe(b.rows[0]?.pid);
      await db.client.task.create({ data: { id: taskId, title: 'Integration fixture', prompt: 'Test', difficulty: 1 } });
      const visible = await second.query('SELECT id FROM "Task" WHERE id = $1', [taskId]);
      expect(visible.rowCount).toBe(1);
      await db.cleanup();
      const removed = await first.query('SELECT id FROM "Task" WHERE id = $1', [taskId]);
      expect(removed.rowCount).toBe(0);
    } finally {
      await db.cleanup();
      await Promise.all([first.end(), second.end()]);
    }
  });

  it('enforces global VM ownership under competing independent PostgreSQL connections', async () => {
    const db = new TestDatabase();
    const first = await createTestConnection();
    const second = await createTestConnection();
    const sessionIds = [randomUUID(), randomUUID()];
    const vmId = randomUUID();
    const vmName = `fixture-${vmId}`;
    for (const id of sessionIds) {
      db.sessionIds.add(id);
      await db.client.session.create({ data: { id, difficulty: 1 } });
    }
    try {
      const insert = 'INSERT INTO "ActiveVmClaim" ("vmName", "vmId", "sessionId", participant) VALUES ($1, $2, $3, $4::"Participant")';
      const results = await Promise.allSettled([
        first.query(insert, [vmName, vmId, sessionIds[0], 'HUMAN']),
        second.query(insert, [vmName, vmId, sessionIds[1], 'AGENT']),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected).toMatchObject({ reason: { code: '23505' } });
      const rows = await first.query('SELECT "sessionId", "vmId" FROM "ActiveVmClaim" WHERE "vmName" = $1', [vmName]);
      expect(rows.rowCount).toBe(1);
      // A foreign session cannot delete this claim; name reuse with a new id also cannot remove it.
      const owner = rows.rows[0].sessionId;
      const other = sessionIds.find((id) => id !== owner);
      const deleted = await second.query('DELETE FROM "ActiveVmClaim" WHERE "vmName" = $1 AND "sessionId" = $2', [vmName, other]);
      expect(deleted.rowCount).toBe(0);
      const reused = await first.query('DELETE FROM "ActiveVmClaim" WHERE "vmName" = $1 AND "vmId" = $2', [vmName, randomUUID()]);
      expect(reused.rowCount).toBe(0);
    } finally {
      await db.client.activeVmClaim.deleteMany({ where: { vmId } });
      await db.cleanup();
      await Promise.all([first.end(), second.end()]);
    }
  });

  it('holds the owner lock on its dedicated connection and permits handoff after shutdown', async () => {
    const factory = () => new pg.Client({ connectionString: testDatabaseUrl() });
    const first = new SessionRuntimeOwner(factory);
    const second = new SessionRuntimeOwner(factory);
    let recovered = 0;
    try {
      await expect(first.start(async () => { recovered += 1; }, () => {})).resolves.toBe(true);
      await expect(second.start(async () => { recovered += 1; }, () => {})).resolves.toBe(false);
      expect(recovered).toBe(1);
      await first.stop();
      await expect(second.start(async () => { recovered += 1; }, () => {})).resolves.toBe(true);
      expect(recovered).toBe(2);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });
});
