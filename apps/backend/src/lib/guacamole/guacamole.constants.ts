export const GUAC_DEFAULTS = {
  WIDTH: 1920,
  HEIGHT: 1080,
  DPI: 96,
  TIMEZONE: 'Europe/Moscow',
  TYPE: 'c',
  AUDIO: ['audio/L8', 'audio/L16'],
  IMAGE: ['image/jpeg', 'image/png', 'image/webp'],
  DATA_SOURCE: 'mysql',
  SHARING_DATA_SOURCE: 'mysql-shared',
} as const;
