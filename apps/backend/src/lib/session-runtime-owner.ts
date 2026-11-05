import pg from 'pg';
import { env } from '@/lib/config/env.js';
import { ServiceUnavailableException } from '@/lib/http/errors.js';

interface OwnerConnection {
  connect: () => Promise<unknown>;
  query: (sql: string) => Promise<{ rows: Array<{ acquired?: boolean }> }>;
  end: () => Promise<void>;
  on: (event: 'error' | 'end', listener: () => void) => unknown;
}

export class SessionRuntimeOwner {
  private connection: OwnerConnection | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ready = false;
  private stopping = false;
  private onLost: () => void = () => {};

  constructor(private readonly makeConnection: () => OwnerConnection) {}

  isReady(): boolean { return this.ready; }

  suspend(): void { this.ready = false; this.stopping = true; }

  requireReady(): void {
    if (!this.ready) throw new ServiceUnavailableException('Session runtime owner is not ready', 'RUNTIME_OWNER_UNAVAILABLE');
  }

  async start(recover: () => Promise<void>, onLost: () => void): Promise<boolean> {
    if (this.connection) return this.ready;
    this.stopping = false;
    this.onLost = onLost;
    const connection = this.makeConnection();
    this.connection = connection;
    const lose = () => {
      if (this.connection !== connection || this.stopping) return;
      const wasReady = this.ready;
      this.ready = false;
      if (wasReady) this.onLost();
      void this.stop();
    };
    connection.on('error', lose);
    connection.on('end', lose);
    try {
      await connection.connect();
      const result = await connection.query('SELECT pg_try_advisory_lock(1397048147, 1) AS acquired');
      if (!result.rows[0]?.acquired) {
        await this.stop();
        return false;
      }
      await recover();
      if (this.connection !== connection || this.stopping) return false;
      await connection.query('SELECT 1');
      this.ready = true;
      this.timer = setInterval(() => { void connection.query('SELECT 1').catch(lose); }, 5000);
      this.timer.unref();
      return true;
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.ready = false;
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const connection = this.connection;
    this.connection = null;
    // Closing the dedicated connection releases the session advisory lock.
    await connection?.end().catch(() => {});
  }
}

export const sessionRuntimeOwner = new SessionRuntimeOwner(() => new pg.Client({
  connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 5000,
}));
