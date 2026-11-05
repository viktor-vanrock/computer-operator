import { PrismaClient } from '@prisma/client';
import { env } from '@/lib/config/env.js';

// Fix the pool size explicitly so the keepalive below can reliably cover
// every physical connection — Prisma's default (num_cpus * 2 + 1) is
// otherwise unpredictable and a single keepalive query only touches one
// connection out of the pool, leaving the rest to hit the DB idle timeout.
const CONNECTION_LIMIT = 3;

function withConnectionLimit(url: string): string {
  const withParams = new URL(url);
  if (!withParams.searchParams.has('connection_limit')) {
    withParams.searchParams.set('connection_limit', String(CONNECTION_LIMIT));
  }
  return withParams.toString();
}

export const prisma = new PrismaClient({
  datasourceUrl: withConnectionLimit(env.DATABASE_URL),
  log: env.NODE_ENV === 'development' ? ['info', 'warn', 'error'] : ['warn', 'error'],
});

// Keep every pooled connection alive to prevent PostgreSQL from terminating
// idle sessions. Firing CONNECTION_LIMIT queries concurrently ensures each
// physical connection in the pool gets exercised, not just one of them.
const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;
let keepaliveTimer: ReturnType<typeof setInterval> | undefined;

export function startKeepalive(): void {
  keepaliveTimer = setInterval(() => {
    const pings = Array.from({ length: CONNECTION_LIMIT }, () =>
      prisma.$queryRaw`SELECT 1`.catch(() => {
        // Prisma reconnects automatically on the next real query
      })
    );
    void Promise.all(pings);
  }, KEEPALIVE_INTERVAL_MS);
  keepaliveTimer.unref();
}

export function stopKeepalive(): void {
  if (keepaliveTimer !== undefined) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = undefined;
  }
}
