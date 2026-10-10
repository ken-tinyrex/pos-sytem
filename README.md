# Tindahan POS

Offline-first, web-based point-of-sale for small grocery stores / sari-sari stores in the Philippines.
Works on desktop, tablet and phone, and can be installed as an app (PWA).

## Features
- **Sell (POS)** – tap products or scan barcodes (USB/Bluetooth scanner, or phone camera on Chrome/Android), sold-by-weight items (kg), Senior/PWD or custom discount, Cash (with change + quick ₱ bills), GCash, Maya, or Credit (utang)
- **Receipts** – receipt history per day, reprint (58mm thermal), void (restores stock and credit balance)
- **Products** – products, cost/price/margin, low-stock alerts, restock & inventory count with movement log
- **Credit** – customer credit (utang) ledger with payments and history
- **Reports** – sales, estimated profit, payment breakdown, cash expected in drawer, top sellers, low stock
- **Settings** – store info for receipts, backup/restore to a JSON file, sample data

All data is stored in the browser's IndexedDB **on the device**. There is no server or sync —
use **Settings → Download backup** regularly.

## Development
```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build to dist/
npm run preview   # serve the build (service worker active)
```

Deploy `dist/` to any static host with HTTPS (Netlify, Vercel, Cloudflare Pages, GitHub Pages).
Open it once while online; afterwards it loads and works fully offline. Camera scanning requires HTTPS.
