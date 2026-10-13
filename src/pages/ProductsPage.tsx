import { useMemo, useState } from 'react'
import { doc, limit, orderBy, query as fsQuery, where } from 'firebase/firestore'
import { adjustStock, createProduct, updateProduct, type Product, type StockMove } from '../lib/db'
import { col } from '../lib/firebase'
import { useCollection, useDocument } from '../lib/hooks'
import { formatPeso, formatQty, toCentavos, toPesos } from '../lib/money'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import CameraScanner, { cameraScanSupported } from '../components/CameraScanner'

type Filter = 'all' | 'low' | 'archived'

export default function ProductsPage() {
  const allProducts = useCollection<Product>(() => col('products'), [])
  const products = useMemo(() => [...(allProducts ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [allProducts])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [stocking, setStocking] = useState<Product | null>(null)

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products])
  const lowCount = products.filter((p) => p.active && p.stock <= p.lowStock).length

  const shown = products.filter((p) => {
    const q = query.trim().toLowerCase()
    if (q && !p.name.toLowerCase().includes(q) && p.barcode !== q && !p.category.toLowerCase().includes(q)) return false
    if (filter === 'archived') return !p.active
    if (!p.active) return false
    if (filter === 'low') return p.stock <= p.lowStock
    return true
  })

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Products</h1>
        <button className="btn-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" /> New product
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Icon name="search" className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input className="input pl-10" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex gap-1 rounded-lg bg-white p-1 ring-1 ring-slate-200">
          {(['all', 'low', 'archived'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${filter === f ? 'bg-brand-600 text-white' : 'text-slate-600'}`}
            >
              {f === 'all' ? 'All' : f === 'low' ? `Low stock (${lowCount})` : 'Archived'}
            </button>
          ))}
        </div>
      </div>

      {/* Table on larger screens */}
      <div className="card hidden overflow-hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
              <th className="px-4 py-2 text-right font-medium">Price</th>
              <th className="px-4 py-2 text-right font-medium">Stock</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <div className="font-medium">{p.name}</div>
                  {p.barcode && <div className="text-xs text-slate-400">{p.barcode}</div>}
                </td>
                <td className="px-4 py-2 text-slate-600">{p.category}</td>
                <td className="px-4 py-2 text-right text-slate-500">{formatPeso(p.cost)}</td>
                <td className="px-4 py-2 text-right font-semibold">{formatPeso(p.price)}</td>
                <td className={`px-4 py-2 text-right ${p.stock <= p.lowStock ? 'font-semibold text-red-600' : ''}`}>
                  {formatQty(p.stock)} {p.unit}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setStocking(p)}>Stock</button>{' '}
                  <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setEditing(p)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="p-8 text-center text-slate-400">No products</p>}
      </div>

      {/* Cards on phones */}
      <ul className="space-y-2 md:hidden">
        {shown.map((p) => (
          <li key={p.id} className="card flex items-center gap-3 p-3">
            <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(p)}>
              <div className="truncate font-medium">{p.name}</div>
              <div className="text-xs text-slate-500">
                {p.category} · cost {formatPeso(p.cost)}
              </div>
              <div className="mt-1 flex gap-3 text-sm">
                <span className="font-semibold text-brand-700">{formatPeso(p.price)}</span>
                <span className={p.stock <= p.lowStock ? 'font-semibold text-red-600' : 'text-slate-500'}>
                  {formatQty(p.stock)} {p.unit}
                </span>
              </div>
            </button>
            <button className="btn-secondary px-3 py-2 text-sm" onClick={() => setStocking(p)}>Stock</button>
          </li>
        ))}
        {shown.length === 0 && <p className="p-8 text-center text-slate-400">No products</p>}
      </ul>

      <ProductForm product={editing} products={products} categories={categories} onClose={() => setEditing(null)} />
      <StockModal product={stocking} onClose={() => setStocking(null)} />
    </div>
  )
}

const units = ['pc', 'pack', 'sachet', 'can', 'bottle', 'box', 'kg', 'g', 'L', 'ml', 'dozen', 'tray']

interface FormProps {
  products: Product[]
  categories: string[]
  onClose: () => void
}

function ProductForm({ product, ...rest }: FormProps & { product: Product | 'new' | null }) {
  const isNew = product === 'new'
  const p = product && product !== 'new' ? product : null
  const key = isNew ? 'new' : p?.id
  return (
    <Modal open={!!product} onClose={rest.onClose} title={isNew ? 'New product' : 'Edit product'}>
      {product && <ProductFormBody key={key} product={p} {...rest} />}
    </Modal>
  )
}

function ProductFormBody({ product, products, categories, onClose }: FormProps & { product: Product | null }) {
  const [form, setForm] = useState({
    name: product?.name ?? '',
    barcode: product?.barcode ?? '',
    category: product?.category ?? '',
    unit: product?.unit ?? 'pc',
    price: product ? String(toPesos(product.price)) : '',
    cost: product ? String(toPesos(product.cost)) : '',
    stock: product ? String(product.stock) : '0',
    lowStock: product ? String(product.lowStock) : '5',
  })
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value })

  const price = toCentavos(form.price)
  const cost = toCentavos(form.cost)
  const margin = price > 0 && cost > 0 ? Math.round(((price - cost) / price) * 100) : null

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const barcode = form.barcode.trim()
    if (barcode) {
      const dupe = products.find((p) => p.barcode === barcode && p.id !== product?.id)
      if (dupe) return setError(`Barcode is already used by "${dupe.name}".`)
    }
    const data = {
      name: form.name.trim(),
      barcode,
      category: form.category.trim(),
      unit: form.unit,
      price,
      cost,
      lowStock: Number(form.lowStock) || 0,
    }
    if (product) updateProduct(product.id, data)
    else createProduct(data, Number(form.stock) || 0)
    onClose()
  }

  const toggleArchive = () => {
    updateProduct(product!.id, { active: !product!.active })
    onClose()
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div>
        <label className="label">Name *</label>
        <input className="input" required autoFocus value={form.name} onChange={set('name')} />
      </div>
      <div>
        <label className="label">Barcode</label>
        <div className="flex gap-2">
          <input className="input" value={form.barcode} onChange={set('barcode')} placeholder="Scan or type" />
          {cameraScanSupported() && (
            <button type="button" className="btn-secondary px-3" onClick={() => setScanning((s) => !s)} aria-label="Scan barcode">
              <Icon name="scan" />
            </button>
          )}
        </div>
        {scanning && (
          <div className="mt-2">
            <CameraScanner onDetected={(code) => { setForm((f) => ({ ...f, barcode: code })); setScanning(false) }} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Category</label>
          <input className="input" list="categories" value={form.category} onChange={set('category')} />
          <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <label className="label">Unit</label>
          <select className="input" value={form.unit} onChange={set('unit')}>
            {[...new Set([...units, form.unit])].map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Cost (₱)</label>
          <input className="input" type="number" inputMode="decimal" step="0.01" min="0" value={form.cost} onChange={set('cost')} />
        </div>
        <div>
          <label className="label">Price (₱) *</label>
          <input className="input" type="number" inputMode="decimal" step="0.01" min="0" required value={form.price} onChange={set('price')} />
        </div>
        {!product && (
          <div>
            <label className="label">Initial stock</label>
            <input className="input" type="number" inputMode="decimal" step="any" value={form.stock} onChange={set('stock')} />
          </div>
        )}
        <div>
          <label className="label">Alert when ≤</label>
          <input className="input" type="number" inputMode="decimal" step="any" min="0" value={form.lowStock} onChange={set('lowStock')} />
        </div>
      </div>
      {margin !== null && (
        <p className={`text-sm ${margin < 0 ? 'text-red-600' : 'text-slate-500'}`}>
          Profit: {formatPeso(price - cost)} per {form.unit} ({margin}%)
        </p>
      )}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2 pt-2">
        {product && (
          <button type="button" className="btn-secondary" onClick={toggleArchive}>
            {product.active ? 'Archive' : 'Restore'}
          </button>
        )}
        <button type="submit" className="btn-primary flex-1">Save</button>
      </div>
    </form>
  )
}

function StockModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  return (
    <Modal open={!!product} onClose={onClose} title="Stock" size="sm">
      {product && <StockBody key={product.id} product={product} onClose={onClose} />}
    </Modal>
  )
}

function StockBody({ product, onClose }: { product: Product; onClose: () => void }) {
  const [mode, setMode] = useState<'restock' | 'adjust'>('restock')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const moves =
    useCollection<StockMove>(
      () => fsQuery(col('stockMoves'), where('productId', '==', product.id), orderBy('createdAt', 'desc'), limit(10)),
      [product.id],
    ) ?? []
  const live = useDocument<Product>(() => doc(col('products'), product.id), [product.id]) ?? product

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    const n = Number(qty)
    if (!n) return
    // Restock adds; adjust sets the counted quantity (e.g. after inventory count).
    const delta = mode === 'restock' ? n : n - live.stock
    if (delta) adjustStock(product.id, delta, mode, note.trim() || undefined)
    onClose()
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div>
        <div className="font-medium">{product.name}</div>
        <div className="text-sm text-slate-500">
          Current stock: <b>{formatQty(live.stock)} {product.unit}</b>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
        <button type="button" onClick={() => setMode('restock')} className={`rounded-md py-1.5 text-sm ${mode === 'restock' ? 'bg-white shadow' : ''}`}>
          Restock
        </button>
        <button type="button" onClick={() => setMode('adjust')} className={`rounded-md py-1.5 text-sm ${mode === 'adjust' ? 'bg-white shadow' : ''}`}>
          Count
        </button>
      </div>
      <div>
        <label className="label">{mode === 'restock' ? 'Quantity to add' : 'Actual count'}</label>
        <input className="input" type="number" inputMode="decimal" step="any" autoFocus required value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>
      <input className="input" placeholder="Note (optional, e.g. supplier)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button type="submit" className="btn-primary w-full">Save</button>

      {moves.length > 0 && (
        <div>
          <div className="mt-2 mb-1 text-sm font-medium text-slate-600">Recent movements</div>
          <ul className="divide-y divide-slate-100 text-sm">
            {moves.map((m) => (
              <li key={m.id} className="flex justify-between py-1.5">
                <span className="text-slate-500">
                  {new Date(m.createdAt).toLocaleDateString('en-PH')} · {m.reason}
                  {m.note ? ` · ${m.note}` : ''}
                </span>
                <span className={m.qty < 0 ? 'text-red-600' : 'text-brand-700'}>
                  {m.qty > 0 ? '+' : ''}
                  {formatQty(m.qty)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  )
}
