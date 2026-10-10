import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, exportBackup, getSettings, importBackup, loadSampleProducts, saveSettings, type StoreSettings } from '../lib/db'

export default function SettingsPage() {
  // Read once, then let the form own its state.
  const initial = useLiveQuery(() => getSettings(), [])
  return initial ? <SettingsForm initial={initial} /> : null
}

function SettingsForm({ initial }: { initial: StoreSettings }) {
  const [form, setForm] = useState<StoreSettings>(initial)
  const [saved, setSaved] = useState(false)
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const productCount = useLiveQuery(() => db.products.count(), []) ?? 0

  const set = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const { nextReceiptNo, ...rest } = form // receipt counter is owned by checkout
    void nextReceiptNo
    await saveSettings(rest)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const download = async () => {
    const backup = await exportBackup()
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `tindahan-pos-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    localStorage.setItem('lastBackup', String(Date.now()))
    setMessage('Backup downloaded.')
  }

  const restore = async (file: File) => {
    if (!confirm('This will replace ALL current data. Continue?')) return
    try {
      await importBackup(JSON.parse(await file.text()))
      setMessage('Backup restored.')
      location.reload()
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`)
    }
  }

  const lastBackup = Number(localStorage.getItem('lastBackup') || 0)

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-3 sm:p-4">
      <h1 className="text-xl font-bold">Settings</h1>

      <form onSubmit={save} className="card space-y-3 p-4">
        <h2 className="font-semibold">Store information (for receipts)</h2>
        <Field label="Store name" value={form.storeName} onChange={(v) => set('storeName', v)} required />
        <Field label="Address" value={form.address} onChange={(v) => set('address', v)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact no." value={form.contact} onChange={(v) => set('contact', v)} />
          <Field label="TIN" value={form.tin} onChange={(v) => set('tin', v)} />
        </div>
        <Field label="Receipt footer message" value={form.receiptFooter} onChange={(v) => set('receiptFooter', v)} />
        <div>
          <label className="label">Senior / PWD discount (%)</label>
          <input
            className="input"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.seniorPwdPercent}
            onChange={(e) => set('seniorPwdPercent', Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-slate-500">Default is 5% for basic necessities and prime commodities. Check the DTI rules that apply to your store.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={form.vatRegistered} onChange={(e) => set('vatRegistered', e.target.checked)} />
          Store is VAT-registered
        </label>
        <button className="btn-primary w-full sm:w-auto">{saved ? 'Saved ✓' : 'Save'}</button>
      </form>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Backup at Restore</h2>
        <p className="text-sm text-slate-600">
          All data is saved on this device only. Back up regularly (e.g. weekly) and keep the file somewhere else — Google Drive, Messenger, or a USB drive.
        </p>
        <p className="text-xs text-slate-500">Last backup: {lastBackup ? new Date(lastBackup).toLocaleString('en-PH') : 'never'}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={download}>Download backup</button>
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}>Restore from file</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) restore(f)
            }}
          />
        </div>
        {message && <p className="text-sm text-brand-700">{message}</p>}
      </section>

      {productCount === 0 && (
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Sample data</h2>
          <p className="text-sm text-slate-600">Load example products to try out the system.</p>
          <button className="btn-secondary" onClick={() => loadSampleProducts().then(() => setMessage('Sample products loaded.'))}>
            Load sample products
          </button>
        </section>
      )}
    </div>
  )
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={value} required={required} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
