import type { AvailableImage } from '@arena/ui/types/image.types';

export const DEFAULT_IMAGE_SELECTION = 'preset:ubuntu2204' as const;

export type ImageSelectionValue = typeof DEFAULT_IMAGE_SELECTION | `image:${string}`;

interface ImageOption {
  value: ImageSelectionValue;
  label: string;
}

export function buildImageOptions(images: AvailableImage[], hasError = false): ImageOption[] {
  const availableImages = hasError ? [] : images;
  return [
    { value: DEFAULT_IMAGE_SELECTION, label: 'Ubuntu' },
    ...availableImages.map((image) => ({
      value: `image:${image.imageId}` as const,
      label: `${image.name} · ${shortImageId(image.imageId)}`,
    })),
  ];
}

export function toSessionImageFields(selection: ImageSelectionValue): { arenaOs: 'ubuntu2204' } | { customImageId: string } {
  if (selection === DEFAULT_IMAGE_SELECTION) return { arenaOs: 'ubuntu2204' };
  return { customImageId: selection.slice('image:'.length) };
}

export function parseImageSelection(value: string): ImageSelectionValue {
  if (value === DEFAULT_IMAGE_SELECTION || (value.startsWith('image:') && value.length > 'image:'.length)) {
    return value as ImageSelectionValue;
  }
  throw new Error('Invalid image selection');
}

export function imageSelectionAfterLoad(
  selection: ImageSelectionValue,
  availableImageIds: ReadonlySet<string> | null
): ImageSelectionValue {
  if (DEFAULT_IMAGE_SELECTION === selection || null === availableImageIds) return selection;
  const selectedImageId = selection.slice('image:'.length);
  return availableImageIds.has(selectedImageId) ? selection : DEFAULT_IMAGE_SELECTION;
}

function shortImageId(imageId: string): string {
  return imageId.length > 8 ? `${imageId.slice(0, 8)}…` : imageId;
}
