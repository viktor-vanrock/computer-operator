import { useCallback, useRef, useState } from 'react';

import { resolveOutcomeMessageFields } from '../lib/agent-thought';
import { formatTime } from '../lib/time';
import type { ChatMessage } from '../types/chat.types';
import type { WsEvent } from '../types/websocket.types';

/**
 * Локальный стейт мыслей агента для SOLO-сценария.
 */
export function useAgentThoughts() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTaskDone, setIsTaskDone] = useState(false);
  const finishedRef = useRef(false);

  const addUserMessage = useCallback((text: string) => {
    setMessages((prev) => [...prev, { kind: 'user', id: crypto.randomUUID(), text, receivedAt: formatTime(new Date()) }]);
  }, []);

  const addSystemMessage = useCallback((text: string) => {
    setMessages((prev) => [...prev, { kind: 'system', id: crypto.randomUUID(), text, receivedAt: formatTime(new Date()) }]);
  }, []);

  const markTaskDone = useCallback((done: boolean) => {
    if (!done) finishedRef.current = false;
    setIsTaskDone(done);
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    setIsTaskDone(false);
    finishedRef.current = false;
  }, []);

  const handleWsEvent = useCallback((event: WsEvent) => {
    if ('AGENT_ERROR' === event.type) {
      setMessages((prev) => [...prev, {
        kind: 'system', id: crypto.randomUUID(), text: event.payload.message, receivedAt: formatTime(new Date()),
      }]);
      return;
    }

    if ('AGENT_OUTCOME' === event.type) {
      if (!finishedRef.current) {
        const fields = resolveOutcomeMessageFields(event.payload);
        setMessages((prev) => [...prev, { kind: 'agent', id: crypto.randomUUID(), ...fields, receivedAt: formatTime(new Date()) }]);
      }
      finishedRef.current = true;
      setIsTaskDone(true);
      return;
    }

    if ('AGENT_THOUGHT' !== event.type) return;

    const thought = event.payload.thought ?? event.payload.text;
    if (!thought) return;

    setMessages((prev) => [...prev, {
      kind: 'agent', id: crypto.randomUUID(), thought,
      ...(event.payload.action_type && { actionType: event.payload.action_type }),
      ...(event.payload.action_inputs && { actionInputs: event.payload.action_inputs }),
      receivedAt: formatTime(new Date()),
    }]);
  }, []);

  return { messages, isTaskDone, addUserMessage, addSystemMessage, markTaskDone, reset, handleWsEvent };
}
