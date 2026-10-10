import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, voidSale, type Sale } from '../lib/db'
import { formatPeso } from '../lib/money'
import { endOfDay, formatDateTime, fromDateInput, startOfDay, toDateInput } from '../lib/dates'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import Receipt from '../components/Receipt'

const paymentBadge: Record<Sale['payment'], string> = {
  cash: 'bg-emerald-100 text-emerald-700',
  gcash: 'bg-blue-100 text-blue-700',
  maya: 'bg-green-100 text-green-700',
  utang: 'bg-amber-100 text-amber-700',
}

export default function SalesPage() {
  const [date, setDate] = useState(toDateInput(new Date()))
  const [selected, setSelected] = useState<Sale | null>(null)
  const day = fromDateInput(date)
  const sales =
    useLiveQuery(() => db.sales.where('createdAt').between(startOfDay(day), endOfDay(day), true, true).reverse().toArray(), [date]) ?? []

  const completed = sales.filter((s) => s.status === 'completed')
  const total = completed.reduce((s, x) => s + x.total, 0)

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Receipts</h1>
        <input type="date" className="input w-auto" value={date} max={toDateInput(new Date())} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>

      <div className="card flex justify-between p-4">
        <div>
          <div className="text-sm text-slate-500">{completed.length} transactions</div>
          <div className="text-2xl font-bold">{formatPeso(total)}</div>
        </div>
        {sales.length !== completed.length && (
          <div className="text-right text-sm text-slate-500">{sales.length - completed.length} voided</div>
        )}
      </div>

      <ul className="card divide-y divide-slate-100">
        {sales.length === 0 && <li className="p-8 text-center text-slate-400">No sales on this day</li>}
        {sales.map((s) => (
          <li key={s.id}>
            <button onClick={() => setSelected(s)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${s.status === 'voided' ? 'text-slate-400 line-through' : ''}`}>#{s.receiptNo}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs uppercase ${paymentBadge[s.payment]}`}>{s.payment === 'utang' ? 'credit' : s.payment}</span>
                  {s.status === 'voided' && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">VOID</span>}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {new Date(s.createdAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })} ·{' '}
                  {s.items.map((i) => i.name).join(', ')}
                </div>
              </div>
              <div className={`font-semibold ${s.status === 'voided' ? 'text-slate-400 line-through' : ''}`}>{formatPeso(s.total)}</div>
            </button>
          </li>
        ))}
      </ul>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `Receipt #${selected.receiptNo}` : ''} size="sm">
        {selected && <SaleDetail sale={selected} onDone={() => setSelected(null)} />}
      </Modal>
    </div>
  )
}

function SaleDetail({ sale, onDone }: { sale: Sale; onDone: () => void }) {
  const live = useLiveQuery(() => db.sales.get(sale.id!), [sale.id]) ?? sale
  const onVoid = async () => {
    if (!confirm(`Void receipt #${sale.receiptNo}? Stock will be returned${sale.payment === 'utang' ? ' and the credit balance reduced' : ''}.`)) return
    await voidSale(sale.id!)
    onDone()
  }
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 p-3">
        <Receipt sale={live} />
      </div>
      {live.status === 'voided' && live.voidedAt && <p className="text-center text-sm text-red-600">Voided {formatDateTime(live.voidedAt)}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-secondary" onClick={() => window.print()}>
          <Icon name="printer" /> Print
        </button>
        {live.status === 'completed' ? (
          <button className="btn-danger" onClick={onVoid}>Void</button>
        ) : (
          <button className="btn-secondary" onClick={onDone}>Close</button>
        )}
      </div>
    </div>
  )
}
