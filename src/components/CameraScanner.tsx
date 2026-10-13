import { useEffect, useRef, useState } from 'react'

// Uses the browser's built-in BarcodeDetector where available (Chrome/Edge on Android, ChromeOS, macOS)
// and falls back to a bundled ZXing WebAssembly decoder elsewhere (iOS Safari, Firefox).
// The camera requires HTTPS or localhost. USB/Bluetooth scanners work everywhere via the search box.
interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
type DetectorCtor = new (opts?: { formats: string[] }) => Detector
declare global {
  interface Window {
    BarcodeDetector?: DetectorCtor
  }
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']

async function createDetector(): Promise<Detector> {
  if (window.BarcodeDetector) {
    const supported = await (window.BarcodeDetector as unknown as { getSupportedFormats?: () => Promise<string[]> })
      .getSupportedFormats?.()
      .catch(() => [])
    if (supported?.length) return new window.BarcodeDetector({ formats: FORMATS })
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  // Serve the WASM from our own origin so scanning works offline.
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } })
  return new BarcodeDetector({ formats: FORMATS as never })
}

// Show the scan button whenever a camera API exists, or when it's missing only because the page
// isn't on HTTPS, so we can tell the user why.
export const cameraScanSupported = () =>
  typeof window !== 'undefined' && (!!navigator.mediaDevices?.getUserMedia || !window.isSecureContext)

interface Props {
  onDetected: (code: string) => void
  /** Keep scanning after a detection instead of stopping. */
  continuous?: boolean
  className?: string
}

// In continuous mode, ignore the same code while it stays in view.
const REPEAT_COOLDOWN_MS = 1000

export default function CameraScanner({ onDetected, continuous = false, className = 'aspect-[4/3]' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const cb = useRef(onDetected)
  cb.current = onDetected

  useEffect(() => {
    let stream: MediaStream | undefined
    let timer: number | undefined
    let stopped = false
    let last = { code: '', at: 0 }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera needs a secure (HTTPS) connection. Open the app over HTTPS to scan.')
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        stream = s
        const detector = await createDetector().catch(() => {
          setError('Barcode scanning is not available on this device.')
          return undefined
        })
        if (!detector || stopped) return
        const video = videoRef.current!
        video.srcObject = s
        await video.play()
        const tick = async () => {
          if (stopped) return
          try {
            const code = (await detector.detect(video))[0]?.rawValue
            if (code) {
              const now = Date.now()
              if (code !== last.code || now - last.at > REPEAT_COOLDOWN_MS) {
                navigator.vibrate?.(80)
                cb.current(code)
                if (!continuous) return
              }
              last = { code, at: now }
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
  }, [continuous])

  if (error) return <p className="text-center text-red-600">{error}</p>
  return (
    <div className="relative overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} className={`w-full object-cover ${className}`} playsInline muted />
      <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
    </div>
  )
}
