import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const backendDir = fileURLToPath(new URL('../../../', import.meta.url));

/** Never load runtime .env or fall back to DATABASE_URL in this runner. */
export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env['TEST_DATABASE_URL'];
  if (!value) throw new Error('TEST_DATABASE_URL is required; runtime DATABASE_URL is never used');
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    || !/^\/[a-z0-9_]+_test$/.test(target.pathname)
    || (target.searchParams.has('schema') && target.searchParams.get('schema') !== 'public')) {
    throw new Error('Integration tests require a local dedicated database named *_test with public schema');
  }
  if (env['DATABASE_URL']) {
    let runtime: URL;
    try {
      runtime = new URL(env['DATABASE_URL']);
    } catch {
      throw new Error('Cannot establish isolation from runtime DATABASE_URL');
    }
    const localNames = new Set(['localhost', '127.0.0.1', '[::1]']);
    const sameHost = runtime.hostname === target.hostname
      || (localNames.has(runtime.hostname) && localNames.has(target.hostname));
    if (sameHost && (runtime.port || '5432') === (target.port || '5432')
      && runtime.pathname === target.pathname) {
      throw new Error('TEST_DATABASE_URL must point to a different database from runtime DATABASE_URL');
    }
  }
  return value;
}

export function createTestClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
}

export async function createTestConnection(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  return client;
}

/** Track only data created by the current test; no TRUNCATE or database reset. */
export class TestDatabase {
  readonly client = createTestClient();
  readonly sessionIds = new Set<string>();
  readonly taskIds = new Set<string>();

  async cleanup(): Promise<void> {
    try {
      await this.client.$transaction(async (tx) => {
        const sessions = [...this.sessionIds];
        const claims = await tx.activeVmClaim.count({ where: { sessionId: { in: sessions } } });
        if (claims) throw new Error('Fixture cleanup cannot delete sessions that still own VM claims');
        await tx.vmAcquisitionAttempt.deleteMany({ where: { sessionId: { in: sessions } } });
        await tx.session.deleteMany({ where: { id: { in: [...this.sessionIds] } } });
        await tx.task.deleteMany({ where: { id: { in: [...this.taskIds] } } });
      });
    } finally {
      await this.client.$disconnect();
    }
  }
}

export async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  const client = await createTestConnection();
  try {
    const result = await client.query<{ name: string }>('SELECT current_database() AS name');
    if (result.rows[0]?.name !== new URL(url).pathname.slice(1)) {
      throw new Error('Connected database does not match TEST_DATABASE_URL');
    }
  } finally {
    await client.end();
  }
  await run(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
}
