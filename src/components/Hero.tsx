import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { Link } from '@tanstack/react-router'

const FADE_SECONDS = 0.5
const RESET_DELAY_MS = 100

export function Hero(): ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let raf = 0
    const tick = () => {
      const t = video.currentTime
      const d = video.duration
      if (Number.isFinite(d) && d > FADE_SECONDS * 2) {
        let opacity = 1
        if (t < FADE_SECONDS) opacity = t / FADE_SECONDS
        else if (t > d - FADE_SECONDS) opacity = Math.max(0, (d - t) / FADE_SECONDS)
        video.style.opacity = String(opacity)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const handleEnded = () => {
      video.style.opacity = '0'
      window.setTimeout(() => {
        video.currentTime = 0
        void video.play().catch(() => {})
      }, RESET_DELAY_MS)
    }
    video.addEventListener('ended', handleEnded)

    return () => {
      cancelAnimationFrame(raf)
      video.removeEventListener('ended', handleEnded)
    }
  }, [])

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-white text-black">
      <div
        className="absolute z-0"
        style={{ top: '300px', right: 0, bottom: 0, left: 0 }}
      >
        <video
          ref={videoRef}
          src="/video.mp4"
          autoPlay
          muted
          playsInline
          preload="auto"
          className="w-full h-full object-cover"
          style={{ opacity: 0 }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-white via-transparent to-white pointer-events-none" />
      </div>

      <section
        className="relative z-10 flex flex-col items-center justify-center text-center px-6 pb-40"
        style={{ paddingTop: 'calc(8rem - 75px)' }}
      >
        <h1
          className="font-display font-normal text-5xl sm:text-7xl md:text-8xl max-w-7xl animate-fade-rise"
          style={{ lineHeight: 0.95, letterSpacing: '-2.46px' }}
        >
          Find <em className="italic" style={{ color: '#6F6F6F' }}>sun</em> in Zürich.
        </h1>

        <p
          className="text-base sm:text-lg max-w-2xl mt-8 leading-relaxed animate-fade-rise-delay"
          style={{ color: '#6F6F6F' }}
        >
          See which cafés, bars, and restaurants with outdoor seating are in the
          sun right now — or will be at any time today.
        </p>

        <Link
          to="/map"
          className="rounded-full px-14 py-5 text-base mt-12 bg-black text-white transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white animate-fade-rise-delay-2"
        >
          Open the map
        </Link>
      </section>
    </main>
  )
}
