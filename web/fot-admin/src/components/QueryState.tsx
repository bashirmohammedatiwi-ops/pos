import type { UseQueryResult } from '@tanstack/react-query';
import { Btn, TableSkeleton } from '@/components/ui';

export function QueryState<T>({
  query,
  children,
  empty,
  skeleton,
}: {
  query: Pick<UseQueryResult<T>, 'isLoading' | 'isError' | 'error' | 'refetch' | 'data'>;
  children: React.ReactNode;
  empty?: React.ReactNode;
  skeleton?: React.ReactNode;
}) {
  if (query.isLoading) return <>{skeleton ?? <TableSkeleton />}</>;
  if (query.isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-800">
          {query.error instanceof Error ? query.error.message : 'تعذّر تحميل البيانات'}
        </p>
        <Btn className="mt-4" size="sm" variant="secondary" onClick={() => query.refetch()}>
          إعادة المحاولة
        </Btn>
      </div>
    );
  }
  const noData = Array.isArray(query.data) ? query.data.length === 0 : query.data == null;
  if (empty && noData) return <>{empty}</>;
  return <>{children}</>;
}
