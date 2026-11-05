import pino from 'pino';

import { env, isDev } from '@/lib/config/env.js';

/**
 * Pino-синглтон — единая точка логгирования для всего приложения.
 * В dev-режиме форматирует вывод через pino-pretty с читаемой датой.
 * В production — чистый JSON.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss dd.mm.yyyy',
        ignore: 'pid,hostname',
        singleLine: true,
      },
    },
  }),
});
