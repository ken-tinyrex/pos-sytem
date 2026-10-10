// All money is stored as integer centavos to avoid floating-point errors.
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

export const formatPeso = (centavos: number) => peso.format(centavos / 100)

export const toCentavos = (pesos: number | string) => {
  const n = typeof pesos === 'string' ? parseFloat(pesos) : pesos
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export const toPesos = (centavos: number) => centavos / 100

export const lineTotal = (price: number, qty: number) => Math.round(price * qty)

export const formatQty = (qty: number) => (Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/0+$/, ''))
