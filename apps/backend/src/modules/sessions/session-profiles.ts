import { agentManager } from '@/lib/agent/agent-manager.client.js';
import { BadGatewayException, BadRequestException } from '@/lib/http/errors.js';
import { MODEL_OPTIONS } from './sessions.constants.js';
import type { AvailableAgentProfile } from '@/lib/agent/agent-profiles.schema.js';

function isLegacyModel(model: string): boolean {
  return MODEL_OPTIONS.some((legacy) => legacy === model);
}

// Старые model ID были декоративными. Реальный одноимённый профиль имеет приоритет.
export async function runtimeProfile(model: string | null | undefined): Promise<string> {
  if (!model) return 'default';
  if (!isLegacyModel(model)) return model;
  try {
    return (await agentManager.listProfiles()).some((profile) => profile.id === model) ? model : 'default';
  } catch {
    return 'default';
  }
}

export async function availableProfiles(): Promise<AvailableAgentProfile[]> {
  try {
    return await agentManager.listProfiles();
  } catch {
    throw new BadGatewayException('Failed to load Agent Manager profiles');
  }
}

export async function selectedProfile(model: string | undefined): Promise<AvailableAgentProfile> {
  if (!model) return { id: 'default', displayName: 'Computer Operator' };
  let profiles: AvailableAgentProfile[];
  try {
    profiles = await availableProfiles();
  } catch (error) {
    if (isLegacyModel(model)) return { id: 'default', displayName: 'Computer Operator' };
    throw error;
  }
  const profile = profiles.find((item) => item.id === model);
  if (profile) return profile;
  if (isLegacyModel(model)) return { id: 'default', displayName: 'Computer Operator' };
  throw new BadRequestException('Selected Agent Manager profile is unavailable', 'MODEL_NOT_SUPPORTED');
}
