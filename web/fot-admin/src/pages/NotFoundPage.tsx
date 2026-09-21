import { Link } from 'react-router-dom';
import { Btn } from '@/components/ui';
import { EmptyWorkspace } from '@/components/workspace';

export function NotFoundPage() {
  return (
    <EmptyWorkspace
      title="الصفحة غير موجودة"
      hint="تأكد من الرابط أو ابحث من Ctrl+K. يمكنك العودة للوحة التحكم أو فتح الفواتير مباشرة."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/">
            <Btn>العودة للرئيسية</Btn>
          </Link>
          <Link to="/receipts">
            <Btn variant="secondary">الفواتير</Btn>
          </Link>
        </div>
      }
    />
  );
}
