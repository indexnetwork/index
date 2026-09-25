'use client'

import { useEffect, useRef } from 'react'

const DARK = `
  html, body { background:#141414 !important; overflow:hidden !important; }
  .bg-white { background:#1a1a1a !important; }
  .bg-\\[\\#FAFAFA\\] { background:#161616 !important; }
  .hover\\:bg-gray-50:hover { background:#222 !important; }
  .border-\\[\\#E8E8E8\\] { border-color:#2c2c2c !important; }
  .divide-\\[\\#F4F4F4\\] > :not([hidden]) ~ :not([hidden]) { border-color:#2a2a2a !important; }
  .text-black, .text-gray-900, .text-gray-800 { color:#f3f4f6 !important; }
  .text-gray-700 { color:#e5e7eb !important; }
  .text-gray-600 { color:#d1d5db !important; }
  .text-gray-500 { color:#9ca3af !important; }
  .text-gray-400, .text-gray-300 { color:#6b7280 !important; }
  .bg-\\[\\#F5F3FF\\] { background:#221c33 !important; }
  .bg-\\[\\#FFF5F6\\] { background:#2a1820 !important; }
  .bg-\\[\\#EFF6FF\\] { background:#152033 !important; }
  .bg-\\[\\#FFFBEB\\] { background:#2a220f !important; }
  .bg-\\[\\#ECFDF5\\] { background:#10241c !important; }
  .text-blue-900 { color:#bfdbfe !important; }
  .text-amber-900 { color:#fde68a !important; }
  .text-emerald-900, .text-emerald-700, .text-emerald-600 { color:#6ee7b7 !important; }
`

/** The pitch trace is a self-running document; the frame grows with its rows. */
export function LiveTrace() {
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    let maxH = 0
    const fit = () => {
      try {
        const d = frame.contentWindow?.document
        if (!d) return
        if (!d.getElementById('trace-dark')) {
          const style = d.createElement('style')
          style.id = 'trace-dark'
          style.textContent = DARK
          d.head.appendChild(style)
        }
        const h = Math.max(d.body.scrollHeight, d.documentElement.scrollHeight)
        if (h > maxH) {
          maxH = h
          frame.style.height = `${h}px`
        }
      } catch {
        /* cross-origin — leave the CSS fallback height */
      }
    }
    let interval: ReturnType<typeof setInterval> | undefined
    const onLoad = () => {
      fit()
      interval = setInterval(fit, 400)
    }
    frame.addEventListener('load', onLoad)
    if (frame.contentDocument?.readyState === 'complete') onLoad()
    return () => {
      frame.removeEventListener('load', onLoad)
      if (interval) clearInterval(interval)
    }
  }, [])

  return (
    <iframe
      ref={frameRef}
      className="live-trace"
      src="/trace-pitch.html"
      title="Index live trace"
      loading="lazy"
    />
  )
}
