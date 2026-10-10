import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { checkout, db, type DiscountType, type PaymentMethod, type Product, type Sale } from '../lib/db'
import { formatPeso, formatQty, lineTotal, toCentavos } from '../lib/money'
import { useSettings } from '../lib/hooks'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import Receipt from '../components/Receipt'
import CameraScanner, { cameraScanSupported } from '../components/CameraScanner'

interface CartLine {
  product: Product
  qty: number
}

const isFractionalUnit = (unit: string) => ['kg', 'g', 'l', 'liter', 'ml'].includes(unit.toLowerCase())

export default function PosPage() {
  const products = useLiveQuery(() => db.products.where('active').equals(1).sortBy('name'), []) ?? []
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [cartOpen, setCartOpen] = useState(false) // mobile sheet
  const [paying, setPaying] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [lastSale, setLastSale] = useState<Sale | null>(null)
  const [notice, setNotice] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter(
      (p) => (!category || p.category === category) && (!q || p.name.toLowerCase().includes(q) || p.barcode === q),
    )
  }, [products, query, category])

  const subtotal = cart.reduce((s, l) => s + lineTotal(l.product.price, l.qty), 0)
  const itemCount = cart.reduce((s, l) => s + (isFractionalUnit(l.product.unit) ? 1 : l.qty), 0)

  const flash = (msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice(''), 2000)
  }

  const addToCart = (product: Product, qty = 1) => {
    setCart((c) => {
      const existing = c.find((l) => l.product.id === product.id)
      if (existing) return c.map((l) => (l === existing ? { ...l, qty: l.qty + qty } : l))
      return [...c, { product, qty }]
    })
  }

  const setQty = (id: number, qty: number) =>
    setCart((c) => (qty <= 0 ? c.filter((l) => l.product.id !== id) : c.map((l) => (l.product.id === id ? { ...l, qty } : l))))

  const addByCode = (code: string) => {
    const match = products.find((p) => p.barcode && p.barcode === code.trim())
    if (match) {
      addToCart(match)
      flash(`+ ${match.name}`)
      return true
    }
    return false
  }

  // USB/Bluetooth barcode scanners type the code then press Enter.
  const onSearchEnter = () => {
    if (!query.trim()) return
    if (addByCode(query)) return setQuery('')
    if (filtered.length === 1) {
      addToCart(filtered[0])
      flash(`+ ${filtered[0].name}`)
      setQuery('')
    } else if (filtered.length === 0) flash('No product found')
  }

  const onPaid = (sale: Sale) => {
    setPaying(false)
    setCartOpen(false)
    setCart([])
    setLastSale(sale)
  }

  const cartPanel = (
    <CartPanel
      cart={cart}
      subtotal={subtotal}
      onQty={setQty}
      onClear={() => setCart([])}
      onPay={() => setPaying(true)}
    />
  )

  return (
    <div className="flex h-full">
      {/* Products */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-2 border-b border-slate-200 bg-white p-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Icon name="search" className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                autoFocus
                className="input pl-10"
                placeholder="Search or scan barcode…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
              />
            </div>
            {cameraScanSupported() && (
              <button className="btn-secondary px-3" onClick={() => setScanning(true)} aria-label="Scan with camera">
                <Icon name="scan" />
              </button>
            )}
          </div>
          {categories.length > 0 && (
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
              <Chip active={!category} onClick={() => setCategory('')}>All</Chip>
              {categories.map((c) => (
                <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{c}</Chip>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 pb-24 lg:pb-3">
          {products.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {filtered.map((p) => {
                const inCart = cart.find((l) => l.product.id === p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className={`card relative flex min-h-24 flex-col justify-between p-3 text-left transition hover:ring-brand-500 active:scale-[.98] ${inCart ? 'ring-2 ring-brand-500' : ''}`}
                  >
                    {inCart && (
                      <span className="absolute -top-2 -right-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">
                        {formatQty(inCart.qty)}
                      </span>
                    )}
                    <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                    <span className="mt-2 flex items-end justify-between gap-1">
                      <span className="font-bold text-brand-700">{formatPeso(p.price)}</span>
                      <span className={`text-xs ${p.stock <= p.lowStock ? 'font-semibold text-red-600' : 'text-slate-400'}`}>
                        {formatQty(p.stock)} {p.unit}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Cart: side panel on large screens */}
      <aside className="hidden w-96 shrink-0 border-l border-slate-200 bg-white lg:flex lg:flex-col">{cartPanel}</aside>

      {/* Cart: sticky bar + sheet on small screens */}
      {cart.length > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between rounded-xl bg-brand-600 px-4 py-3 text-white shadow-lg md:bottom-4 md:left-24 lg:hidden"
        >
          <span className="flex items-center gap-2">
            <Icon name="cart" /> {formatQty(itemCount)} item(s)
          </span>
          <span className="text-lg font-bold">{formatPeso(subtotal)}</span>
        </button>
      )}
      {cartOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40 lg:hidden" onClick={() => setCartOpen(false)}>
          <div className="flex h-[85dvh] w-full flex-col rounded-t-2xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center py-2">
              <button className="h-1.5 w-12 rounded-full bg-slate-300" onClick={() => setCartOpen(false)} aria-label="Close cart" />
            </div>
            {cartPanel}
          </div>
        </div>
      )}

      {notice && (
        <div className="fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg md:top-4">
          {notice}
        </div>
      )}

      <Modal open={scanning} onClose={() => setScanning(false)} title="Scan barcode" size="sm">
        <CameraScanner
          onDetected={(code) => {
            setScanning(false)
            if (!addByCode(code)) flash(`No product with barcode ${code}`)
          }}
        />
      </Modal>

      <PaymentModal open={paying} onClose={() => setPaying(false)} cart={cart} subtotal={subtotal} onPaid={onPaid} />

      <Modal open={!!lastSale} onClose={() => { setLastSale(null); searchRef.current?.focus() }} title="Sale complete" size="sm">
        {lastSale && (
          <div className="space-y-4">
            {lastSale.payment === 'cash' && (
              <div className="rounded-xl bg-brand-50 p-4 text-center">
                <div className="text-sm text-slate-600">Change</div>
                <div className="text-4xl font-bold text-brand-700">{formatPeso(lastSale.change)}</div>
              </div>
            )}
            <div className="rounded-lg border border-slate-200 p-3">
              <Receipt sale={lastSale} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-secondary" onClick={() => window.print()}>
                <Icon name="printer" /> Print
              </button>
              <button className="btn-primary" autoFocus onClick={() => { setLastSale(null); searchRef.current?.focus() }}>
                New sale
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
    >
      {children}
    </button>
  )
}

function EmptyState() {
  return (
    <div className="mx-auto mt-16 max-w-sm text-center text-slate-500">
      <Icon name="box" className="mx-auto h-12 w-12 text-slate-300" />
      <p className="mt-3">No products yet.</p>
      <p className="text-sm">Add some in the <b>Products</b> tab, or load sample data in <b>Settings</b>.</p>
    </div>
  )
}

interface CartPanelProps {
  cart: CartLine[]
  subtotal: number
  onQty: (id: number, qty: number) => void
  onClear: () => void
  onPay: () => void
}

function CartPanel({ cart, subtotal, onQty, onClear, onPay }: CartPanelProps) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">Cart</h2>
        {cart.length > 0 && (
          <button className="text-sm text-red-600 hover:underline" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
        {cart.length === 0 && <li className="p-8 text-center text-sm text-slate-400">Cart is empty</li>}
        {cart.map(({ product: p, qty }) => {
          const step = isFractionalUnit(p.unit) ? 0.25 : 1
          return (
            <li key={p.id} className="flex items-center gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {formatPeso(p.price)} / {p.unit}
                </div>
              </div>
              <div className="flex items-center rounded-lg ring-1 ring-slate-300">
                <button className="p-2 text-slate-600" onClick={() => onQty(p.id!, +(qty - step).toFixed(3))} aria-label="Decrease">
                  <Icon name="minus" className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={step}
                  value={qty}
                  onChange={(e) => onQty(p.id!, Math.max(0, +e.target.value))}
                  className="w-12 [appearance:textfield] bg-transparent text-center text-sm outline-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button className="p-2 text-slate-600" onClick={() => onQty(p.id!, +(qty + step).toFixed(3))} aria-label="Increase">
                  <Icon name="plus" className="h-4 w-4" />
                </button>
              </div>
              <div className="w-20 text-right text-sm font-semibold">{formatPeso(lineTotal(p.price, qty))}</div>
            </li>
          )
        })}
      </ul>
      <div className="space-y-3 border-t border-slate-200 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="flex items-baseline justify-between">
          <span className="text-slate-600">Total</span>
          <span className="text-2xl font-bold">{formatPeso(subtotal)}</span>
        </div>
        <button className="btn-primary w-full py-3.5 text-lg" disabled={cart.length === 0} onClick={onPay}>
          Pay
        </button>
      </div>
    </>
  )
}

interface PaymentModalProps {
  open: boolean
  onClose: () => void
  cart: CartLine[]
  subtotal: number
  onPaid: (sale: Sale) => void
}

const methods: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'gcash', label: 'GCash' },
  { id: 'maya', label: 'Maya' },
  { id: 'utang', label: 'Credit' },
]

const bills = [20, 50, 100, 200, 500, 1000]

function PaymentModal({ open, onClose, cart, subtotal, onPaid }: PaymentModalProps) {
  const settings = useSettings()
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), []) ?? []
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [tendered, setTendered] = useState('')
  const [reference, setReference] = useState('')
  const [customerId, setCustomerId] = useState<number | ''>('')
  const [newCustomer, setNewCustomer] = useState('')
  const [discountType, setDiscountType] = useState<DiscountType>('none')
  const [discountRef, setDiscountRef] = useState('')
  const [customDiscount, setCustomDiscount] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const discount =
    discountType === 'senior' || discountType === 'pwd'
      ? Math.round((subtotal * settings.seniorPwdPercent) / 100)
      : discountType === 'custom'
        ? Math.min(toCentavos(customDiscount), subtotal)
        : 0
  const total = subtotal - discount
  const cash = toCentavos(tendered)
  const change = cash - total

  const reset = () => {
    setMethod('cash')
    setTendered('')
    setReference('')
    setCustomerId('')
    setNewCustomer('')
    setDiscountType('none')
    setDiscountRef('')
    setCustomDiscount('')
    setError('')
  }

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      let cid = customerId || undefined
      if (method === 'utang' && !cid && newCustomer.trim()) {
        cid = await db.customers.add({ name: newCustomer.trim(), phone: '', balance: 0, createdAt: Date.now() })
      }
      const sale = await checkout({
        items: cart.map(({ product: p, qty }) => ({ productId: p.id!, name: p.name, unit: p.unit, price: p.price, cost: p.cost, qty })),
        discountType,
        discountRef: discountRef.trim() || undefined,
        discount,
        payment: method,
        tendered: method === 'cash' ? cash : total,
        reference: reference.trim() || undefined,
        customerId: method === 'utang' ? cid : undefined,
      })
      reset()
      onPaid(sale)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canPay =
    total >= 0 &&
    !busy &&
    (method !== 'cash' || cash >= total) &&
    (method !== 'utang' || !!customerId || !!newCustomer.trim())

  return (
    <Modal open={open} onClose={onClose} title="Payment">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (canPay) submit()
        }}
      >
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="flex justify-between text-sm text-slate-600">
            <span>Subtotal</span>
            <span>{formatPeso(subtotal)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-sm text-red-600">
              <span>Discount</span>
              <span>-{formatPeso(discount)}</span>
            </div>
          )}
          <div className="mt-1 flex items-baseline justify-between">
            <span className="font-medium">Total</span>
            <span className="text-3xl font-bold">{formatPeso(total)}</span>
          </div>
        </div>

        <div>
          <span className="label">Discount</span>
          <select className="input" value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)}>
            <option value="none">None</option>
            <option value="senior">Senior Citizen ({settings.seniorPwdPercent}%)</option>
            <option value="pwd">PWD ({settings.seniorPwdPercent}%)</option>
            <option value="custom">Custom amount</option>
          </select>
          {(discountType === 'senior' || discountType === 'pwd') && (
            <input className="input mt-2" placeholder="ID No. (optional)" value={discountRef} onChange={(e) => setDiscountRef(e.target.value)} />
          )}
          {discountType === 'custom' && (
            <input className="input mt-2" type="number" inputMode="decimal" step="0.01" min="0" placeholder="₱ amount" value={customDiscount} onChange={(e) => setCustomDiscount(e.target.value)} />
          )}
        </div>

        <div className="grid grid-cols-4 gap-2">
          {methods.map((m) => (
            <button
              type="button"
              key={m.id}
              onClick={() => setMethod(m.id)}
              className={`rounded-lg py-2.5 text-sm font-medium ring-1 ${method === m.id ? 'bg-brand-600 text-white ring-brand-600' : 'ring-slate-300'}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {method === 'cash' && (
          <div>
            <label className="label" htmlFor="tendered">Cash received</label>
            <input
              id="tendered"
              autoFocus
              className="input text-xl font-semibold"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
            />
            <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
              <button type="button" className="btn-secondary px-2 text-sm" onClick={() => setTendered((total / 100).toFixed(2))}>
                Exact
              </button>
              {bills.map((b) => (
                <button type="button" key={b} className="btn-secondary px-2 text-sm" onClick={() => setTendered(String(b))}>
                  ₱{b}
                </button>
              ))}
            </div>
            {tendered && (
              <div className={`mt-3 flex justify-between rounded-lg p-3 text-lg font-semibold ${change >= 0 ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600'}`}>
                <span>{change >= 0 ? 'Change' : 'Short'}</span>
                <span>{formatPeso(Math.abs(change))}</span>
              </div>
            )}
          </div>
        )}

        {(method === 'gcash' || method === 'maya') && (
          <div>
            <label className="label" htmlFor="ref">Reference No. (optional)</label>
            <input id="ref" className="input" inputMode="numeric" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        )}

        {method === 'utang' && (
          <div className="space-y-2">
            <label className="label" htmlFor="cust">Customer</label>
            <select id="cust" className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value ? +e.target.value : '')}>
              <option value="">— New customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (owes {formatPeso(c.balance)})
                </option>
              ))}
            </select>
            {!customerId && (
              <input className="input" placeholder="New customer name" value={newCustomer} onChange={(e) => setNewCustomer(e.target.value)} />
            )}
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <button type="submit" className="btn-primary w-full py-3.5 text-lg" disabled={!canPay}>
          Complete sale
        </button>
      </form>
    </Modal>
  )
}
