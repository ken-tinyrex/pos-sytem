import { useEffect, useMemo, useRef, useState } from 'react'
import { orderBy, query as fsQuery, where } from 'firebase/firestore'
import { addCustomer, checkout, type Customer, type DiscountType, type PaymentMethod, type Product, type Sale } from '../lib/db'
import { col } from '../lib/firebase'
import { formatPeso, formatQty, lineTotal, toCentavos } from '../lib/money'
import { useCollection, useSettings } from '../lib/hooks'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import Receipt from '../components/Receipt'
import CameraScanner, { cameraScanSupported } from '../components/CameraScanner'
import { beep } from '../lib/beep'

interface CartLine {
  product: Product
  qty: number
}

const isFractionalUnit = (unit: string) => ['kg', 'g', 'l', 'liter', 'ml'].includes(unit.toLowerCase())

const CAMERA_PREF_KEY = 'pos.cameraOn'
const readCameraPref = () => {
  try {
    return localStorage.getItem(CAMERA_PREF_KEY) === '1'
  } catch {
    return false
  }
}

const isEditable = (el: Element | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

export default function PosPage() {
  const activeProducts = useCollection<Product>(() => fsQuery(col('products'), where('active', '==', true)), [])
  const products = useMemo(() => [...(activeProducts ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [activeProducts])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [cartOpen, setCartOpen] = useState(false) // mobile sheet
  const [paying, setPaying] = useState(false)
  const [cameraOn, setCameraOn] = useState(() => cameraScanSupported() && readCameraPref())
  const [lastSale, setLastSale] = useState<Sale | null>(null)
  const { allowOversell } = useSettings()
  const [notice, setNotice] = useState<{ msg: string; tone?: 'error' | 'warn' } | null>(null)
  const noticeTimer = useRef<number>(undefined)
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

  const flash = (msg: string, tone?: 'error' | 'warn') => {
    setNotice({ msg, tone })
    clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), tone ? 3500 : 2000)
  }

  // Live stock levels, so the cart can't hold more than what's on the shelf
  // (unless overselling is allowed in Settings, then it only warns).
  const stockById = useMemo(() => new Map(products.map((p) => [p.id, p.stock])), [products])
  const stockOf = (id: string) => stockById.get(id) ?? 0

  const warnStock = (product: Product) => {
    const stock = stockOf(product.id)
    beep(false)
    navigator.vibrate?.([60, 40, 60])
    if (allowOversell) {
      flash(`Over recorded stock (${formatQty(stock)} ${product.unit}) for ${product.name} — please recount`, 'warn')
    } else {
      flash(
        stock <= 0 ? `${product.name} is out of stock` : `No more stock — only ${formatQty(stock)} ${product.unit} of ${product.name} available`,
        'error',
      )
    }
  }

  /** Returns false (and warns) when there isn't enough stock and overselling is off. */
  const addToCart = (product: Product, qty = 1) => {
    const inCart = cart.find((l) => l.product.id === product.id)?.qty ?? 0
    if (inCart + qty > stockOf(product.id)) {
      warnStock(product)
      if (!allowOversell) return false
    }
    setCart((c) => {
      const existing = c.find((l) => l.product.id === product.id)
      if (existing) return c.map((l) => (l === existing ? { ...l, qty: +(l.qty + qty).toFixed(3) } : l))
      return [...c, { product, qty }]
    })
    return true
  }

  const setQty = (id: string, qty: number) => {
    const line = cart.find((l) => l.product.id === id)
    if (line && qty > stockOf(id) && qty > line.qty) {
      warnStock(line.product)
      if (!allowOversell) qty = Math.max(0, stockOf(id))
    }
    setCart((c) => (qty <= 0 ? c.filter((l) => l.product.id !== id) : c.map((l) => (l.product.id === id ? { ...l, qty } : l))))
  }

  const addByCode = (code: string) => {
    const match = products.find((p) => p.barcode && p.barcode === code.trim())
    if (match) {
      if (addToCart(match)) {
        flash(`+ ${match.name}`)
        beep()
      }
      return true
    }
    return false
  }

  const onScanned = (code: string) => {
    if (paying) return
    setLastSale(null) // a scan on the receipt screen starts the next sale
    if (!addByCode(code)) {
      beep(false)
      flash(`No product with barcode ${code}`, 'error')
    }
  }

  const toggleCamera = () => {
    const next = !cameraOn
    setCameraOn(next)
    try {
      localStorage.setItem(CAMERA_PREF_KEY, next ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }

  // Hardware scanners type the code very fast and end with Enter. Catch that anywhere
  // on this page (not just in the search box), as long as the user isn't typing in a field.
  const onScannedRef = useRef(onScanned)
  onScannedRef.current = onScanned
  useEffect(() => {
    let buffer = ''
    let lastKey = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(document.activeElement)) return
      const now = performance.now()
      if (now - lastKey > 50) buffer = '' // human typing speed: start over
      lastKey = now
      if (e.key === 'Enter') {
        if (buffer.length >= 4) {
          e.preventDefault()
          onScannedRef.current(buffer)
        }
        buffer = ''
      } else if (e.key.length === 1) {
        buffer += e.key
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // USB/Bluetooth barcode scanners type the code then press Enter.
  const onSearchEnter = () => {
    if (!query.trim()) return
    if (addByCode(query)) return setQuery('')
    if (filtered.length === 1) {
      if (addToCart(filtered[0])) flash(`+ ${filtered[0].name}`)
      setQuery('')
    } else if (filtered.length === 0) flash('No product found', 'error')
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
      stockOf={stockOf}
      allowOversell={allowOversell}
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
              <button
                className={cameraOn ? 'btn-primary px-3' : 'btn-secondary px-3'}
                onClick={toggleCamera}
                aria-label={cameraOn ? 'Turn off camera scanner' : 'Turn on camera scanner'}
                aria-pressed={cameraOn}
              >
                <Icon name="scan" />
              </button>
            )}
          </div>
          {cameraOn && (
            <div className="relative">
              <CameraScanner continuous onDetected={onScanned} className="h-36 sm:h-48" />
              <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">Scanning…</span>
            </div>
          )}
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
                const out = p.stock <= 0
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className={`card relative flex min-h-24 flex-col justify-between p-3 text-left transition hover:ring-brand-500 active:scale-[.98] ${inCart ? 'ring-2 ring-brand-500' : ''} ${out ? 'opacity-50' : ''}`}
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
                        {out ? 'Out of stock' : `${formatQty(p.stock)} ${p.unit}`}
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
        <div
          role={notice.tone ? 'alert' : 'status'}
          className={`fixed top-16 left-1/2 z-50 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl px-4 py-2.5 text-center text-sm text-white shadow-lg md:top-4 ${
            notice.tone === 'error' ? 'bg-red-600 font-semibold' : notice.tone === 'warn' ? 'bg-amber-500 font-semibold' : 'bg-slate-900'
          }`}
        >
          {notice.tone && '⚠ '}
          {notice.msg}
        </div>
      )}

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
  stockOf: (id: string) => number
  allowOversell: boolean
  onQty: (id: string, qty: number) => void
  onClear: () => void
  onPay: () => void
}

function CartPanel({ cart, subtotal, stockOf, allowOversell, onQty, onClear, onPay }: CartPanelProps) {
  // Stock can drop while items sit in the cart (e.g. a sale in another tab).
  const blocked = !allowOversell && cart.some((l) => l.qty > stockOf(l.product.id))
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
          const stock = stockOf(p.id)
          return (
            <li key={p.id} className="flex items-center gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {formatPeso(p.price)} / {p.unit}
                </div>
                {qty > stock && (
                  <div className={`text-xs font-semibold ${allowOversell ? 'text-amber-600' : 'text-red-600'}`}>
                    {stock <= 0 ? 'Out of stock' : `Only ${formatQty(stock)} in stock`}
                  </div>
                )}
              </div>
              <div className="flex items-center rounded-lg ring-1 ring-slate-300">
                <button className="p-2 text-slate-600" onClick={() => onQty(p.id, +(qty - step).toFixed(3))} aria-label="Decrease">
                  <Icon name="minus" className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={allowOversell ? undefined : stock}
                  step={step}
                  value={qty}
                  onChange={(e) => onQty(p.id, Math.max(0, +e.target.value))}
                  className="w-12 [appearance:textfield] bg-transparent text-center text-sm outline-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  className="p-2 text-slate-600 disabled:opacity-30"
                  disabled={!allowOversell && qty + step > stock}
                  onClick={() => onQty(p.id, +(qty + step).toFixed(3))}
                  aria-label="Increase"
                >
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
        {blocked && <p className="text-sm text-red-600">Reduce the items marked in red to continue.</p>}
        <button className="btn-primary w-full py-3.5 text-lg" disabled={cart.length === 0 || blocked} onClick={onPay}>
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
  const customers = useCollection<Customer>(() => fsQuery(col('customers'), orderBy('name')), []) ?? []
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [tendered, setTendered] = useState('')
  const [reference, setReference] = useState('')
  const [customerId, setCustomerId] = useState('')
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
        cid = addCustomer(newCustomer.trim())
      }
      const sale = await checkout({
        items: cart.map(({ product: p, qty }) => ({ productId: p.id, name: p.name, unit: p.unit, price: p.price, cost: p.cost, qty })),
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
            <select id="cust" className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
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
