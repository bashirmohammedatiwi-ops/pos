import type { UseQueryResult } from '@tanstack/react-query';
import { Btn, TableSkeleton } from '@/components/ui';
import { IconAlert, IconRefresh, IconWifi } from '@/components/icons';

function isNetworkError(err: unknown) {
  if (!(err instanceof Error)) return false;
  return /failed to fetch|networkerror|network request|load failed|ECONNREFUSED|timeout/i.test(err.message);
}

export function QueryState<T>({
  query,
  children,
  empty,
  skeleton,
}: {
  query: Pick<UseQueryResult<T>, 'isLoading' | 'isError' | 'error' | 'refetch' | 'data'> & { isFetching?: boolean };
  children: React.ReactNode;
  empty?: React.ReactNode;
  skeleton?: React.ReactNode;
}) {
  if (query.isLoading) return <>{skeleton ?? <TableSkeleton />}</>;
  if (query.isError) {
    const offline = isNetworkError(query.error);
    const detail = query.error instanceof Error ? query.error.message : '';
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center" role="alert">
        <span className={`icon-tile h-12 w-12 rounded-2xl ${offline ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'}`}>
          {offline ? <IconWifi size={22} /> : <IconAlert size={22} />}
        </span>
        <p className="text-[14px] font-bold text-slate-700">
          {offline ? 'تعذّر الاتصال بالخادم' : 'تعذّر تحميل البيانات'}
        </p>
        <p className="max-w-sm break-words text-[12px] leading-5 text-slate-500">
          {offline ? 'تحقق من تشغيل الجهاز الرئيسي واتصال الشبكة ثم أعد المحاولة.' : detail || 'حدث خطأ غير متوقع.'}
        </p>
        <Btn
          className="mt-2"
          size="sm"
          variant="secondary"
          icon={<IconRefresh size={14} className={query.isFetching ? 'animate-spin' : ''} />}
          disabled={query.isFetching}
          onClick={() => query.refetch()}
        >
          إعادة المحاولة
        </Btn>
      </div>
    );
  }
  const noData = Array.isArray(query.data) ? query.data.length === 0 : query.data == null;
  if (empty && noData) return <>{empty}</>;
  return <>{children}</>;
}
