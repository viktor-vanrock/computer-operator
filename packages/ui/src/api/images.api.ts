import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../lib/api-client';
import type { AvailableImage } from '../types/image.types';

export const imageKeys = {
  available: ['images', 'available'] as const,
};

export function useAvailableImages() {
  return useQuery({
    queryKey: imageKeys.available,
    queryFn: () => apiClient.get<AvailableImage[]>('/images'),
  });
}
