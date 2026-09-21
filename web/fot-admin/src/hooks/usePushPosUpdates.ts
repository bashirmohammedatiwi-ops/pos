import { useState } from 'react';
import { api } from '@/api/client';
import { useToast } from '@/components/Toast';

export function usePushPosUpdates() {
  const toast = useToast();
  const [pushing, setPushing] = useState(false);

  async function push() {
    if (pushing) return;
    setPushing(true);
    try {
      await api.pushPosUpdates();
      toast.success('أُرسل التحديث إلى نقاط البيع المتصلة — يصل خلال ثوانٍ دون إيقاف البيع');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'فشل إرسال التحديث إلى نقاط البيع');
    } finally {
      setPushing(false);
    }
  }

  return { push, pushing };
}
