import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import PosPage from './pages/PosPage'
import ProductsPage from './pages/ProductsPage'
import SalesPage from './pages/SalesPage'
import CustomersPage from './pages/CustomersPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import { useAuthUser } from './lib/hooks'
import { isGuest } from './lib/firebase'

export default function App() {
  const user = useAuthUser()
  // Sign-in is remembered on the device, so this also works offline after the first login.
  if (!isGuest) {
    if (user === undefined) return null
    if (user === null) return <LoginPage />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<PosPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="credit" element={<CustomersPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
