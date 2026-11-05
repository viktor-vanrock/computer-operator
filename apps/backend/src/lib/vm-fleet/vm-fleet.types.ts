export interface VMFleetVm {
  id: string;
  name: string;
  profile?: string;
  status?: string;
  provisioning_state: string;
  actual_state: string;
  private_ip?: string | null;
  guacamole_connection_id: string | number | null;
}

export interface VMFleetImageTags {
  created?: string;
  version?: string;
  [key: string]: unknown;
}

export interface VMFleetImage {
  image_id: string;
  name: string;
  tags?: VMFleetImageTags | null;
}

export interface VMFleetApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

export interface ReservedVm {
  vmId: string;
  vmName: string;
  status: string;
  connectionId: string;
  ipAddress?: string;
}

export interface VmAcquisitionLifecycle {
  onCandidate: (candidate: VMFleetVm, assignKey: string) => Promise<boolean>;
  onAssignmentConfirmed: (candidate: VMFleetVm) => Promise<void>;
  onAssigned: (vm: ReservedVm) => Promise<void>;
  onUnavailable: () => Promise<void>;
}

export class VMFleetApiError extends Error {
  readonly status: number | undefined;
  readonly apiCode: string | undefined;

  constructor(message: string, status?: number, apiCode?: string) {
    super(message);
    this.name = 'VMFleetApiError';
    this.status = status;
    this.apiCode = apiCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
