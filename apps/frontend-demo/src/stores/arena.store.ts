import type { SessionMetrics, SessionStatus } from '@arena/ui/types/session.types';
import { create } from 'zustand';

interface ArenaState {
  status: SessionStatus
  connectArgs: string | null
  elapsedSeconds: number
  metrics: SessionMetrics | null
  // Actions
  setStatus: (status: SessionStatus) => void
  setConnectArgs: (args: string) => void
  setElapsedSeconds: (seconds: number) => void
  updateMetrics: (metrics: SessionMetrics) => void
  reset: () => void
}

const initialState = {
  status: 'PENDING' as SessionStatus,
  connectArgs: null,
  elapsedSeconds: 0,
  metrics: null,
};

export const useArenaStore = create<ArenaState>((set) => ({
  ...initialState,

  setStatus: (status) => set({ status }),
  setConnectArgs: (connectArgs) => set({ connectArgs }),
  setElapsedSeconds: (elapsedSeconds) => set({ elapsedSeconds }),
  updateMetrics: (metrics) => set({ metrics }),
  reset: () => set(initialState),
}));
