export const startOfDay = (d = new Date()) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

export const endOfDay = (d = new Date()) => {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x.getTime()
}

/** yyyy-mm-dd in local time, for <input type="date"> */
export const toDateInput = (t: number | Date) => {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const fromDateInput = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const dateTime = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
export const formatDateTime = (t: number) => dateTime.format(t)
