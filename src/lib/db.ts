import {
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  increment,
  setDoc,
  writeBatch,
  type DocumentReference,
  type WriteBatch,
} from 'firebase/firestore'
import { col, fs, settingsRef } from './firebase'
import { lineTotal } from './money'

export type PaymentMethod = 'cash' | 'gcash' | 'maya' | 'utang'
export type DiscountType = 'none' | 'senior' | 'pwd' | 'custom'

export interface Product {
  id: string
  name: string
  barcode: string
  category: string
  unit: string // pc, pack, kg, bottle...
  price: number // centavos
  cost: number // centavos
  stock: number
  lowStock: number
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface SaleItem {
  productId: string
  name: string
  unit: string
  price: number
  cost: number
  qty: number
}

export interface Sale {
  id: string
  receiptNo: string
  createdAt: number
  items: SaleItem[]
  subtotal: number
  discountType: DiscountType
  discountRef?: string // Senior/PWD ID no.
  discount: number
  total: number
  payment: PaymentMethod
  tendered: number
  change: number
  reference?: string // GCash / Maya ref no.
  customerId?: string
  status: 'completed' | 'voided'
  voidedAt?: number
}

export interface Customer {
  id: string
  name: string
  phone: string
  balance: number // centavos owed
  createdAt: number
}

export interface CreditEntry {
  id: string
  customerId: string
  createdAt: number
  type: 'charge' | 'payment' | 'void'
  amount: number // positive centavos
  saleId?: string
  note?: string
}

export interface StockMove {
  id: string
  productId: string
  createdAt: number
  qty: number // delta
  reason: 'sale' | 'restock' | 'adjust' | 'void'
  saleId?: string
  note?: string
}

export interface StoreSettings {
  storeName: string
  address: string
  tin: string
  contact: string
  receiptFooter: string
  seniorPwdPercent: number
  vatRegistered: boolean
  /** Let sales go through when recorded stock is too low (stock goes negative). */
  allowOversell: boolean
}

export const defaultSettings: StoreSettings = {
  storeName: 'Kiko Store',
  address: '',
  tin: '',
  contact: '',
  receiptFooter: 'Thank you! Please come again.',
  seniorPwdPercent: 5,
  vatRegistered: false,
  allowOversell: false,
}

// ---------- Writes ----------
// Firestore applies writes to the local cache immediately and syncs them in the
// background, so we don't await the server — that would hang while offline.

export const SYNC_ERROR_EVENT = 'pos:sync-error'

function commit(batch: WriteBatch) {
  batch.commit().catch((e: Error) => {
    console.error(e)
    window.dispatchEvent(new CustomEvent(SYNC_ERROR_EVENT, { detail: e.message }))
  })
}

const newRef = (name: Parameters<typeof col>[0]) => doc(col(name))

/** Read from the local cache (kept fresh by live listeners); fall back to the server. */
async function readDoc<T>(ref: DocumentReference): Promise<T | undefined> {
  const snap = await getDocFromCache(ref).catch(() => getDoc(ref))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : undefined
}

export async function getSettings(): Promise<StoreSettings> {
  const snap = await getDocFromCache(settingsRef).catch(() => getDoc(settingsRef))
  return { ...defaultSettings, ...(snap.exists() ? snap.data() : {}) }
}

export function saveSettings(patch: Partial<StoreSettings>) {
  setDoc(settingsRef, patch, { merge: true }).catch((e: Error) =>
    window.dispatchEvent(new CustomEvent(SYNC_ERROR_EVENT, { detail: e.message })),
  )
}

export type ProductInput = Omit<Product, 'id' | 'stock' | 'active' | 'createdAt' | 'updatedAt'>

export function createProduct(data: ProductInput, initialStock: number) {
  const now = Date.now()
  const ref = newRef('products')
  const batch = writeBatch(fs)
  batch.set(ref, { ...data, stock: initialStock, active: true, createdAt: now, updatedAt: now })
  if (initialStock) {
    batch.set(newRef('stockMoves'), { productId: ref.id, createdAt: now, qty: initialStock, reason: 'restock', note: 'Initial stock' })
  }
  commit(batch)
  return ref.id
}

export function updateProduct(id: string, patch: Partial<Omit<Product, 'id' | 'stock'>>) {
  const batch = writeBatch(fs)
  batch.update(doc(col('products'), id), { ...patch, updatedAt: Date.now() })
  commit(batch)
}

export function addCustomer(name: string, phone = '') {
  const ref = newRef('customers')
  const batch = writeBatch(fs)
  batch.set(ref, { name, phone, balance: 0, createdAt: Date.now() })
  commit(batch)
  return ref.id
}

export function updateCustomer(id: string, patch: Pick<Customer, 'name' | 'phone'>) {
  const batch = writeBatch(fs)
  batch.update(doc(col('customers'), id), patch)
  commit(batch)
}

// Receipt numbers are per device ("K7Q-000123") because devices can't share a
// counter while offline.
function nextReceiptNo() {
  try {
    let code = localStorage.getItem('pos.deviceCode')
    if (!code) {
      code = Math.random().toString(36).slice(2, 5).toUpperCase().padEnd(3, 'X')
      localStorage.setItem('pos.deviceCode', code)
    }
    const n = Number(localStorage.getItem('pos.receiptCounter') || 0) + 1
    localStorage.setItem('pos.receiptCounter', String(n))
    return `${code}-${String(n).padStart(6, '0')}`
  } catch {
    return `T-${Date.now()}`
  }
}

export interface CheckoutInput {
  items: SaleItem[]
  discountType: DiscountType
  discountRef?: string
  discount: number
  payment: PaymentMethod
  tendered: number
  reference?: string
  customerId?: string
}

export async function checkout(input: CheckoutInput): Promise<Sale> {
  const subtotal = input.items.reduce((s, i) => s + lineTotal(i.price, i.qty), 0)
  const discount = Math.min(input.discount, subtotal)
  const total = subtotal - discount
  if (input.payment === 'cash' && input.tendered < total) throw new Error('Insufficient cash.')
  if (input.payment === 'utang' && !input.customerId) throw new Error('Select a customer for credit.')

  // Re-check stock against the latest known levels (other devices' sales arrive via sync).
  const settings = await getSettings()
  if (!settings.allowOversell) {
    const short: string[] = []
    for (const item of input.items) {
      const p = await readDoc<Product>(doc(col('products'), item.productId))
      const stock = p?.stock ?? 0
      if (item.qty > stock) short.push(`${item.name} (${stock} left)`)
    }
    if (short.length) throw new Error(`Not enough stock: ${short.join(', ')}`)
  }

  const now = Date.now()
  const ref = newRef('sales')
  const sale: Sale = {
    id: ref.id,
    receiptNo: nextReceiptNo(),
    createdAt: now,
    items: input.items,
    subtotal,
    discountType: input.discountType,
    discountRef: input.discountRef,
    discount,
    total,
    payment: input.payment,
    tendered: input.payment === 'cash' ? input.tendered : total,
    change: input.payment === 'cash' ? input.tendered - total : 0,
    reference: input.reference,
    customerId: input.customerId,
    status: 'completed',
  }

  const batch = writeBatch(fs)
  const { id: _id, ...saleData } = sale
  void _id
  batch.set(ref, saleData)
  // increment() merges correctly even when several devices sell offline at once.
  for (const item of input.items) {
    batch.update(doc(col('products'), item.productId), { stock: increment(-item.qty), updatedAt: now })
    batch.set(newRef('stockMoves'), { productId: item.productId, createdAt: now, qty: -item.qty, reason: 'sale', saleId: ref.id })
  }
  if (input.payment === 'utang' && input.customerId) {
    batch.update(doc(col('customers'), input.customerId), { balance: increment(total) })
    batch.set(newRef('credits'), {
      customerId: input.customerId, createdAt: now, type: 'charge', amount: total, saleId: ref.id, note: `Receipt #${sale.receiptNo}`,
    })
  }
  commit(batch)
  return sale
}

export async function voidSale(sale: Sale) {
  const latest = await readDoc<Sale>(doc(col('sales'), sale.id))
  if (!latest || latest.status === 'voided') return
  const now = Date.now()
  const batch = writeBatch(fs)
  for (const item of latest.items) {
    batch.update(doc(col('products'), item.productId), { stock: increment(item.qty), updatedAt: now })
    batch.set(newRef('stockMoves'), { productId: item.productId, createdAt: now, qty: item.qty, reason: 'void', saleId: sale.id })
  }
  if (latest.payment === 'utang' && latest.customerId) {
    batch.update(doc(col('customers'), latest.customerId), { balance: increment(-latest.total) })
    batch.set(newRef('credits'), {
      customerId: latest.customerId, createdAt: now, type: 'void', amount: latest.total, saleId: sale.id, note: `Voided #${latest.receiptNo}`,
    })
  }
  batch.update(doc(col('sales'), sale.id), { status: 'voided', voidedAt: now })
  commit(batch)
}

export function adjustStock(productId: string, delta: number, reason: 'restock' | 'adjust', note?: string) {
  const now = Date.now()
  const batch = writeBatch(fs)
  batch.update(doc(col('products'), productId), { stock: increment(delta), updatedAt: now })
  batch.set(newRef('stockMoves'), { productId, createdAt: now, qty: delta, reason, note })
  commit(batch)
}

export function recordPayment(customerId: string, amount: number, note?: string) {
  const batch = writeBatch(fs)
  batch.update(doc(col('customers'), customerId), { balance: increment(-amount) })
  batch.set(newRef('credits'), { customerId, createdAt: Date.now(), type: 'payment', amount, note })
  commit(batch)
}

// ---------- Backup / restore ----------

const tables = ['products', 'sales', 'customers', 'credits', 'stockMoves'] as const
type Row = Record<string, unknown>

export async function exportBackup() {
  const data: Record<string, Row[]> = {}
  for (const t of tables) data[t] = (await getDocs(col(t))).docs.map((d) => ({ id: d.id, ...d.data() }))
  data.settings = [{ key: 'store', value: await getSettings() }]
  return { app: 'tindahan-pos', version: 2, exportedAt: new Date().toISOString(), data }
}

/**
 * Upserts a backup into the shared database. Accepts both v2 (shared database) and
 * v1 (older on-device) backups, whose numeric ids are converted to strings.
 */
export function importBackup(json: unknown) {
  const backup = json as { app?: string; data?: Record<string, Row[]> }
  if (backup?.app !== 'tindahan-pos' || !backup.data) throw new Error('Invalid backup file.')
  const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v))

  const writes: [DocumentReference, Row][] = []
  for (const t of tables) {
    for (const row of backup.data[t] ?? []) {
      const { id, ...rest } = row
      if (id === undefined) continue
      const data: Row = { ...rest }
      if (t === 'products') data.active = data.active === undefined ? true : Boolean(data.active)
      if (t === 'sales') {
        data.customerId = str(data.customerId)
        data.items = ((data.items as Row[]) ?? []).map((i) => ({ ...i, productId: str(i.productId) }))
      }
      if (t === 'credits' || t === 'stockMoves') data.saleId = str(data.saleId)
      if (t === 'credits') data.customerId = str(data.customerId)
      if (t === 'stockMoves') data.productId = str(data.productId)
      writes.push([doc(col(t), String(id)), data])
    }
  }
  const settingsRow = (backup.data.settings ?? []).find((r) => r.key === 'store')
  if (settingsRow?.value) {
    const { nextReceiptNo: _n, ...s } = settingsRow.value as Row
    void _n
    writes.push([settingsRef, s])
  }

  // Firestore batches are limited to 500 writes.
  for (let i = 0; i < writes.length; i += 450) {
    const batch = writeBatch(fs)
    for (const [ref, data] of writes.slice(i, i + 450)) batch.set(ref, data)
    commit(batch)
  }
  return writes.length
}

export function loadSampleProducts() {
  const now = Date.now()
  const p = (name: string, category: string, unit: string, price: number, cost: number, stock: number, barcode = '') => ({
    name, category, unit, price: Math.round(price * 100), cost: Math.round(cost * 100), stock, lowStock: 5, barcode, active: true, createdAt: now, updatedAt: now,
  })
  const items = [
    p('Lucky Me Pancit Canton Original', 'Noodles', 'pack', 17, 14, 48, '4807770270017'),
    p('Lucky Me Beef Mami', 'Noodles', 'pack', 12, 10, 36),
    p('Nissin Cup Noodles Seafood', 'Noodles', 'cup', 30, 25, 24),
    p('Argentina Corned Beef 150g', 'Canned Goods', 'can', 42, 36, 20),
    p('555 Sardines Tomato Sauce 155g', 'Canned Goods', 'can', 25, 21, 30),
    p('Century Tuna Flakes in Oil 155g', 'Canned Goods', 'can', 38, 32, 18),
    p('Bear Brand Powdered Milk 33g', 'Dairy', 'sachet', 14, 12, 50),
    p('Nescafé 3in1 Original', 'Coffee', 'sachet', 9, 7.5, 100),
    p('Kopiko Brown Coffee', 'Coffee', 'sachet', 9, 7.5, 80),
    p('Coca-Cola 290ml', 'Beverages', 'bottle', 20, 16, 24),
    p('Royal Tru-Orange 1.5L', 'Beverages', 'bottle', 75, 65, 6),
    p('Rice (Dinorado)', 'Rice', 'kg', 58, 50, 25),
    p('Brown Sugar', 'Condiments', 'kg', 80, 70, 10),
    p('Silver Swan Soy Sauce 200ml', 'Condiments', 'pack', 15, 12, 20),
    p('Datu Puti Vinegar 200ml', 'Condiments', 'pack', 14, 11, 20),
    p('Egg (Medium)', 'Fresh', 'pc', 8, 6.5, 60),
    p('Pandesal', 'Bread', 'pc', 3, 2.2, 3),
    p('Safeguard Soap 60g', 'Toiletries', 'pc', 28, 23, 15),
    p('Surf Powder 65g', 'Toiletries', 'sachet', 9, 7, 40),
    p('Head & Shoulders Shampoo 12ml', 'Toiletries', 'sachet', 8, 6.5, 2),
  ]
  const batch = writeBatch(fs)
  for (const item of items) batch.set(newRef('products'), item)
  commit(batch)
}
