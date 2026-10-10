import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, recordPayment, type Customer } from '../lib/db'
import { formatPeso, toCentavos } from '../lib/money'
import { formatDateTime } from '../lib/dates'
import Icon from '../components/Icon'
import Modal from '../components/Modal'

export default function CustomersPage() {
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), []) ?? []
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const shown = customers.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
  const totalOwed = customers.reduce((s, c) => s + Math.max(0, c.balance), 0)

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Credit Accounts</h1>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Customer
        </button>
      </div>

      <div className="card p-4">
        <div className="text-sm text-slate-500">Total owed by all customers</div>
        <div className="text-2xl font-bold text-amber-600">{formatPeso(totalOwed)}</div>
      </div>

      <div className="relative">
        <Icon name="search" className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input className="input pl-10" placeholder="Search customers…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <ul className="card divide-y divide-slate-100">
        {shown.length === 0 && <li className="p-8 text-center text-slate-400">No customers</li>}
        {shown.map((c) => (
          <li key={c.id}>
            <button className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50" onClick={() => setSelectedId(c.id!)}>
              <div>
                <div className="font-medium">{c.name}</div>
                {c.phone && <div className="text-xs text-slate-500">{c.phone}</div>}
              </div>
              <div className={`font-semibold ${c.balance > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{formatPeso(c.balance)}</div>
            </button>
          </li>
        ))}
      </ul>

      <Modal open={adding} onClose={() => setAdding(false)} title="New customer" size="sm">
        {adding && <CustomerForm onClose={() => setAdding(false)} />}
      </Modal>
      <Modal open={selectedId !== null} onClose={() => setSelectedId(null)} title="Credit">
        {selectedId !== null && <CustomerDetail id={selectedId} />}
      </Modal>
    </div>
  )
}

function CustomerForm({ customer, onClose }: { customer?: Customer; onClose: () => void }) {
  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (customer) await db.customers.update(customer.id!, { name: name.trim(), phone: phone.trim() })
    else await db.customers.add({ name: name.trim(), phone: phone.trim(), balance: 0, createdAt: Date.now() })
    onClose()
  }
  return (
    <form onSubmit={save} className="space-y-3">
      <div>
        <label className="label">Name *</label>
        <input className="input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">Mobile number</label>
        <input className="input" type="tel" inputMode="tel" placeholder="09XX XXX XXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <button className="btn-primary w-full">Save</button>
    </form>
  )
}

function CustomerDetail({ id }: { id: number }) {
  const customer = useLiveQuery(() => db.customers.get(id), [id])
  const entries = useLiveQuery(() => db.credits.where('customerId').equals(id).reverse().sortBy('createdAt'), [id]) ?? []
  const [amount, setAmount] = useState('')
  const [editing, setEditing] = useState(false)

  if (!customer) return null

  const pay = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = toCentavos(amount)
    if (cents <= 0) return
    await recordPayment(id, cents, 'Payment')
    setAmount('')
  }

  if (editing) return <CustomerForm customer={customer} onClose={() => setEditing(false)} />

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold">{customer.name}</div>
          {customer.phone && <a href={`tel:${customer.phone}`} className="text-sm text-brand-700">{customer.phone}</a>}
        </div>
        <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setEditing(true)}>
          <Icon name="edit" className="h-4 w-4" /> Edit
        </button>
      </div>
      <div className="rounded-xl bg-amber-50 p-4">
        <div className="text-sm text-amber-700">Outstanding balance</div>
        <div className="text-3xl font-bold text-amber-700">{formatPeso(customer.balance)}</div>
      </div>

      <form onSubmit={pay} className="flex gap-2">
        <input
          className="input"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          placeholder="Payment amount (₱)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button className="btn-primary whitespace-nowrap" disabled={!amount}>Pay</button>
      </form>
      {customer.balance > 0 && (
        <button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => setAmount((customer.balance / 100).toFixed(2))}>
          Pay in full ({formatPeso(customer.balance)})
        </button>
      )}

      <div>
        <div className="mb-1 text-sm font-medium text-slate-600">History</div>
        <ul className="divide-y divide-slate-100 text-sm">
          {entries.length === 0 && <li className="py-4 text-center text-slate-400">No records yet</li>}
          {entries.map((e) => (
            <li key={e.id} className="flex justify-between gap-2 py-2">
              <div>
                <div>{e.type === 'charge' ? 'Credit' : e.type === 'payment' ? 'Payment' : 'Void'}{e.note ? ` · ${e.note}` : ''}</div>
                <div className="text-xs text-slate-400">{formatDateTime(e.createdAt)}</div>
              </div>
              <div className={e.type === 'charge' ? 'font-medium text-amber-600' : 'font-medium text-brand-700'}>
                {e.type === 'charge' ? '+' : '−'}
                {formatPeso(e.amount)}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
