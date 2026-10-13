import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  doc,
  collection,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

// Web config is public by design; access is controlled by Auth + firestore.rules.
const app = initializeApp({
  apiKey: 'AIzaSyCUkC5cJnjJ6VEJ4BVXg0WQh-ooOGgmVX4',
  authDomain: 'pokecard-summoner.firebaseapp.com',
  projectId: 'pokecard-summoner',
  storageBucket: 'pokecard-summoner.firebasestorage.app',
  messagingSenderId: '232653129225',
  appId: '1:232653129225:web:ad53dcc1e1940f2f66dad8',
})

// Local cache keeps the app working offline: reads come from the device and
// writes are queued, then synced to the shared database when back online.
export const fs = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true,
})

export const auth = getAuth(app)

if (import.meta.env.VITE_FIREBASE_EMULATOR === '1') {
  connectFirestoreEmulator(fs, '127.0.0.1', 8085)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
}

// Guest mode tries the app on shared demo data (open to anyone, see firestore.rules);
// the real store's data needs sign-in.
const GUEST_KEY = 'pos.guest'
export const isGuest = (() => {
  try {
    return localStorage.getItem(GUEST_KEY) === '1'
  } catch {
    return false
  }
})()

/** Switch guest mode on/off; reloads so every live query reconnects to the right data. */
export function setGuest(on: boolean) {
  try {
    if (on) localStorage.setItem(GUEST_KEY, '1')
    else localStorage.removeItem(GUEST_KEY)
  } catch {
    /* storage unavailable */
  }
  location.assign('/')
}

// All POS data lives under one store document, separate from anything else in the project.
const STORE_PATH = isGuest ? 'stores/demo' : 'stores/kiko'

export const col = (name: 'products' | 'sales' | 'customers' | 'credits' | 'stockMoves' | 'meta') =>
  collection(fs, `${STORE_PATH}/${name}`)

export const settingsRef = doc(fs, `${STORE_PATH}/meta/settings`)
