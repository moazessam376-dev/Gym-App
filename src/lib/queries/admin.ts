// Query hooks for the admin console (Slice G3). Thin wrappers over src/lib/admin.ts.
import { useQuery } from '@tanstack/react-query';
import { getAdminCounts, searchUsers } from '@/lib/admin';

export function useAdminCounts(enabled = true) {
  return useQuery({
    queryKey: ['admin-counts'],
    queryFn: getAdminCounts,
    enabled,
  });
}

export function useUserSearch(query: string, enabled = true) {
  const q = query.trim();
  return useQuery({
    queryKey: ['admin-users', q],
    queryFn: () => searchUsers(q),
    // Only fire on an empty box (recent users) or a query of 2+ chars.
    enabled: enabled && (q.length === 0 || q.length >= 2),
  });
}
