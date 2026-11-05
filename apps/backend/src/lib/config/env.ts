/**
 * Валидация окружения при старте сервера.
 */
import 'dotenv/config';
import { z } from 'zod';

const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === 'https:', {
  message: 'URL must use https://',
}).transform((value) => value.replace(/\/+$/, ''));

const EnvSchema = z.object({
  DATABASE_URL:                z.string().min(1),
  PORT:                        z.coerce.number().int().positive(),
  NODE_ENV:                    z.enum(['development', 'production', 'test']),
  AGENT_MANAGER_API_URL:       z.string().min(1),
  AGENT_MANAGER_USERNAME:      z.string().min(1),
  AGENT_MANAGER_PASSWORD:      z.string().min(1),
  VMFLEET_URL:                 z.string().url(),
  VMFLEET_TOKEN:               z.string().min(1),
  DEFAULT_IMAGE_ID:       z.string().trim().min(1).default('8b2a638d-cdac-479e-9152-5d00b3164707'),
  FULL_DUPLEX_API_URL:         z.string().min(1),
  FULL_DUPLEX_USERNAME:        z.string().min(1),
  FULL_DUPLEX_PASSWORD:        z.string().min(1),
  VMFLEET_PROFILE:             z.string().trim().min(1).default('reserved_vm'),
  LOG_LEVEL:                   z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional().default('info'),
  METRICS_TOKEN:               z.string().optional(),
  GUACAMOLE_URL:               z.string().min(1),
  GUACAMOLE_ADMIN_USERNAME:    z.string().min(1),
  GUACAMOLE_ADMIN_PASSWORD:    z.string().min(1),
  GUAC_HEARTBEAT_INTERVAL_MS:  z.coerce.number().int().positive().optional().default(5 * 60 * 1000),
  // Keycloak / Auth
  KEYCLOAK_URL:                z.string().url(),
  KEYCLOAK_REALM:              z.string().min(1),
  KEYCLOAK_CLIENT_ID:          z.string().min(1),
  KEYCLOAK_CLIENT_SECRET:      z.string().min(1),
  SESSION_SECRET:              z.string().min(32),
  FRONTEND_TECH_URL:           z.string().url(),
  BACKEND_URL:                 z.string().url().optional(),
  GIGACHAT_AUTHORIZATION_KEY: z.string().trim().min(1),
  GIGACHAT_SCOPE:             z.string().trim().min(1).default('GIGACHAT_API_CORP'),
  GIGACHAT_AUTH_URL:          httpsUrl.default('https://ngw.devices.sberbank.ru:9443/api/v2/oauth'),
  GIGACHAT_API_URL:           httpsUrl.default('https://gigachat.devices.sberbank.ru/api/v1'),
  GIGACHAT_MODEL:             z.string().trim().min(1).default('GigaChat-2'),
  GIGACHAT_TIMEOUT_MS:        z.coerce.number().int().positive().max(30_000).default(5_000),
  FREEFORM_TASK_MAX_LENGTH:   z.coerce.number().int().positive().max(20_000).default(4_000),
  TASK_VALIDATION_SECRET:     z.string().min(32),
  TASK_VALIDATION_TTL_MS:     z.coerce.number().int().positive().max(60 * 60_000).default(2 * 60_000),
}).refine(
  (data) => data.NODE_ENV !== 'production' || Boolean(data.BACKEND_URL),
  { message: 'BACKEND_URL is required in production', path: ['BACKEND_URL'] }
);

function parseEnv() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    // console.error допустим здесь: логгер ещё не инициализирован на этом этапе
    console.error('❌ Invalid environment variables:');
    for (const issue of result.error.issues) {
      console.error(`${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
export const isDev = env.NODE_ENV === 'development';
