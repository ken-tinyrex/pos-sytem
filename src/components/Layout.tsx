import { NavLink, Outlet } from 'react-router-dom'
import Icon, { type IconName } from './Icon'
import { useOnline, useSettings } from '../lib/hooks'

const nav: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Sell', icon: 'cart' },
  { to: '/products', label: 'Products', icon: 'box' },
  { to: '/sales', label: 'Receipts', icon: 'receipt' },
  { to: '/credit', label: 'Credit', icon: 'users' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/settings', label: 'Settings', icon: 'gear' },
]

export default function Layout() {
  const online = useOnline()
  const { storeName } = useSettings()

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Sidebar (tablet / desktop) */}
      <aside className="hidden w-20 shrink-0 flex-col bg-slate-900 text-slate-300 md:flex lg:w-56 print:hidden">
        <div className="flex h-16 items-center gap-2 px-4 font-bold text-white">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <span className="hidden truncate lg:inline">{storeName}</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 rounded-lg px-3 py-2.5 text-xs lg:flex-row lg:gap-3 lg:text-sm ${
                  isActive ? 'bg-brand-600 text-white' : 'hover:bg-slate-800'
                }`
              }
            >
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        {!online && <OfflineBadge className="m-2" />}
      </aside>

      {/* Top bar (mobile) */}
      <header className="flex h-12 items-center justify-between bg-slate-900 px-4 text-white md:hidden print:hidden">
        <span className="truncate font-bold">{storeName}</span>
        {!online && <OfflineBadge />}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="grid grid-cols-6 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-brand-600' : 'text-slate-500'}`
            }
          >
            <Icon name={n.icon} />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function OfflineBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-1 text-xs text-amber-300 ${className}`} title="Still works offline">
      <Icon name="wifiOff" className="h-4 w-4" /> Offline
    </span>
  )
}
