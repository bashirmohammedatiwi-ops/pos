import { useEffect } from 'react';
import { IRAQ_OFFSET_MS, to12, two, useLockInfo, type LockProps } from '../../access';
import { I, Mark, Screen } from '../kit';
import { BackBtn } from '../parts';
import { statusOnHero } from '../native';

/* شاشة البدء (التحقق من أوقات العمل) وشاشة القفل خارج الوقت — بهوية التطبيق. */

export function Splash({ offline }: { offline?: boolean }) {
  useEffect(() => {
    statusOnHero(true);
    return () => statusOnHero(false);
  }, []);
  return (
    <div className="t-splash" aria-busy="true">
      <div style={{ display: 'grid', justifyItems: 'center' }}>
        <div className="t-mark">
          <Mark size={46} />
        </div>
        <p>{offline ? 'لا اتصال بالإنترنت — نعيد المحاولة تلقائياً' : 'ديما · الفريق'}</p>
      </div>
    </div>
  );
}

/** العمولات والأهداف خارج الوقت: الصفحة مقفلة وباقي التطبيق يعمل */
export function LockedFeature({ title, back }: { title: string; back?: string }) {
  const info = useLockInfo();
  const left = info?.opensAt != null ? Math.max(0, Math.floor((info.opensAt - info.now) / 1000)) : null;
  const d = left != null ? Math.floor(left / 86400) : 0;
  const h = left != null ? Math.floor((left % 86400) / 3600) : 0;
  const m = left != null ? Math.floor((left % 3600) / 60) : 0;
  const s = left != null ? left % 60 : 0;
  const opens = info?.opensAt != null ? new Date(info.opensAt + IRAQ_OFFSET_MS) : null;
  const timed = info?.schedule.fromMin != null && info?.schedule.toMin != null;
  return (
    <Screen title={title} start={back ? <BackBtn to={back} /> : undefined}>
      <section className="t-lock t-lock-inline" role="status">
        <div className="icon">
          <I.lock size={30} />
        </div>
        <h1>العمولات والأهداف مقفلة الآن</h1>
        <p className="hours">
          {timed ? (
            <>
              تُفتح لك من <b>{to12(info!.schedule.fromMin)}</b> إلى <b>{to12(info!.schedule.toMin)}</b>
            </>
          ) : (
            'متاحة لك في الأيام المحددة فقط'
          )}
          <br />
          {info?.schedule.days || 'كل الأيام'} · بتوقيت العراق
        </p>
        {left != null ? (
          <>
            <div className="t-count" aria-label="الوقت المتبقي للفتح">
              {d > 0 && (
                <span className="cell">
                  <b className="num">{d}</b>
                  <small>يوم</small>
                </span>
              )}
              <span className="cell">
                <b className="num">{two(h)}</b>
                <small>ساعة</small>
              </span>
              <span className="cell">
                <b className="num">{two(m)}</b>
                <small>دقيقة</small>
              </span>
              <span className="cell">
                <b className="num">{two(s)}</b>
                <small>ثانية</small>
              </span>
            </div>
            {opens && (
              <p className="when">
                تُفتح {DAYS[opens.getUTCDay()]} الساعة {to12(opens.getUTCHours() * 60 + opens.getUTCMinutes())}
              </p>
            )}
          </>
        ) : (
          <p className="when">لا موعد فتح قادم — راجع الإدارة</p>
        )}
        <p className="now">باقي التطبيق يعمل كالمعتاد</p>
      </section>
    </Screen>
  );
}

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function Lock({ schedule, opensAt, now, onLogout }: LockProps & { onLogout: () => void }) {
  useEffect(() => {
    statusOnHero(true);
    return () => statusOnHero(false);
  }, []);
  const left = opensAt != null ? Math.max(0, Math.floor((opensAt - now) / 1000)) : null;
  const d = left != null ? Math.floor(left / 86400) : 0;
  const h = left != null ? Math.floor((left % 86400) / 3600) : 0;
  const m = left != null ? Math.floor((left % 3600) / 60) : 0;
  const s = left != null ? left % 60 : 0;
  const iraq = new Date(now + IRAQ_OFFSET_MS);
  const opens = opensAt != null ? new Date(opensAt + IRAQ_OFFSET_MS) : null;
  const timed = schedule.fromMin != null && schedule.toMin != null;

  return (
    <main className="t-lock" role="alertdialog" aria-labelledby="lock-h">
      <div className="icon">
        <I.lock size={34} />
      </div>
      <h1 id="lock-h">خارج وقت عملك</h1>
      <p className="hours">
        {timed ? (
          <>
            يُفتح التطبيق لك من <b>{to12(schedule.fromMin)}</b> إلى <b>{to12(schedule.toMin)}</b>
          </>
        ) : (
          'متاح لك في الأيام المحددة فقط'
        )}
        <br />
        {schedule.days || 'كل الأيام'} · بتوقيت العراق
      </p>

      {left != null ? (
        <>
          <div className="t-count" aria-label="الوقت المتبقي للفتح">
            {d > 0 && (
              <span className="cell">
                <b className="num">{d}</b>
                <small>يوم</small>
              </span>
            )}
            <span className="cell">
              <b className="num">{two(h)}</b>
              <small>ساعة</small>
            </span>
            <span className="cell">
              <b className="num">{two(m)}</b>
              <small>دقيقة</small>
            </span>
            <span className="cell">
              <b className="num">{two(s)}</b>
              <small>ثانية</small>
            </span>
          </div>
          {opens && (
            <p className="when">
              يُفتح {DAYS[opens.getUTCDay()]} الساعة {to12(opens.getUTCHours() * 60 + opens.getUTCMinutes())}
            </p>
          )}
        </>
      ) : (
        <p className="when">لا موعد فتح قادم — راجع الإدارة</p>
      )}

      <p className="now">
        الساعة الآن في العراق <b className="num ltr">{to12(iraq.getUTCHours() * 60 + iraq.getUTCMinutes())}</b>
      </p>
      <button type="button" className="t-btn sm press" style={{ marginTop: 28, background: 'rgba(255,255,255,.14)', boxShadow: 'none' }} onClick={onLogout}>
        <I.out size={18} />
        تسجيل الخروج
      </button>
    </main>
  );
}
