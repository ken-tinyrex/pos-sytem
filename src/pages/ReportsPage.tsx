import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PaymentMethod } from '../lib/db'
import { formatPeso, formatQty, lineTotal } from '../lib/money'
import { endOfDay, fromDateInput, startOfDay, toDateInput } from '../lib/dates'

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

const presetRange = (p: Preset): [string, string] => {
  const today = new Date()
  const d = (offset: number) => toDateInput(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset))
  switch (p) {
    case 'yesterday':
      return [d(1), d(1)]
    case 'week':
      return [d(6), d(0)]
    case 'month':
      return [toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)), d(0)]
    default:
      return [d(0), d(0)]
  }
}

const methodLabel: Record<PaymentMethod, string> = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', utang: 'Credit' }

export default function ReportsPage() {
  const [preset, setPreset] = useState<Preset>('today')
  const [[from, to], setRange] = useState(presetRange('today'))

  const sales =
    useLiveQuery(
      () =>
        db.sales
          .where('createdAt')
          .between(startOfDay(fromDateInput(from)), endOfDay(fromDateInput(to)), true, true)
          .filter((s) => s.status === 'completed')
          .toArray(),
      [from, to],
    ) ?? []
  const lowStock = useLiveQuery(() => db.products.where('active').equals(1).filter((p) => p.stock <= p.lowStock).toArray(), []) ?? []

  const stats = useMemo(() => {
    let gross = 0
    let discounts = 0
    let cost = 0
    const byMethod: Record<PaymentMethod, number> = { cash: 0, gcash: 0, maya: 0, utang: 0 }
    const byProduct = new Map<string, { name: string; qty: number; unit: string; sales: number }>()
    for (const s of sales) {
      gross += s.subtotal
      discounts += s.discount
      byMethod[s.payment] += s.total
      for (const i of s.items) {
        cost += lineTotal(i.cost, i.qty)
        const row = byProduct.get(i.name) ?? { name: i.name, qty: 0, unit: i.unit, sales: 0 }
        row.qty += i.qty
        row.sales += lineTotal(i.price, i.qty)
        byProduct.set(i.name, row)
      }
    }
    const net = gross - discounts
    const top = [...byProduct.values()].sort((a, b) => b.sales - a.sales).slice(0, 10)
    return { gross, discounts, net, cost, profit: net - cost, byMethod, top }
  }, [sales])

  const choose = (p: Preset) => {
    setPreset(p)
    if (p !== 'custom') setRange(presetRange(p))
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-4">
      <h1 className="text-xl font-bold">Sales Report</h1>

      <div className="flex flex-wrap gap-2">
        {(['today', 'yesterday', 'week', 'month', 'custom'] as Preset[]).map((p) => (
          <button
            key={p}
            onClick={() => choose(p)}
            className={`rounded-full px-3 py-1.5 text-sm ${preset === p ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}
          >
            {{ today: 'Today', yesterday: 'Yesterday', week: 'Last 7 days', month: 'This month', custom: 'Custom' }[p]}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex gap-2">
          <input type="date" className="input" value={from} onChange={(e) => e.target.value && setRange([e.target.value, to])} />
          <input type="date" className="input" value={to} onChange={(e) => e.target.value && setRange([from, e.target.value])} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net sales" value={formatPeso(stats.net)} accent />
        <Stat label="Profit (estimate)" value={formatPeso(stats.profit)} />
        <Stat label="Transactions" value={String(sales.length)} />
        <Stat label="Discounts" value={formatPeso(stats.discounts)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">By payment method</h2>
          <ul className="space-y-2">
            {(Object.keys(stats.byMethod) as PaymentMethod[]).map((m) => {
              const pct = stats.net ? (stats.byMethod[m] / stats.net) * 100 : 0
              return (
                <li key={m}>
                  <div className="flex justify-between text-sm">
                    <span>{methodLabel[m]}</span>
                    <span className="font-medium">{formatPeso(stats.byMethod[m])}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Expected cash in drawer: <b>{formatPeso(stats.byMethod.cash)}</b>
          </p>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Top sellers</h2>
          {stats.top.length === 0 ? (
            <p className="text-sm text-slate-400">No sales</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {stats.top.map((t, i) => (
                <li key={t.name} className="flex justify-between gap-2">
                  <span className="truncate">
                    <span className="mr-1 text-slate-400">{i + 1}.</span>
                    {t.name} <span className="text-slate-400">× {formatQty(t.qty)}</span>
                  </span>
                  <span className="font-medium whitespace-nowrap">{formatPeso(t.sales)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">
          Low stock <span className="text-red-600">({lowStock.length})</span>
        </h2>
        {lowStock.length === 0 ? (
          <p className="text-sm text-slate-400">All stock levels are OK 👍</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {lowStock.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <span className="font-medium whitespace-nowrap text-red-600">
                  {formatQty(p.stock)} {p.unit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold sm:text-2xl ${accent ? 'text-brand-700' : ''}`}>{value}</div>
    </div>
  )
}
