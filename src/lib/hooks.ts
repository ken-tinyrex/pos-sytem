import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { onSnapshot, type DocumentReference, type Query } from 'firebase/firestore'
import { defaultSettings, SYNC_ERROR_EVENT, type StoreSettings } from './db'
import { auth, settingsRef } from './firebase'

/**
 * Live query: re-renders whenever matching documents change on this or any other device.
 * Returns undefined while the first result is loading.
 */
export function useCollection<T>(makeQuery: () => Query | null, deps: unknown[]): T[] | undefined {
  const [rows, setRows] = useState<T[]>()
  useEffect(() => {
    const q = makeQuery()
    if (!q) return setRows([])
    return onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)),
      (e) => console.error(e),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return rows
}

/** Live single document; undefined while loading or if it doesn't exist. */
export function useDocument<T>(makeRef: () => DocumentReference | null, deps: unknown[]): T | undefined {
  const [row, setRow] = useState<T>()
  useEffect(() => {
    const ref = makeRef()
    if (!ref) return setRow(undefined)
    return onSnapshot(
      ref,
      (snap) => setRow(snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : undefined),
      (e) => console.error(e),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return row
}

export function useSettings(): StoreSettings {
  const row = useDocument<Partial<StoreSettings>>(() => settingsRef, [])
  return { ...defaultSettings, ...row }
}

/** undefined = still checking, null = signed out */
export function useAuthUser() {
  const [user, setUser] = useState<User | null | undefined>(auth.currentUser ?? undefined)
  useEffect(() => onAuthStateChanged(auth, setUser), [])
  return user
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** Latest background sync failure message (e.g. permission denied), cleared after a while. */
export function useSyncError() {
  const [error, setError] = useState('')
  useEffect(() => {
    let timer: number | undefined
    const onError = (e: Event) => {
      setError((e as CustomEvent<string>).detail)
      clearTimeout(timer)
      timer = window.setTimeout(() => setError(''), 8000)
    }
    window.addEventListener(SYNC_ERROR_EVENT, onError)
    return () => window.removeEventListener(SYNC_ERROR_EVENT, onError)
  }, [])
  return error
}
