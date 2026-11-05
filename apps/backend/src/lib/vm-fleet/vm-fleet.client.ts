import { randomUUID } from 'node:crypto';
import { env } from '@/lib/config/env.js';
import { logger } from '../logger.js';
import {
  VM_FLEET_DELETE_POLL_INTERVAL_MS,
  VM_FLEET_DELETE_TIMEOUT_MS,
  VM_FLEET_READY_STATE,
  VM_FLEET_REQUEST_TIMEOUT_MS,
  VM_FLEET_RETRY_DELAYS_MS,
  VM_FLEET_RETRYABLE_STATUS_CODES,
} from './vm-fleet.constants.js';
import { ReservedVm, VmAcquisitionLifecycle, VMFleetApiError, VMFleetApiErrorBody, VMFleetImage, VMFleetVm } from './vm-fleet.types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

interface RequestOptions extends RequestInit {
  retryTimeout?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value);
}

function isVMFleetVm(value: unknown): value is VMFleetVm {
  return isRecord(value)
    && typeof value['id'] === 'string' && value['id'].length > 0
    && typeof value['name'] === 'string' && value['name'].length > 0
    && typeof value['actual_state'] === 'string'
    && typeof value['provisioning_state'] === 'string'
    && (typeof value['guacamole_connection_id'] === 'string' || typeof value['guacamole_connection_id'] === 'number')
    && String(value['guacamole_connection_id']).length > 0;
}

function isVMFleetImage(value: unknown): value is VMFleetImage {
  if (typeof value !== 'object' || value === null) return false;
  const image = value as Record<string, unknown>;
  return typeof image['image_id'] === 'string'
    && image['image_id'].length > 0
    && typeof image['name'] === 'string'
    && image['name'].length > 0
    && (image['tags'] === undefined || image['tags'] === null || isRecord(image['tags']));
}

const log = logger.child({ module: 'vm-fleet' });

export class VMFleetClient {
  private readonly baseUrl: string;
  private readonly authHeaders: Readonly<Record<string, string>>;
  private readonly reservedVmNames = new Set<string>();
  private readonly deleteKeys = new Map<string, string>();

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authHeaders = Object.freeze({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
  }

  async checkHealth(): Promise<void> {
    await this.request('/', { method: 'GET', retryTimeout: true });
  }

  async findByName(vmName: string): Promise<VMFleetVm | null> {
    const searchParams = new URLSearchParams({
      profile: env.VMFLEET_PROFILE,
      name: vmName,
    });
    const response = await this.request(`/api/v1/vms?${searchParams}`, {
      method: 'GET',
      retryTimeout: true,
    });
    const vms = await this.readJson<unknown>(response);

    if (!Array.isArray(vms) || !vms.every((vm) => isRecord(vm)
      && typeof vm['id'] === 'string' && vm['id'].length > 0
      && typeof vm['name'] === 'string' && vm['name'].length > 0)) {
      throw new VMFleetApiError('VM Fleet exact-name lookup returned an invalid response');
    }

    const matches = (vms as VMFleetVm[]).filter((vm) => vm.name === vmName);
    if (matches.length > 1) throw new VMFleetApiError('VM Fleet exact-name lookup returned an ambiguous response');
    return matches[0] ?? null;
  }

  async reserveAvailable(
    image: string, excludedVmNames: ReadonlySet<string> = new Set(), lifecycle?: VmAcquisitionLifecycle
  ): Promise<ReservedVm> {
    const searchParams = new URLSearchParams({
      profile: env.VMFLEET_PROFILE,
      state: VM_FLEET_READY_STATE,
      assigned: 'false',
      image,
    });
    const response = await this.request(`/api/v1/vms?${searchParams}`, {
      method: 'GET',
      retryTimeout: true,
    });
    const vms = await this.readJson<unknown>(response);

    if (!Array.isArray(vms)) {
      throw new VMFleetApiError('VM Fleet reserved VM lookup returned an invalid response');
    }

    const attemptedVmIds = new Set<string>();
    for (const candidate of vms) {
      if (!isVMFleetVm(candidate)
        || candidate.provisioning_state !== VM_FLEET_READY_STATE
        || attemptedVmIds.has(candidate.id)
        || this.reservedVmNames.has(candidate.name)
        || excludedVmNames.has(candidate.name)) continue;

      attemptedVmIds.add(candidate.id);
      // Занимаем локально до await: параллельный вызов не должен назначить ту же VM.
      this.reservedVmNames.add(candidate.name);
      let reserved = false;
      let assigned = false;
      try {
        const assignKey = randomUUID();
        if (lifecycle && !await lifecycle.onCandidate(candidate, assignKey)) continue;
        const assignedResponse = await this.request(`/api/v1/vms/${encodeURIComponent(candidate.id)}/assign`, {
          method: 'POST',
          headers: { 'Idempotency-Key': assignKey },
          retryTimeout: true,
        });
        if (assignedResponse.status !== 200) throw await this.toApiError(assignedResponse);
        assigned = true;
        // HTTP 200 is durable evidence even if reading/validating the body fails.
        await lifecycle?.onAssignmentConfirmed(candidate);

        const assignedVm = await this.readJson<unknown>(assignedResponse);
        if (!isVMFleetVm(assignedVm)
          || assignedVm.id !== candidate.id
          || assignedVm.name !== candidate.name
          || assignedVm.status !== 'assigned') {
          throw new VMFleetApiError('VM Fleet assignment returned an invalid response', assignedResponse.status);
        }

        const result = this.toReservedVm(assignedVm);
        await lifecycle?.onAssigned(result);
        reserved = true;
        return result;
      } catch (err) {
        if (err instanceof VMFleetApiError && (
          err.status === 404
          || (err.status === 409 && (err.apiCode === 'already_assigned' || err.apiCode === 'invalid_state'))
        )) {
          await lifecycle?.onUnavailable();
          log.debug({ vmId: candidate.id, apiCode: err.apiCode }, 'VM Fleet candidate is unavailable, trying next VM');
          continue;
        }
        if (assigned && !lifecycle) {
          // HTTP 200 подтвердил владение, но подключиться по некорректному ответу нельзя.
          void this.deleteVmById(candidate.id).catch((deleteError: unknown) => {
            log.warn({ vmName: candidate.name, err: deleteError }, 'Failed to delete VM after invalid assignment response');
          });
        }
        throw err;
      } finally {
        if (!reserved) this.reservedVmNames.delete(candidate.name);
      }
    }

    log.debug({ image, availableCount: vms.length }, 'No available VM found for reservation');
    throw new VMFleetApiError(`No available VM for image ${image}`);
  }

  async listImagesInUse(): Promise<VMFleetImage[]> {
    const response = await this.request('/api/v1/images?in_use=true', {
      method: 'GET',
      retryTimeout: true,
    });
    const images = await this.readJson<unknown>(response);

    if (!Array.isArray(images) || !images.every(isVMFleetImage)) {
      throw new VMFleetApiError('VM Fleet image list returned an invalid response');
    }

    return images as VMFleetImage[];
  }

  releaseReservation(vmName: string): void {
    // Это только локальная отметка: назначенную VM освобождает её удаление в Fleet.
    this.reservedVmNames.delete(vmName);
  }

  async assignCandidate(vmId: string, vmName: string, assignKey: string): Promise<ReservedVm> {
    const response = await this.request(`/api/v1/vms/${encodeURIComponent(vmId)}/assign`, {
      method: 'POST', headers: { 'Idempotency-Key': assignKey }, retryTimeout: true,
    });
    const vm = await this.readJson<unknown>(response);
    if (response.status !== 200 || !isVMFleetVm(vm)
      || vm.id !== vmId || vm.name !== vmName || vm.status !== 'assigned') {
      throw new VMFleetApiError('VM Fleet assignment returned an invalid response', response.status);
    }
    return this.toReservedVm(vm);
  }

  async deleteVmById(vmId: string, timeoutMs = VM_FLEET_DELETE_TIMEOUT_MS): Promise<void> {
    const key = this.deleteKeys.get(vmId) ?? randomUUID();
    this.deleteKeys.set(vmId, key);
    const response = await this.request(`/api/v1/vms/${encodeURIComponent(vmId)}?force=true`, {
      method: 'DELETE', headers: { 'Idempotency-Key': key }, retryTimeout: true,
    }, new Set([404]));
    if (response.status !== 404 && response.status !== 202) throw await this.toApiError(response);
    if (response.status !== 404) await this.waitDeleted(vmId, timeoutMs);
    this.deleteKeys.delete(vmId);
  }

  async deleteVm(vmName: string, timeoutMs = VM_FLEET_DELETE_TIMEOUT_MS): Promise<void> {
    const vm = await this.findByName(vmName);
    if (!vm) {
      this.reservedVmNames.delete(vmName);
      return;
    }

    await this.deleteVmById(vm.id, timeoutMs);
    this.reservedVmNames.delete(vmName);
  }

  async waitDeleted(vmId: string, timeoutMs = VM_FLEET_DELETE_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await this.request(`/api/v1/vms/${encodeURIComponent(vmId)}`, {
        method: 'GET',
        retryTimeout: true,
      }, new Set([404]));

      if (response.status === 404) return;
      await sleep(VM_FLEET_DELETE_POLL_INTERVAL_MS);
    }

    throw new VMFleetApiError(`Timed out waiting for VM ${vmId} deletion`);
  }

  private toReservedVm(vm: VMFleetVm): ReservedVm {
    return {
      vmId: vm.id,
      vmName: vm.name,
      status: vm.actual_state,
      connectionId: String(vm.guacamole_connection_id),
      ...(vm.private_ip && { ipAddress: vm.private_ip }),
    };
  }

  private async request(path: string, options: RequestOptions, acceptedStatuses = new Set<number>()): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    for (let attempt = 0; attempt <= VM_FLEET_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: { ...this.authHeaders, ...options.headers },
          signal: AbortSignal.timeout(VM_FLEET_REQUEST_TIMEOUT_MS),
        });

        if (response.ok || acceptedStatuses.has(response.status)) return response;

        if (VM_FLEET_RETRYABLE_STATUS_CODES.has(response.status) && attempt < VM_FLEET_RETRY_DELAYS_MS.length) {
          await sleep(VM_FLEET_RETRY_DELAYS_MS[attempt] ?? 0);
          continue;
        }
        throw await this.toApiError(response);
      } catch (err) {
        if (
          isTimeoutError(err)
          && options.retryTimeout
          && attempt < VM_FLEET_RETRY_DELAYS_MS.length
        ) {
          await sleep(VM_FLEET_RETRY_DELAYS_MS[attempt] ?? 0);
          continue;
        }
        if (isTimeoutError(err)) {
          throw new VMFleetApiError(`VM Fleet request timed out after ${VM_FLEET_REQUEST_TIMEOUT_MS / 1000}s`);
        }
        throw err;
      }
    }

    throw new VMFleetApiError('VM Fleet retry limit exceeded');
  }

  private async readJson<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T;
    } catch {
      throw new VMFleetApiError(`VM Fleet returned invalid JSON (HTTP ${response.status})`, response.status);
    }
  }

  private async toApiError(response: Response): Promise<VMFleetApiError> {
    let body: VMFleetApiErrorBody = {};
    try {
      body = await response.json() as VMFleetApiErrorBody;
    } catch {
      // Ошибка без JSON-body всё равно содержит проверяемый HTTP status.
    }
    const apiCode = body.error?.code;
    const message = body.error?.message ?? response.statusText ?? 'request failed';
    const codeSuffix = apiCode ? `, error.code=${apiCode}` : '';
    return new VMFleetApiError(`VM Fleet request failed: HTTP ${response.status}${codeSuffix}: ${message}`, response.status, apiCode);
  }
}
