import { useQuery } from '@tanstack/react-query';

import { AuthError, fetchCurrentUser } from '@/lib/auth-client';

export function useCurrentUser() {
  const query = useQuery({
    queryKey:  ['auth', 'me'],
    queryFn:   fetchCurrentUser,
    retry:     false,
    staleTime: Infinity,
  });

  const isUnauthorized = query.error instanceof AuthError && 401 === query.error.status;

  return {
    user:           query.data,
    isPending:      query.isPending,
    isUnauthorized,
    error:          query.error,
  };
}
