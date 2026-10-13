import type { Sale } from '../lib/db'
import { formatPeso, formatQty, lineTotal } from '../lib/money'
import { formatDateTime } from '../lib/dates'
import { useDocument, useSettings } from '../lib/hooks'
import { doc } from 'firebase/firestore'
import { col } from '../lib/firebase'
import type { Customer } from '../lib/db'

const paymentLabel = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', utang: 'Credit' }
const discountLabel = { none: '', senior: 'Senior Citizen', pwd: 'PWD', custom: 'Discount' }

export default function Receipt({ sale }: { sale: Sale }) {
  const s = useSettings()
  const customer = useDocument<Customer>(() => (sale.customerId ? doc(col('customers'), sale.customerId) : null), [sale.customerId])

  return (
    <div className="print-area mx-auto w-full max-w-[300px] font-mono text-xs leading-relaxed text-black">
      <div className="text-center">
        <div className="text-sm font-bold">{s.storeName}</div>
        {s.address && <div>{s.address}</div>}
        {s.contact && <div>{s.contact}</div>}
        {s.tin && <div>TIN: {s.tin}</div>}
        {!s.vatRegistered && s.tin && <div>NON-VAT REG.</div>}
      </div>
      <Divider />
      <div className="flex justify-between"><span>Receipt #{sale.receiptNo}</span></div>
      <div>{formatDateTime(sale.createdAt)}</div>
      {sale.status === 'voided' && <div className="my-1 text-center font-bold">*** VOIDED ***</div>}
      <Divider />
      {sale.items.map((i, idx) => (
        <div key={idx}>
          <div>{i.name}</div>
          <div className="flex justify-between pl-2">
            <span>{formatQty(i.qty)} {i.unit} x {formatPeso(i.price)}</span>
            <span>{formatPeso(lineTotal(i.price, i.qty))}</span>
          </div>
        </div>
      ))}
      <Divider />
      <Row label="Subtotal" value={formatPeso(sale.subtotal)} />
      {sale.discount > 0 && (
        <Row label={`Less: ${discountLabel[sale.discountType]}${sale.discountRef ? ` (${sale.discountRef})` : ''}`} value={`-${formatPeso(sale.discount)}`} />
      )}
      <Row label="TOTAL" value={formatPeso(sale.total)} bold />
      <Row label={paymentLabel[sale.payment]} value={formatPeso(sale.tendered)} />
      {sale.payment === 'cash' && <Row label="Change" value={formatPeso(sale.change)} />}
      {sale.reference && <Row label="Ref #" value={sale.reference} />}
      {customer && <Row label="Customer" value={customer.name} />}
      <Divider />
      <div className="text-center">{s.receiptFooter}</div>
      {!s.vatRegistered && <div className="mt-1 text-center text-[10px]">This is not an official receipt.</div>}
    </div>
  )
}

const Divider = () => <div className="my-1 border-t border-dashed border-black" />

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'text-sm font-bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
