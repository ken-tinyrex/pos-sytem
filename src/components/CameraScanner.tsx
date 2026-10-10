import { useEffect, useRef, useState } from 'react'

// Uses the browser's built-in BarcodeDetector (Chrome/Edge on Android, ChromeOS, macOS).
// Requires HTTPS or localhost. USB/Bluetooth scanners work everywhere via the search box.
interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats: string[] }) => Detector
  }
}

export const cameraScanSupported = () => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices

export default function CameraScanner({ onDetected }: { onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const cb = useRef(onDetected)
  cb.current = onDetected

  useEffect(() => {
    let stream: MediaStream | undefined
    let timer: number | undefined
    let stopped = false
    const detector = new window.BarcodeDetector!({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] })

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        stream = s
        const video = videoRef.current!
        video.srcObject = s
        await video.play()
        const tick = async () => {
          if (stopped) return
          try {
            const codes = await detector.detect(video)
            if (codes[0]) {
              navigator.vibrate?.(80)
              cb.current(codes[0].rawValue)
              return
            }
          } catch {
            /* frame not ready */
          }
          timer = window.setTimeout(tick, 250)
        }
        tick()
      })
      .catch(() => setError('Cannot access the camera. Please check permissions.'))

    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  if (error) return <p className="text-center text-red-600">{error}</p>
  return (
    <div className="relative overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted />
      <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
    </div>
  )
}
