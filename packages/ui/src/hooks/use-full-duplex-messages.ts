import { useCallback, useState } from 'react';

import { formatTime } from '../lib/time';
import type { ActionType, ChatMessage } from '../types/chat.types';
import type { WsEvent } from '../types/websocket.types';

const OUTCOME_LABELS: Record<string, string> = {
  'finished:positive': 'Готово',
  'finished:negative': 'Задача не выполнима',
  'aborted:user': 'Отменено',
  'aborted:env': 'Прервано окружением',
};

/**
 * Локальный стейт непрерывного Full Duplex-диалога: AGENT_STEP/AGENT_OUTCOME/AGENT_ERROR
 * не гейтятся статусом "задача завершена" — в отличие от use-agent-thoughts (SOLO),
 * поле ввода в Full Duplex остаётся открытым всегда.
 */
export function useFullDuplexMessages() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const addUserMessage = useCallback((text: string) => {
    setMessages((prev) => [...prev, { kind: 'user', id: crypto.randomUUID(), text, receivedAt: formatTime(new Date()) }]);
  }, []);

  const addSystemMessage = useCallback((text: string) => {
    setMessages((prev) => [...prev, { kind: 'system', id: crypto.randomUUID(), text, receivedAt: formatTime(new Date()) }]);
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
  }, []);

  const handleWsEvent = useCallback((event: WsEvent) => {
    if ('AGENT_STEP' === event.type) {
      const text = event.payload.thought || [event.payload.think, event.payload.speak, event.payload.reflection]
        .filter((part, index, all) => part.trim() && all.indexOf(part) === index).join('\n') || event.payload.act.name;
      if (!text) return;
      setMessages((prev) => [...prev, {
        kind: 'agent', id: crypto.randomUUID(), thought: text,
        actionType: (event.payload.act.name || event.payload.action_type || 'wait') as ActionType,
        actionInputs: event.payload.act.arguments,
        details: { reflection: event.payload.reflection, think: event.payload.think, speak: event.payload.speak,
          act: event.payload.act, ...(event.payload.raw ? { raw: event.payload.raw } : {}) },
        receivedAt: formatTime(new Date()),
      }]);
      return;
    }

    if ('AGENT_OUTCOME' === event.type) {
      const { kind, value, speak } = event.payload;
      const text = speak || OUTCOME_LABELS[`${kind}:${value}`] || 'Задача завершена';
      setMessages((prev) => [...prev, { kind: 'outcome', id: crypto.randomUUID(), text, value, receivedAt: formatTime(new Date()) }]);
      return;
    }

    if ('AGENT_ERROR' === event.type && !event.payload.fatal) {
      setMessages((prev) => [...prev, {
        kind: 'system', id: crypto.randomUUID(),
        text: `Пропущен кадр: ${event.payload.message}`,
        receivedAt: formatTime(new Date()),
      }]);
    }
  }, []);

  return { messages, addUserMessage, addSystemMessage, reset, handleWsEvent };
}
