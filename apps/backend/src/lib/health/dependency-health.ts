import { agentManager, fullDuplexAgentManager } from '@/lib/agent/agent-manager.client.js';
import { prisma } from '@/lib/db/prisma.js';
import { guacamoleClient } from '@/lib/guacamole/index.js';
import { logger } from '@/lib/logger.js';
import { vmFleetClient } from '@/lib/vm-fleet/index.js';
import { moderationService } from '@/modules/moderation/moderation.service.js';

const log = logger.child({ module: 'dependency-health' });
const HEALTH_INTERVAL_MS = 15_000;

export type DependencyName =
  'database' | 'vmFleet' | 'guacamole' | 'agentManager' | 'fullDuplexAgentManager';
export type DependencyState = Record<DependencyName, boolean>;

let state: DependencyState = {
  database: false,
  vmFleet: false,
  guacamole: false,
  agentManager: false,
  fullDuplexAgentManager: false,
};
let timer: ReturnType<typeof setInterval> | undefined;
let checkInProgress: Promise<DependencyState> | null = null;

async function resolves(operation: () => Promise<void | boolean>): Promise<boolean> {
  try {
    const result = await operation();
    return result !== false;
  } catch {
    return false;
  }
}

export async function checkDependencies(): Promise<DependencyState> {
  if (checkInProgress) return checkInProgress;
  checkInProgress = (async () => {
    const previousState = { ...state };
    const [database, vmFleet, guacamole, agent, fullDuplex] = await Promise.all([
      resolves(async () => { await prisma.$queryRaw`SELECT 1`; }),
      resolves(() => vmFleetClient.checkHealth()),
      resolves(() => guacamoleClient.checkHealth()),
      resolves(() => agentManager.isHealthy()),
      resolves(() => fullDuplexAgentManager.isHealthy()),
    ]);
    state = {
      database,
      vmFleet,
      guacamole,
      agentManager: agent,
      fullDuplexAgentManager: fullDuplex,
    };
    if (!sameState(previousState, state)) {
      const level = Object.values(state).every(Boolean) ? 'info' : 'warn';
      log[level]({ dependencies: state }, 'dependency readiness changed');
    }
    return state;
  })();
  try {
    return await checkInProgress;
  } finally {
    checkInProgress = null;
  }
}

function sameState(left: DependencyState, right: DependencyState): boolean {
  return Object.keys(left).every((name) => left[name as DependencyName] === right[name as DependencyName]);
}

export function getDependencyState(): DependencyState {
  return { ...state };
}

export async function startDependencyMonitoring(): Promise<void> {
  const gigachat = await moderationService.checkHealth();
  const level = gigachat ? 'info' : 'warn';
  log[level]({ gigachat }, 'GigaChat startup check completed');

  await checkDependencies();
  timer = setInterval(() => { void checkDependencies(); }, HEALTH_INTERVAL_MS);
  timer.unref();
}

export function stopDependencyMonitoring(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
