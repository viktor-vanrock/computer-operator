import { env } from '@/lib/config/env.js';
import { VMFleetClient } from './vm-fleet.client.js';

export const vmFleetClient = new VMFleetClient(env.VMFLEET_URL, env.VMFLEET_TOKEN);

export { VMFleetClient } from './vm-fleet.client.js';
export { VMFleetApiError } from './vm-fleet.types.js';
export type { ReservedVm, VMFleetImage, VMFleetImageTags, VMFleetVm } from './vm-fleet.types.js';
