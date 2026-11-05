import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listImagesInUse } = vi.hoisted(() => ({ listImagesInUse: vi.fn() }));

vi.mock('@/lib/vm-fleet/index.js', () => ({
  vmFleetClient: { listImagesInUse },
}));

describe('imagesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('оставляет только образы с tags и возвращает минимальный DTO', async () => {
    const upstreamImages = [
      {
        image_id: 'img-no-tags',
        machines: 2,
        name: 'not-packer',
        os_version: 'Ubuntu',
        preset: '',
      },
      {
        image_id: 'img-null-tags',
        machines: 2,
        name: 'null-tags',
        os_version: 'Ubuntu',
        preset: '',
        tags: null,
      },
      {
        image_id: 'img-packer',
        machines: 16,
        name: 'packer-image',
        os_version: 'Ubuntu',
        preset: '',
        tags: { created: '2026-09-03', version: '0.0.150' },
      },
    ];
    listImagesInUse.mockResolvedValue(upstreamImages);

    const { imagesService } = await import('@/modules/images/images.service.js');

    await expect(imagesService.findAvailable()).resolves.toEqual([
      { imageId: 'img-packer', name: 'packer-image' },
    ]);
    expect(upstreamImages.map(({ image_id: imageId }) => imageId)).toEqual([
      'img-no-tags',
      'img-null-tags',
      'img-packer',
    ]);
  });

  it('сортирует по дате, числовой версии и имени, помещая некорректные метаданные в конец', async () => {
    listImagesInUse.mockResolvedValue([
      image('old', 'old', '2026-09-02', '9.0.0'),
      image('version-99', 'z-name', '2026-09-03', '0.0.99'),
      image('version-150-z', 'z-name', '2026-09-03', '0.0.150'),
      image('version-150-a', 'a-name', '2026-09-03', '0.0.150'),
      image('invalid-version', 'invalid-version', '2026-09-03', 'release'),
      image('invalid-date', 'invalid-date', 'not-a-date', '99.0.0'),
      image('impossible-date', 'impossible-date', '2026-02-31', '100.0.0'),
    ]);

    const { imagesService } = await import('@/modules/images/images.service.js');
    const result = await imagesService.findAvailable();

    expect(result.map(({ imageId }) => imageId)).toEqual([
      'version-150-a',
      'version-150-z',
      'version-99',
      'invalid-version',
      'old',
      'impossible-date',
      'invalid-date',
    ]);
  });

  it('не изменяет порядок объектов в ответе VM Fleet', async () => {
    const upstreamImages = [
      image('old', 'old', '2026-09-02', '0.0.1'),
      image('new', 'new', '2026-09-03', '0.0.2'),
    ];
    listImagesInUse.mockResolvedValue(upstreamImages);

    const { imagesService } = await import('@/modules/images/images.service.js');
    await imagesService.findAvailable();

    expect(upstreamImages.map(({ image_id: imageId }) => imageId)).toEqual(['old', 'new']);
  });

  it('сортирует компоненты версии без потери точности больших целых', async () => {
    listImagesInUse.mockResolvedValue([
      image('lower', 'a-name', '2026-09-03', '0.9007199254740992.0'),
      image('higher', 'z-name', '2026-09-03', '0.9007199254740993.0'),
    ]);

    const { imagesService } = await import('@/modules/images/images.service.js');
    const result = await imagesService.findAvailable();

    expect(result.map(({ imageId }) => imageId)).toEqual(['higher', 'lower']);
  });
});

describe('imagesRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('преобразует ошибку VM Fleet в 502 без утечки деталей', async () => {
    listImagesInUse.mockRejectedValue(new Error('secret upstream details'));
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const { imagesRouter } = await import('@/modules/images/images.router.js');
    await app.register(imagesRouter, { prefix: '/images' });

    const response = await app.inject({ method: 'GET', url: '/images' });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      statusCode: 502,
      code: 'BAD_GATEWAY',
      error: 'Bad Gateway',
      message: 'Failed to load available VM images',
    });
    expect(response.body).not.toContain('secret upstream details');
    await app.close();
  });

  it('преобразует сетевую ошибку запроса VM Fleet в 502', async () => {
    listImagesInUse.mockRejectedValue(new TypeError('fetch failed'));
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const { imagesRouter } = await import('@/modules/images/images.router.js');
    await app.register(imagesRouter, { prefix: '/images' });

    const response = await app.inject({ method: 'GET', url: '/images' });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      code: 'BAD_GATEWAY',
      message: 'Failed to load available VM images',
    });
    await app.close();
  });

  it('преобразует ошибку обработки списка в 502', async () => {
    listImagesInUse.mockRejectedValue(new Error('unexpected processing failure'));
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const { imagesRouter } = await import('@/modules/images/images.router.js');
    await app.register(imagesRouter, { prefix: '/images' });

    const response = await app.inject({ method: 'GET', url: '/images' });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: 'BAD_GATEWAY' });
    await app.close();
  });
});

function image(imageId: string, name: string, created: string, version: string) {
  return {
    image_id: imageId,
    machines: 1,
    name,
    os_version: 'Ubuntu 22.04 server 64bit',
    preset: '',
    tags: { created, version },
  };
}
