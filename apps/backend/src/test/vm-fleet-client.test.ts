import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VMFleetClient } from '@/lib/vm-fleet/vm-fleet.client.js';
import { VMFleetApiError } from '@/lib/vm-fleet/vm-fleet.types.js';

const { fleetEnv } = vi.hoisted(() => ({ fleetEnv: { VMFLEET_PROFILE: 'reserved_vm' } }));
vi.mock('@/lib/config/env.js', () => ({ env: fleetEnv }));

vi.mock('@/lib/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

const TOKEN = 'vmf_secret_token';
const VM_NAME = 'reserved_vm_ubuntu2204_bcbffadffcf04bafb49350c2344bc2f8';
const FIRST_VM = {
  id: 'vm_first', name: VM_NAME, provisioning_state: 'READY', actual_state: 'ready', guacamole_connection_id: '42',
};
const SECOND_VM = { ...FIRST_VM, id: 'vm_second', name: 'reserved_vm_ubuntu2204_second', guacamole_connection_id: '43' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('VMFleetClient', () => {
  beforeEach(() => {
    fleetEnv.VMFLEET_PROFILE = 'reserved_vm';
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('checkHealth дёргает GET / без загрузки всего инвентаря VM', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('OK', { status: 200 }));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    await expect(client.checkHealth()).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://fleet.internal/',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('uses the configured profile for both exact lookup and VM reservation', async () => {
    fleetEnv.VMFLEET_PROFILE = 'custom_vm+blue';
    vi.mocked(fetch).mockImplementation(async () => jsonResponse([]));
    const client = new VMFleetClient('https://fleet.internal', TOKEN);

    await expect(client.findByName(VM_NAME)).resolves.toBeNull();
    await expect(client.reserveAvailable('ubuntu2204')).rejects.toThrow('No available VM');

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url] of vi.mocked(fetch).mock.calls) {
      expect(new URL(String(url)).searchParams.get('profile')).toBe('custom_vm+blue');
    }
  });

  it('exact-name lookup only reports absence after a valid successful inventory response', async () => {
    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([]));
    await expect(client.findByName(VM_NAME)).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([SECOND_VM]));
    await expect(client.findByName(VM_NAME)).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([FIRST_VM]));
    await expect(client.findByName(VM_NAME)).resolves.toEqual(FIRST_VM);
  });

  it.each([{}, [null], [{ name: VM_NAME }], [{ id: 'id' }], [{ id: '', name: VM_NAME }],
    [FIRST_VM, { ...FIRST_VM, id: 'duplicate' }]])('rejects malformed or ambiguous lookup %j', async body => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body));
    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    await expect(client.findByName(VM_NAME)).rejects.toBeInstanceOf(VMFleetApiError);
  });

  it('резервирует готовую VM по фильтру image и передаёт Bearer token', async () => {
    const vm = {
      id: 'vm_dkxxmxciin1l_42',
      name: VM_NAME,
      provisioning_state: 'READY',
      actual_state: 'ready',
      guacamole_connection_id: 'old-connection',
      private_ip: '10.0.0.10',
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([vm]))
      .mockResolvedValueOnce(jsonResponse({ ...vm, status: 'assigned', guacamole_connection_id: 42, private_ip: '10.0.0.15' }));

    const client = new VMFleetClient('https://fleet.internal/', TOKEN);
    await expect(client.reserveAvailable('ubuntu2204')).resolves.toEqual({
      vmId: 'vm_dkxxmxciin1l_42',
      vmName: VM_NAME,
      status: 'ready',
      connectionId: '42',
      ipAddress: '10.0.0.15',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://fleet.internal/api/v1/vms?profile=reserved_vm&state=READY&assigned=false&image=ubuntu2204',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      })
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      'https://fleet.internal/api/v1/vms/vm_dkxxmxciin1l_42/assign',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${TOKEN}`,
          'Idempotency-Key': expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      })
    );
  });

  it('не выдаёт одну VM повторно; снятие локальной отметки не отменяет назначение в Fleet', async () => {
    const inventory = [{
      id: 'vm_dkxxmxciin1l_42',
      name: VM_NAME,
      provisioning_state: 'READY',
      actual_state: 'ready',
      guacamole_connection_id: '42',
    }];
    let assigned = false;
    vi.mocked(fetch).mockImplementation((_url, init) => {
      if (init?.method === 'GET') return Promise.resolve(jsonResponse(inventory));
      if (assigned) return Promise.resolve(jsonResponse({ error: { code: 'already_assigned' } }, 409));
      assigned = true;
      return Promise.resolve(jsonResponse({ ...inventory[0], status: 'assigned' }));
    });

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    await client.reserveAvailable('ubuntu2204');
    await expect(client.reserveAvailable('ubuntu2204')).rejects.toThrow('No available VM');
    expect(fetch).toHaveBeenCalledTimes(3);

    client.releaseReservation(VM_NAME);
    await expect(client.reserveAvailable('ubuntu2204')).rejects.toThrow('No available VM');
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('пропускает исключённую другим backend VM и выбирает следующую', async () => {
    const secondVmName = 'reserved_vm_ubuntu2204_second';
    const inventory = [
      {
        id: 'vm_first', name: VM_NAME, provisioning_state: 'READY', actual_state: 'ready',
        guacamole_connection_id: '42',
      },
      {
        id: 'vm_second', name: secondVmName, provisioning_state: 'READY', actual_state: 'ready',
        guacamole_connection_id: '43',
      },
    ];
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(inventory))
      .mockResolvedValueOnce(jsonResponse({ ...inventory[1], status: 'assigned' }));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);

    await expect(client.reserveAvailable('ubuntu2204', new Set([VM_NAME]))).resolves.toMatchObject({
      vmName: secondVmName,
      connectionId: '43',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe('https://fleet.internal/api/v1/vms/vm_second/assign');
  });

  it.each([
    [409, 'already_assigned'],
    [409, 'invalid_state'],
    [404, 'not_found'],
  ])('при HTTP %i / %s пропускает кандидата и назначает следующего', async (status, apiCode) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([FIRST_VM, SECOND_VM]))
      .mockResolvedValueOnce(jsonResponse({ error: { code: apiCode } }, status))
      .mockResolvedValueOnce(jsonResponse({ ...SECOND_VM, status: 'assigned' }));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    const deleteSpy = vi.spyOn(client, 'deleteVmById').mockResolvedValue(undefined);
    await expect(client.reserveAvailable('ubuntu2204')).resolves.toMatchObject({ vmId: SECOND_VM.id, connectionId: '43' });
    expect(deleteSpy).not.toHaveBeenCalled();

    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      'https://fleet.internal/api/v1/vms?profile=reserved_vm&state=READY&assigned=false&image=ubuntu2204',
      'https://fleet.internal/api/v1/vms/vm_first/assign',
      'https://fleet.internal/api/v1/vms/vm_second/assign',
    ]);
    const firstHeaders = vi.mocked(fetch).mock.calls[1]?.[1]?.headers;
    const secondHeaders = vi.mocked(fetch).mock.calls[2]?.[1]?.headers;
    expect(firstHeaders).not.toEqual(secondHeaders);
  });

  it('завершает поиск, когда все кандидаты уже назначены', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([FIRST_VM, SECOND_VM]))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'already_assigned' } }, 409))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'already_assigned' } }, 409));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    await expect(client.reserveAvailable('ubuntu2204')).rejects.toThrow('No available VM');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('не повторяет назначение конфликтующего кандидата, продублированного в списке', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([FIRST_VM, FIRST_VM]))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'already_assigned' } }, 409));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    await expect(client.reserveAvailable('ubuntu2204')).rejects.toThrow('No available VM');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([[403, 'forbidden'], [409, 'unexpected_conflict']])(
    'не скрывает ошибку HTTP %i / %s переходом к другой VM', async (status, apiCode) => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse([FIRST_VM, SECOND_VM]))
        .mockResolvedValueOnce(jsonResponse({ error: { code: apiCode } }, status));

      const client = new VMFleetClient('https://fleet.internal', TOKEN);
      await expect(client.reserveAvailable('ubuntu2204')).rejects.toMatchObject({ status, apiCode });
      expect(fetch).toHaveBeenCalledTimes(2);

      // Неуспешный POST не оставляет локальную блокировку кандидата.
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse([FIRST_VM]))
        .mockResolvedValueOnce(jsonResponse({ ...FIRST_VM, status: 'assigned' }));
      await expect(client.reserveAvailable('ubuntu2204')).resolves.toMatchObject({ vmId: FIRST_VM.id });
    }
  );

  it.each(['timeout', '503'])('повторяет назначение после %s с тем же Idempotency-Key', async (failure) => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([FIRST_VM]));
    if (failure === 'timeout') {
      vi.mocked(fetch).mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    } else {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: { code: 'unavailable' } }, 503));
    }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...FIRST_VM, status: 'assigned' }));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    const assertion = expect(client.reserveAvailable('ubuntu2204')).resolves.toMatchObject({ vmId: FIRST_VM.id });
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetch).toHaveBeenCalledTimes(3);
    const firstCall = vi.mocked(fetch).mock.calls[1];
    const retryCall = vi.mocked(fetch).mock.calls[2];
    expect(retryCall?.[0]).toBe(firstCall?.[0]);
    expect(retryCall?.[1]?.headers).toEqual(firstCall?.[1]?.headers);
  });

  it('прекращает повторы после лимита и не назначает другую VM при неизвестном результате', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([FIRST_VM, SECOND_VM]))
      .mockImplementation(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    const assertion = expect(client.reserveAvailable('ubuntu2204')).rejects.toThrow('timed out');
    await vi.runAllTimersAsync();
    await assertion;

    const assignCalls = vi.mocked(fetch).mock.calls.slice(1);
    expect(assignCalls).toHaveLength(4);
    for (const call of assignCalls) {
      expect(call[0]).toBe('https://fleet.internal/api/v1/vms/vm_first/assign');
      expect(call[1]?.headers).toEqual(assignCalls[0]?.[1]?.headers);
    }
  });

  it('блокирует кандидата локально, пока параллельный POST assign не завершился', async () => {
    let completeAssignment!: (response: Response) => void;
    const assignment = new Promise<Response>((resolve) => { completeAssignment = resolve; });
    let notifyAssignmentStarted!: () => void;
    const assignmentStarted = new Promise<void>((resolve) => { notifyAssignmentStarted = resolve; });
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (init?.method === 'GET') return Promise.resolve(jsonResponse([FIRST_VM, SECOND_VM]));
      if (String(url).endsWith('/vm_first/assign')) {
        notifyAssignmentStarted();
        return assignment;
      }
      return Promise.resolve(jsonResponse({ ...SECOND_VM, status: 'assigned' }));
    });

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    const first = client.reserveAvailable('ubuntu2204');
    await assignmentStarted;
    await expect(client.reserveAvailable('ubuntu2204')).resolves.toMatchObject({ vmId: SECOND_VM.id });
    completeAssignment(jsonResponse({ ...FIRST_VM, status: 'assigned' }));
    await expect(first).resolves.toMatchObject({ vmId: FIRST_VM.id });
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  });

  it('разные клиенты получают разные VM при гонке за один и тот же список', async () => {
    const assignedIds = new Set<string>();
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (init?.method === 'GET') return Promise.resolve(jsonResponse([FIRST_VM, SECOND_VM]));
      const vm = String(url).endsWith('/vm_first/assign') ? FIRST_VM : SECOND_VM;
      if (assignedIds.has(vm.id)) return Promise.resolve(jsonResponse({ error: { code: 'already_assigned' } }, 409));
      assignedIds.add(vm.id);
      return Promise.resolve(jsonResponse({ ...vm, status: 'assigned' }));
    });

    const firstClient = new VMFleetClient('https://fleet.internal', TOKEN);
    const secondClient = new VMFleetClient('https://fleet.internal', TOKEN);
    const results = await Promise.all([firstClient.reserveAvailable('ubuntu2204'), secondClient.reserveAvailable('ubuntu2204')]);
    expect(new Set(results.map((vm) => vm.vmId))).toEqual(new Set([FIRST_VM.id, SECOND_VM.id]));
  });

  it('кодирует VM id в пути assign', async () => {
    const vm = { ...FIRST_VM, id: 'vm/a?b' };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([vm]))
      .mockResolvedValueOnce(jsonResponse({ ...vm, status: 'assigned' }));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    await client.reserveAvailable('ubuntu2204');
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe('https://fleet.internal/api/v1/vms/vm%2Fa%3Fb/assign');
  });

  it('persists intent before assign, then HTTP 200 evidence before reading a malformed body', async () => {
    const onCandidate = vi.fn().mockResolvedValue(true);
    const onAssignmentConfirmed = vi.fn().mockResolvedValue(undefined);
    const onAssigned = vi.fn();
    const onUnavailable = vi.fn();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([FIRST_VM]))
      .mockImplementationOnce(async () => {
        expect(onCandidate).toHaveBeenCalledWith(FIRST_VM, expect.any(String));
        return new Response('invalid-json', { status: 200 });
      });
    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    const deleteSpy = vi.spyOn(client, 'deleteVmById');
    await expect(client.reserveAvailable('image', new Set(), {
      onCandidate, onAssignmentConfirmed, onAssigned, onUnavailable,
    })).rejects.toThrow('invalid JSON');
    expect(onAssignmentConfirmed).toHaveBeenCalledExactlyOnceWith(FIRST_VM);
    expect(onAssigned).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('never assigns when journaling the candidate fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([FIRST_VM]));
    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    await expect(client.reserveAvailable('image', new Set(), {
      onCandidate: async () => { throw new Error('journal unavailable'); },
      onAssignmentConfirmed: vi.fn(), onAssigned: vi.fn(), onUnavailable: vi.fn(),
    })).rejects.toThrow('journal unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, { ...FIRST_VM }, { ...FIRST_VM, status: 'assigned', id: 'wrong-id' },
    { ...FIRST_VM, status: 'assigned', guacamole_connection_id: null }])(
    'не выдаёт VM по некорректному ответу assign и удаляет назначенного кандидата', async (body) => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse([FIRST_VM]))
        .mockResolvedValueOnce(jsonResponse(body));
      const client = new VMFleetClient('https://fleet.internal', TOKEN);
      const deleteSpy = vi.spyOn(client, 'deleteVmById').mockResolvedValue(undefined);

      await expect(client.reserveAvailable('ubuntu2204')).rejects.toThrow('invalid response');
      expect(deleteSpy).toHaveBeenCalledWith(FIRST_VM.id);
    }
  );

  it('пропускает неготовые и некорректные записи инвентаря без POST assign', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([
      null, {}, { ...FIRST_VM, id: '' }, { ...FIRST_VM, provisioning_state: 'DELETING' },
      { ...FIRST_VM, guacamole_connection_id: '' },
    ]));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    await expect(client.reserveAvailable('ubuntu2204')).rejects.toThrow('No available VM');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('удаляет назначенного кандидата при невалидном JSON в успешном ответе assign', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([FIRST_VM]))
      .mockResolvedValueOnce(new Response('invalid-json', { status: 200 }));
    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    const deleteSpy = vi.spyOn(client, 'deleteVmById').mockResolvedValue(undefined);

    await expect(client.reserveAvailable('ubuntu2204')).rejects.toThrow('invalid JSON');
    expect(deleteSpy).toHaveBeenCalledExactlyOnceWith(FIRST_VM.id);
  });

  it('получает используемые образы через API с Bearer token', async () => {
    const images = [{
      image_id: '8b6ce2c8-1234-5678-90ab-cdef12345678',
      machines: 16,
      name: 'fleet-ubuntu-example',
      os_version: 'Ubuntu 22.04 server 64bit',
      preset: '',
      tags: {
        branch: 'develop',
        commit: 'd5986e8879a1',
        created: '2026-09-03',
        owner: 'team',
        pipeline: '4640967',
        profile: 'default',
        source: 'packer',
        version: '0.0.150',
      },
    }];
    vi.mocked(fetch).mockResolvedValue(jsonResponse(images));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);

    await expect(client.listImagesInUse()).resolves.toEqual(images);
    expect(fetch).toHaveBeenCalledWith(
      'https://fleet.internal/api/v1/images?in_use=true',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      })
    );
  });

  it('отклоняет некорректный ответ списка образов', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ images: [] }));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);

    await expect(client.listImagesInUse()).rejects.toThrow('invalid response');
  });

  it('отклоняет список образов без обязательных идентификатора и имени', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{
      image_id: '',
      machines: 1,
      name: '',
      os_version: 'Ubuntu',
      preset: '',
      tags: { created: '2026-09-03' },
    }]));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);

    await expect(client.listImagesInUse()).rejects.toThrow('invalid response');
  });

  it('принимает tags с неизвестными типами значений, чтобы отфильтровать образ по наличию объекта', async () => {
    const images = [{
      image_id: 'img-1',
      machines: 1,
      name: 'packer-image',
      os_version: 'Ubuntu',
      preset: '',
      tags: { created: '2026-09-03', build_number: 42 },
    }];
    vi.mocked(fetch).mockResolvedValue(jsonResponse(images));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);

    await expect(client.listImagesInUse()).resolves.toEqual(images);
  });

  it('отклоняет tags в формате массива', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{
      image_id: 'img-1',
      machines: 1,
      name: 'broken-image',
      os_version: 'Ubuntu',
      preset: '',
      tags: ['created', '2026-09-03'],
    }]));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);

    await expect(client.listImagesInUse()).rejects.toThrow('invalid response');
  });

  it('не выбирает VM без connection id', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([
      { id: 'vm_1', name: VM_NAME, provisioning_state: 'READY', actual_state: 'ready', guacamole_connection_id: null },
    ]));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    await expect(client.reserveAvailable('ubuntu2204')).rejects.toThrow('No available VM');
  });

  it('удаляет managed и imported VM по id с force=true и Idempotency-Key, ждёт 404', async () => {
    const VM_ID = 'vm_dkszz0s7yohv_fk';
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([{
        id: VM_ID,
        name: VM_NAME,
        provisioning_state: 'READY',
        actual_state: 'ready',
        guacamole_connection_id: '42',
        managed: false,
        source: 'imported',
      }]))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    await client.deleteVm(VM_NAME, 100);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      `https://fleet.internal/api/v1/vms?profile=reserved_vm&name=${VM_NAME}`
    );

    const deleteCall = vi.mocked(fetch).mock.calls[1];
    expect(deleteCall?.[0]).toBe(`https://fleet.internal/api/v1/vms/${VM_ID}?force=true`);
    const deleteInit = deleteCall?.[1];
    expect(deleteInit?.method).toBe('DELETE');
    expect(deleteInit?.headers).toEqual(expect.objectContaining({
      Authorization: `Bearer ${TOKEN}`,
      'Idempotency-Key': expect.any(String),
    }));

    expect(vi.mocked(fetch).mock.calls[2]?.[0]).toBe(`https://fleet.internal/api/v1/vms/${VM_ID}`);
  });

  it('возвращает status и error.code в типизированной ошибке без утечки token', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      error: { code: 'adoption_required', message: 'VM must be adopted' },
    }, 409));

    const client = new VMFleetClient('https://fleet.internal', TOKEN);
    const error = await client.deleteVm(VM_NAME).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(VMFleetApiError);
    expect(error).toMatchObject({ status: 409, apiCode: 'adoption_required' });
    expect((error as Error).message).not.toContain(TOKEN);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
