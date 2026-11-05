import { useEffect, useReducer, useRef } from 'react';

import { AGENT_ACTIONS, AGENT_TOTAL, INITIAL_STATE } from './arena-preview.constants';
import type { ArenaAction, ArenaState } from './arena-preview.types';

function reducer(state: ArenaState, action: ArenaAction): ArenaState {
  switch (action.type) {
    case 'TICK': {
      const nextElapsed = state.elapsed + 1;
      const nextActionIdx = 0 === nextElapsed % 7
        ? (state.agentActionIdx + 1) % AGENT_ACTIONS.length
        : state.agentActionIdx;
      return { ...state, elapsed: nextElapsed, agentActionIdx: nextActionIdx };
    }
    case 'AGENT_WINS':
      return { ...state, phase: 'agent_wins' };
    case 'RESTART':
      return {
        ...INITIAL_STATE,
        cycleKey: state.cycleKey + 1,
      };
    default:
      return state;
  }
}

export function useArenaPreview(): ArenaState {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAll = () => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
  };

  useEffect(() => {
    clearAll();
    if ('running' === state.phase) {
      tickerRef.current = setInterval(() => dispatch({ type: 'TICK' }), 1000);
    } else if ('agent_wins' === state.phase) {
      phaseTimerRef.current = setTimeout(() => dispatch({ type: 'RESTART' }), 2500);
    }
    return clearAll;
  }, [state.phase]);

  useEffect(() => {
    if ('running' !== state.phase) return;

    if (state.elapsed >= AGENT_TOTAL) {
      dispatch({ type: 'AGENT_WINS' });
    }
  }, [state.elapsed, state.phase]);

  return state;
}
