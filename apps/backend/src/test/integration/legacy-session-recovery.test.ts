import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { SessionRuntimeOwner } from '@/lib/session-runtime-owner.js';
import { recoverLegacySessions } from '@/modules/sessions/legacy-session-recovery.js';

import { TestDatabase, testDatabaseUrl } from './test-database.js';

const mocks = vi.hoisted(() => ({ findByName: vi.fn(), client: null as TestDatabase['client'] | null }));
vi.mock('@/lib/db/prisma.js', () => ({ get prisma() { return mocks.client; } }));
vi.mock('@/lib/config/env.js', () => ({ env: { DATABASE_URL: 'postgresql://unused' } }));
vi.mock('@/lib/vm-fleet/index.js', () => ({ vmFleetClient: { findByName: mocks.findByName } }));
vi.mock('@/lib/logger.js', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));

// Only Fleet is mocked. Prisma filtering and conditional updates run on the
// dedicated integration DB, preserving historical fields and metrics.
describe('PostgreSQL legacy session recovery', () => {
  it('finalizes absent legacy VM in all active states, retains metadata and skips terminal/race rows', async () => {
    const db = new TestDatabase();
    const owner = new SessionRuntimeOwner(() => new pg.Client({ connectionString: testDatabaseUrl() }));
    mocks.client = db.client;
    mocks.findByName.mockReset().mockResolvedValue(null);
    try {
      const rows = [];
      for (const status of ['PENDING', 'PREPARING', 'RUNNING'] as const) {
        const s = await db.client.session.create({ data: {
          mode: status === 'RUNNING' ? 'FULL_DUPLEX' : 'SOLO', status, difficulty: 1, vmName: `legacy-${status}`,
          guacId: 'historic-guac', connectArgs: 'historic-viewer',
        } });
        db.sessionIds.add(s.id);
        rows.push(s);
        await db.client.sessionMetrics.create({ data: { sessionId: s.id, participant: 'AGENT', steps: 3, clicks: 2 } });
      }
      const terminal = await db.client.session.create({ data: {
        mode: 'SOLO', status: 'COMPLETED', difficulty: 1, vmName: 'historic-terminal',
      } });
      db.sessionIds.add(terminal.id);
      const task = await db.client.task.create({ data: { title: 'Race fixture', prompt: 'Fixture prompt', difficulty: 1 } });
      db.taskIds.add(task.id);
      const race = await db.client.session.create({ data: {
        mode: 'HUMAN_VS_AGENT', status: 'RUNNING', difficulty: 1, taskId: task.id,
        creationKey: randomUUID(), creationHash: 'fixture', resolvedImageId: 'fixture-image',
      } });
      db.sessionIds.add(race.id);
      await expect(owner.start(recoverLegacySessions, vi.fn())).resolves.toBe(true);
      expect(owner.isReady()).toBe(true);
      for (const s of rows) {
        const after = await db.client.session.findUniqueOrThrow({ where: { id: s.id }, include: { metrics: true } });
        expect(after.status).toBe('FAILED');
        expect(after.vmName).toBe(s.vmName);
        expect(after.guacId).toBe(s.guacId);
        expect(after.connectArgs).toBe(s.connectArgs);
        expect(after.metrics[0]).toMatchObject({ steps: 3, clicks: 2 });
      }
      expect((await db.client.session.findUniqueOrThrow({ where: { id: terminal.id } })).status).toBe('COMPLETED');
      expect((await db.client.session.findUniqueOrThrow({ where: { id: race.id } })).status).toBe('RUNNING');
      expect(mocks.findByName).toHaveBeenCalledTimes(3);
      await recoverLegacySessions();
      expect(mocks.findByName).toHaveBeenCalledTimes(3);
    } finally { await owner.stop(); await db.cleanup(); mocks.client = null; }
  });

  it('existing unknown owner blocks without a write, and later confirmed absence recovers', async () => {
    const db = new TestDatabase();
    const owner = new SessionRuntimeOwner(() => new pg.Client({ connectionString: testDatabaseUrl() }));
    mocks.client = db.client;
    mocks.findByName.mockReset().mockResolvedValue({ id: 'unproven', name: 'legacy-existing' });
    try {
      const s = await db.client.session.create({ data: {
        mode: 'FULL_DUPLEX', status: 'RUNNING', difficulty: 1, vmName: 'legacy-existing',
      } });
      db.sessionIds.add(s.id);
      await expect(owner.start(recoverLegacySessions, vi.fn())).rejects.toThrow('LEGACY_VM_IDENTITY_UNKNOWN');
      expect(owner.isReady()).toBe(false);
      expect((await db.client.session.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('RUNNING');
      expect(await db.client.activeVmClaim.count({ where: { sessionId: s.id } })).toBe(0);
      mocks.findByName.mockResolvedValue(null);
      await expect(owner.start(recoverLegacySessions, vi.fn())).resolves.toBe(true);
      expect(owner.isReady()).toBe(true);
      expect((await db.client.session.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('FAILED');
    } finally { await owner.stop(); await db.cleanup(); mocks.client = null; }
  });
});
