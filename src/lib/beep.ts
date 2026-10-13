// Short scanner-style beep generated in the browser (no audio file, works offline).
let ctx: AudioContext | undefined

export function beep(ok = true) {
  try {
    ctx ??= new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = ok ? 1800 : 300
    gain.gain.value = 0.1
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.25))
  } catch {
    /* audio unavailable */
  }
}
