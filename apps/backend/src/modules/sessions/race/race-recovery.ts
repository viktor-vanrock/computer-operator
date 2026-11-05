import { raceCoordinator } from './race-coordinator.js';
import { raceStateRepository } from './race-state.repository.js';

export async function recoverRaces(): Promise<void> {
  const states = await raceStateRepository.db.session.findMany({ where: { mode: 'HUMAN_VS_AGENT' }, select: { id: true, status: true, race: { select: { finishedAt: true } } } });
  for (const state of states) {
    if (!state.race?.finishedAt) await raceStateRepository.finalize(state.id, 'BACKEND_RESTART');
    await raceCoordinator.cleanup(state.id);
  }
}

export async function recoverRacesCleanup(): Promise<void> {
  const unfinished = await raceStateRepository.db.sessionRace.findMany({
    where: { finishedAt: { not: null }, cleanupStatus: { in: ['PENDING', 'FAILED'] } }, select: { sessionId: true },
  });
  await Promise.allSettled(unfinished.map((race) => raceCoordinator.cleanup(race.sessionId)));
}
