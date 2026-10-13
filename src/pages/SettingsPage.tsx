import { useEffect, useRef, useState } from 'react'
import { signOut } from 'firebase/auth'
import { limit, query } from 'firebase/firestore'
import { exportBackup, getSettings, importBackup, loadSampleProducts, saveSettings, type Product, type StoreSettings } from '../lib/db'
import { auth, col, isGuest, setGuest } from '../lib/firebase'
import { useCollection } from '../lib/hooks'

export default function SettingsPage() {
  // Read once, then let the form own its state.
  const [initial, setInitial] = useState<StoreSettings>()
  useEffect(() => {
    getSettings().then(setInitial)
  }, [])
  return initial ? <SettingsForm initial={initial} /> : null
}

function SettingsForm({ initial }: { initial: StoreSettings }) {
  const [form, setForm] = useState<StoreSettings>(initial)
  const [saved, setSaved] = useState(false)
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const anyProduct = useCollection<Product>(() => query(col('products'), limit(1)), [])
  const noProducts = anyProduct !== undefined && anyProduct.length === 0

  const set = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    saveSettings(form)
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
    if (!confirm('Records in the backup will be added to the shared database, replacing any with the same ID. Continue?')) return
    try {
      const count = importBackup(JSON.parse(await file.text()))
      setMessage(`Imported ${count} records. They will appear on all devices once synced.`)
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
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={form.allowOversell} onChange={(e) => set('allowOversell', e.target.checked)} />
            Allow selling when out of stock
          </label>
          <p className="mt-1 ml-6 text-xs text-slate-500">
            The cashier still gets a warning, but the sale goes through and stock goes negative. Use this if stock counts aren't always updated.
          </p>
        </div>
        <button className="btn-primary w-full sm:w-auto">{saved ? 'Saved ✓' : 'Save'}</button>
      </form>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Backup and Restore</h2>
        <p className="text-sm text-slate-600">
          Data is kept in the shared online database and synced to every signed-in device. A backup file is still a good safety net — download one now and then
          and keep it somewhere safe. You can also import a backup from the older on-device version of the app.
        </p>
        <p className="text-xs text-slate-500">Last backup: {lastBackup ? new Date(lastBackup).toLocaleString('en-PH') : 'never'}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={download}>Download backup</button>
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}>Import backup file</button>
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

      {noProducts && (
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Sample data</h2>
          <p className="text-sm text-slate-600">Load example products to try out the system.</p>
          <button className="btn-secondary" onClick={() => { loadSampleProducts(); setMessage('Sample products loaded.') }}>
            Load sample products
          </button>
        </section>
      )}

      <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="font-semibold">Account</h2>
          <p className="text-sm text-slate-600">{isGuest ? 'Guest mode (demo data)' : `Signed in as ${auth.currentUser?.email}`}</p>
        </div>
        {isGuest ? (
          <button className="btn-secondary" onClick={() => setGuest(false)}>
            Exit guest mode
          </button>
        ) : (
          <button className="btn-secondary" onClick={() => confirm('Sign out of this device?') && signOut(auth)}>
            Sign out
          </button>
        )}
      </section>
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
