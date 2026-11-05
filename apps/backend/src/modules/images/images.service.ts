import { vmFleetClient } from '@/lib/vm-fleet/index.js';

import type { AvailableImage } from './images.types.js';
import type { VMFleetImage, VMFleetImageTags } from '@/lib/vm-fleet/index.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_PATTERN = /^\d+(?:\.\d+)*$/;

function validDate(value: unknown): number | null {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

function versionParts(value: unknown): bigint[] | null {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) return null;
  return value.split('.').map(BigInt);
}

function compareOptionalDescending<T>(left: T | null, right: T | null, compare: (a: T, b: T) => number): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return compare(right, left);
}

function compareVersions(left: bigint[], right: bigint[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftPart = left[index] ?? 0n;
    const rightPart = right[index] ?? 0n;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function compareImages(left: VMFleetImage, right: VMFleetImage): number {
  const leftTags = left.tags as VMFleetImageTags;
  const rightTags = right.tags as VMFleetImageTags;
  const byDate = compareOptionalDescending(
    validDate(leftTags.created),
    validDate(rightTags.created),
    (a, b) => a - b
  );
  if (byDate !== 0) return byDate;

  const byVersion = compareOptionalDescending(
    versionParts(leftTags.version),
    versionParts(rightTags.version),
    compareVersions
  );
  if (byVersion !== 0) return byVersion;

  return left.name.localeCompare(right.name);
}

export const imagesService = {
  async findAvailable(): Promise<AvailableImage[]> {
    const images = await vmFleetClient.listImagesInUse();

    return [...images]
      .filter((image): image is VMFleetImage & { tags: VMFleetImageTags } =>
        typeof image.tags === 'object' && image.tags !== null
      )
      .sort(compareImages)
      .map((image) => ({ imageId: image.image_id, name: image.name }));
  },
};
