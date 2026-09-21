import type { ReactNode } from 'react';



type AttentionItem = {

  id: string;

  tone: 'amber' | 'sky' | 'red';

  label: string;

  count: number;

  action?: ReactNode;

};



const toneStyles = {

  amber: { box: 'border-amber-200 bg-amber-50', badge: 'bg-amber-100 text-amber-900', dot: 'bg-amber-500' },

  sky: { box: 'border-sky-200 bg-sky-50', badge: 'bg-sky-100 text-sky-900', dot: 'bg-sky-500' },

  red: { box: 'border-red-200 bg-red-50', badge: 'bg-red-100 text-red-900', dot: 'bg-red-500' },

};



export function DashboardAttentionStrip({ items }: { items: AttentionItem[] }) {

  const activeItems = items.filter(i => i.count > 0);

  if (activeItems.length === 0) return null;



  return (

    <div className={`rounded-lg border px-3 py-2.5 ${toneStyles.amber.box}`}>

      <p className="mb-2 text-[12px] font-bold text-amber-950">يحتاج متابعة</p>

      <div className="flex flex-wrap gap-2">

        {activeItems.map(item => {

          const t = toneStyles[item.tone];

          return (

            <div

              key={item.id}

              className={`flex flex-wrap items-center gap-2 rounded-md border bg-white/70 px-2.5 py-1.5 ${t.box}`}

            >

              <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-bold ${t.badge}`}>

                <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />

                {item.label}

                <span className="num">{item.count}</span>

              </span>

              {item.action}

            </div>

          );

        })}

      </div>

    </div>

  );

}

