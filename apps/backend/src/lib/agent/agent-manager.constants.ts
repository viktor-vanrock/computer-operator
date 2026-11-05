export const REQUEST_TIMEOUT_MS = 60 * 1000;

// Время ожидания, после которого full-duplex-соединение закрывается принудительно,
export const FULL_DUPLEX_TIMEOUT_MS = 10 * 1000;

// ─── SOLO v1 (протокол агент-менеджера ws://<service>/v1/) ────────────────────

// Клиент обязан слать IMALIVE не реже этого интервала, иначе сервер считает
// соединение мёртвым и закрывает сокет с критической ошибкой.
export const AGENT_MANAGER_V1_HEARTBEAT_INTERVAL_MS = 30 * 1000;

// Если от сервера (любое сообщение — STEP/DIAGNOSTICS/IMALIVE) не пришло ничего
// дольше этого порога — считаем сессию мёртвой и разрываем сокет сами.
// Таймаут остаётся 120 секунд независимо от частоты исходящих IMALIVE.
export const AGENT_MANAGER_V1_HEARTBEAT_TIMEOUT_MS = 120 * 1000;

// Базовый профиль для существующих клиентов без явного выбора модели.
export const AGENT_MANAGER_V1_PROFILE_DEFAULT = 'default';

export const AGENT_MANAGER_V1_WS_PATH = '/v1/';
export const AGENT_MANAGER_V1_HEALTH_PATH = '/health';

// Время ожидания принудительного закрытия сокета после отправки CLOSE_SESSION,
// если сервер сам не закроет соединение (аналог FULL_DUPLEX_TIMEOUT_MS).
export const AGENT_MANAGER_V1_CLOSE_TIMEOUT_MS = 10 * 1000;
