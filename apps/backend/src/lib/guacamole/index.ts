import { env } from '@/lib/config/env.js';

import { GuacamoleClient } from './guacamole.client.js';

export { GuacamoleClient } from './guacamole.client.js';
export { GUAC_DEFAULTS } from './guacamole.constants.js';
export type { GuacSharingParams } from './guacamole.client.js';

export const guacamoleClient = new GuacamoleClient(
  env.GUACAMOLE_URL,
  env.GUACAMOLE_ADMIN_USERNAME,
  env.GUACAMOLE_ADMIN_PASSWORD
);
