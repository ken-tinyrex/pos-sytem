import Dexie, { type EntityTable } from 'dexie'
import { lineTotal } from './money'

export type PaymentMethod = 'cash' | 'gcash' | 'maya' | 'utang'
export type DiscountType = 'none' | 'senior' | 'pwd' | 'custom'

export interface Product {
  id?: number
  name: string
  barcode: string
  category: string
  unit: string // pc, pack, kg, bottle...
  price: number // centavos
  cost: number // centavos
  stock: number
  lowStock: number
  active: number // 1 | 0 (indexable)
  createdAt: number
  updatedAt: number
}

export interface SaleItem {
  productId: number
  name: string
  unit: string
  price: number
  cost: number
  qty: number
}

export interface Sale {
  id?: number
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
  customerId?: number
  status: 'completed' | 'voided'
  voidedAt?: number
}

export interface Customer {
  id?: number
  name: string
  phone: string
  balance: number // centavos owed
  createdAt: number
}

export interface CreditEntry {
  id?: number
  customerId: number
  createdAt: number
  type: 'charge' | 'payment' | 'void'
  amount: number // positive centavos
  saleId?: number
  note?: string
}

export interface StockMove {
  id?: number
  productId: number
  createdAt: number
  qty: number // delta
  reason: 'sale' | 'restock' | 'adjust' | 'void'
  saleId?: number
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
  nextReceiptNo: number
}

export const defaultSettings: StoreSettings = {
  storeName: 'My Tindahan',
  address: '',
  tin: '',
  contact: '',
  receiptFooter: 'Thank you! Please come again.',
  seniorPwdPercent: 5,
  vatRegistered: false,
  nextReceiptNo: 1,
}

interface SettingsRow {
  key: string
  value: StoreSettings
}

export const db = new Dexie('tindahan-pos') as Dexie & {
  products: EntityTable<Product, 'id'>
  sales: EntityTable<Sale, 'id'>
  customers: EntityTable<Customer, 'id'>
  credits: EntityTable<CreditEntry, 'id'>
  stockMoves: EntityTable<StockMove, 'id'>
  settings: EntityTable<SettingsRow, 'key'>
}

db.version(1).stores({
  products: '++id, name, barcode, category, active',
  sales: '++id, receiptNo, createdAt, payment, status, customerId',
  customers: '++id, name',
  credits: '++id, customerId, createdAt',
  stockMoves: '++id, productId, createdAt',
  settings: 'key',
})

export async function getSettings(): Promise<StoreSettings> {
  const row = await db.settings.get('store')
  return { ...defaultSettings, ...row?.value }
}

export async function saveSettings(patch: Partial<StoreSettings>) {
  await db.transaction('rw', db.settings, async () => {
    const current = await getSettings()
    await db.settings.put({ key: 'store', value: { ...current, ...patch } })
  })
}

export interface CheckoutInput {
  items: SaleItem[]
  discountType: DiscountType
  discountRef?: string
  discount: number
  payment: PaymentMethod
  tendered: number
  reference?: string
  customerId?: number
}

export async function checkout(input: CheckoutInput): Promise<Sale> {
  const subtotal = input.items.reduce((s, i) => s + lineTotal(i.price, i.qty), 0)
  const discount = Math.min(input.discount, subtotal)
  const total = subtotal - discount
  if (input.payment === 'cash' && input.tendered < total) throw new Error('Insufficient cash.')
  if (input.payment === 'utang' && !input.customerId) throw new Error('Select a customer for credit.')

  return db.transaction('rw', [db.products, db.sales, db.stockMoves, db.customers, db.credits, db.settings], async () => {
    const settings = await getSettings()
    const now = Date.now()
    const sale: Sale = {
      receiptNo: String(settings.nextReceiptNo).padStart(6, '0'),
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
    sale.id = await db.sales.add(sale)
    await db.settings.put({ key: 'store', value: { ...settings, nextReceiptNo: settings.nextReceiptNo + 1 } })

    for (const item of input.items) {
      const p = await db.products.get(item.productId)
      if (!p) continue
      await db.products.update(item.productId, { stock: round3(p.stock - item.qty), updatedAt: now })
      await db.stockMoves.add({ productId: item.productId, createdAt: now, qty: -item.qty, reason: 'sale', saleId: sale.id })
    }

    if (input.payment === 'utang' && input.customerId) {
      const c = await db.customers.get(input.customerId)
      if (!c) throw new Error('Customer not found.')
      await db.customers.update(c.id!, { balance: c.balance + total })
      await db.credits.add({ customerId: c.id!, createdAt: now, type: 'charge', amount: total, saleId: sale.id, note: `Receipt #${sale.receiptNo}` })
    }
    return sale
  })
}

export async function voidSale(saleId: number) {
  await db.transaction('rw', [db.products, db.sales, db.stockMoves, db.customers, db.credits], async () => {
    const sale = await db.sales.get(saleId)
    if (!sale || sale.status === 'voided') return
    const now = Date.now()
    for (const item of sale.items) {
      const p = await db.products.get(item.productId)
      if (!p) continue
      await db.products.update(p.id!, { stock: round3(p.stock + item.qty), updatedAt: now })
      await db.stockMoves.add({ productId: p.id!, createdAt: now, qty: item.qty, reason: 'void', saleId })
    }
    if (sale.payment === 'utang' && sale.customerId) {
      const c = await db.customers.get(sale.customerId)
      if (c) {
        await db.customers.update(c.id!, { balance: c.balance - sale.total })
        await db.credits.add({ customerId: c.id!, createdAt: now, type: 'void', amount: sale.total, saleId, note: `Voided #${sale.receiptNo}` })
      }
    }
    await db.sales.update(saleId, { status: 'voided', voidedAt: now })
  })
}

export async function adjustStock(productId: number, delta: number, reason: 'restock' | 'adjust', note?: string) {
  await db.transaction('rw', [db.products, db.stockMoves], async () => {
    const p = await db.products.get(productId)
    if (!p) return
    const now = Date.now()
    await db.products.update(productId, { stock: round3(p.stock + delta), updatedAt: now })
    await db.stockMoves.add({ productId, createdAt: now, qty: delta, reason, note })
  })
}

export async function recordPayment(customerId: number, amount: number, note?: string) {
  await db.transaction('rw', [db.customers, db.credits], async () => {
    const c = await db.customers.get(customerId)
    if (!c) return
    await db.customers.update(customerId, { balance: c.balance - amount })
    await db.credits.add({ customerId, createdAt: Date.now(), type: 'payment', amount, note })
  })
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

// ---------- Backup / restore ----------

const tables = ['products', 'sales', 'customers', 'credits', 'stockMoves', 'settings'] as const

export async function exportBackup() {
  const data: Record<string, unknown[]> = {}
  for (const t of tables) data[t] = await db.table(t).toArray()
  return { app: 'tindahan-pos', version: 1, exportedAt: new Date().toISOString(), data }
}

export async function importBackup(json: unknown) {
  const backup = json as { app?: string; data?: Record<string, unknown[]> }
  if (backup?.app !== 'tindahan-pos' || !backup.data) throw new Error('Invalid backup file.')
  await db.transaction('rw', tables.map((t) => db.table(t)), async () => {
    for (const t of tables) {
      await db.table(t).clear()
      await db.table(t).bulkAdd(backup.data![t] ?? [])
    }
  })
}

export async function loadSampleProducts() {
  const now = Date.now()
  const p = (name: string, category: string, unit: string, price: number, cost: number, stock: number, barcode = ''): Product => ({
    name, category, unit, price: price * 100, cost: cost * 100, stock, lowStock: 5, barcode, active: 1, createdAt: now, updatedAt: now,
  })
  await db.products.bulkAdd([
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
  ])
}
