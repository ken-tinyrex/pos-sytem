# Kiko Store POS

Offline-first, web-based point-of-sale for small grocery stores / sari-sari stores in the Philippines.
Works on desktop, tablet and phone, and can be installed as an app (PWA).

## Features
- **Sell (POS)** – tap products or scan barcodes (USB/Bluetooth scanner, or phone camera on Chrome/Android), sold-by-weight items (kg), Senior/PWD or custom discount, Cash (with change + quick ₱ bills), GCash, Maya, or Credit (utang)
- **Receipts** – receipt history per day, reprint (58mm thermal), void (restores stock and credit balance)
- **Products** – products, cost/price/margin, low-stock alerts, restock & inventory count with movement log
- **Credit** – customer credit (utang) ledger with payments and history
- **Reports** – sales, estimated profit, payment breakdown, cash expected in drawer, top sellers, low stock
- **Settings** – store info for receipts, backup/restore to a JSON file, sample data

All devices share one Cloud Firestore database (Firebase project `pokecard-summoner`, data under
`stores/kiko`), so everyone signed in sees the same products, sales and credit accounts. Each device
also keeps a local copy, so the app keeps working offline and syncs when back online. Sign-in uses
one shared store account (email + password); only signed-in users can read or write (`firestore.rules`).

## Development
```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build to dist/
npm run preview   # serve the build (service worker active)
npm run deploy    # build + deploy hosting, Firestore rules and indexes
```
Live at https://kiko-store-pos.web.app. Camera scanning requires HTTPS.

To test against local emulators (needs Java): `firebase emulators:start --only auth,firestore`, then
run the app with `VITE_FIREBASE_EMULATOR=1`.
