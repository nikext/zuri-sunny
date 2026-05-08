import type { ReactElement } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'

export function Hero(): ReactElement {
  return (
    <main className="min-h-screen bg-stone-50 text-stone-900 flex flex-col">
      <header className="px-6 sm:px-10 pt-6 sm:pt-8">
        <p className="text-sm font-medium tracking-tight text-stone-500">
          Zürich Sunny Spots
        </p>
      </header>

      <section className="flex-1 flex flex-col items-start justify-center px-6 sm:px-10 max-w-5xl mx-auto w-full gap-6 sm:gap-8 py-16">
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.05]">
          Find sun in Zürich.
        </h1>
        <p className="text-lg sm:text-xl text-stone-500 max-w-[52ch] leading-relaxed">
          See which cafés, bars, and restaurants with outdoor seating are in the
          sun right now — or will be at any time today.
        </p>
        <Link
          to="/map"
          className="inline-flex items-center gap-2 rounded-full bg-stone-900 px-6 py-3 text-base font-medium text-white hover:bg-stone-800 active:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50"
        >
          Open the map
          <ArrowRight aria-hidden="true" className="w-4 h-4" />
        </Link>
      </section>
    </main>
  )
}
