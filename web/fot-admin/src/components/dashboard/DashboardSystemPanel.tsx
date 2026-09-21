import { Link } from 'react-router-dom';

import type { DashboardStats, PosTerminalMonitorDto } from '@/api/types';

import { formatNum } from '@/api/client';

import { timeAgo } from './dashboardUtils';



function StatusDot({ on }: { on: boolean }) {

  return <span className={`inline-flex h-2 w-2 rounded-full ${on ? 'bg-emerald-500' : 'bg-slate-300'}`} />;

}



export function DashboardSystemPanel({

  edariConnected,

  edariMessage,

  terminals,

  stats,

  unsynced,

  failed,

}: {

  edariConnected: boolean;

  edariMessage?: string;

  terminals: PosTerminalMonitorDto[];

  stats?: DashboardStats | null;

  unsynced: number;

  failed: number;

}) {

  const online = terminals.filter(t => t.isOnline || t.active).length;



  return (

    <div className="space-y-3">

      <div className={`rounded-lg border p-3 ${edariConnected ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}>

        <div className="flex flex-wrap items-start justify-between gap-3">

          <div className="flex items-start gap-2.5">

            <StatusDot on={edariConnected} />

            <div>

              <p className="text-[14px] font-bold text-header">Edari {edariConnected ? 'متصل' : 'غير متصل'}</p>

              {stats?.edariDatabaseAlias && (

                <p className="mt-0.5 font-mono text-[11px] text-slate-500" dir="ltr">{stats.edariDatabaseAlias}</p>

              )}

              {edariMessage && <p className="mt-1.5 text-[12px] leading-5 text-slate-600">{edariMessage}</p>}

            </div>

          </div>

          <div className="flex flex-wrap gap-1.5">

            {unsynced > 0 && (

              <Link to="/edari" className="rounded-md bg-sky-100 px-2.5 py-1 text-[11px] font-bold text-sky-800 hover:bg-sky-200">

                {formatNum(unsynced)} ترحيل

              </Link>

            )}

            {failed > 0 && (

              <Link to="/edari" className="rounded-md bg-red-100 px-2.5 py-1 text-[11px] font-bold text-red-800 hover:bg-red-200">

                {formatNum(failed)} فشل

              </Link>

            )}

            <Link to="/edari" className="rounded-md bg-brand-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-brand-700">

              فتح Edari

            </Link>

          </div>

        </div>

      </div>



      <div className="flex items-center justify-between gap-2">

        <p className="text-[12px] font-bold text-header">

          نقاط البيع

          <span className="ms-2 font-normal text-slate-500">{formatNum(online)} متصل من {formatNum(terminals.length)}</span>

        </p>

        <Link to="/terminals" className="text-[11px] font-semibold text-brand-700 hover:underline">إدارة الأجهزة</Link>

      </div>



      {terminals.length > 0 ? (

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">

          {terminals.map(t => {

            const on = t.isOnline || t.active;

            return (

              <Link

                key={t.id}

                to="/terminals"

                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition hover:border-brand-200 ${

                  on ? 'border-emerald-200/80 bg-white' : 'border-slate-200 bg-slate-50/50'

                }`}

              >

                <StatusDot on={on} />

                <div className="min-w-0 flex-1">

                  <p className="truncate text-[13px] font-semibold text-header">{t.name ?? `#${t.id}`}</p>

                  {t.sectionName && <p className="truncate text-[11px] text-slate-400">{t.sectionName}</p>}

                </div>

                <span className={`shrink-0 text-[10px] font-semibold ${on ? 'text-emerald-700' : 'text-slate-400'}`}>

                  {on ? timeAgo(t.lastConnection) : 'متوقف'}

                </span>

              </Link>

            );

          })}

        </div>

      ) : (

        <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center">

          <p className="text-[13px] text-slate-500">لا أجهزة مسجّلة بعد</p>

          <Link to="/terminals" className="mt-3 inline-block rounded-md bg-brand-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-700">

            إضافة نقطة بيع

          </Link>

        </div>

      )}

    </div>

  );

}

