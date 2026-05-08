import { createFileRoute, redirect } from '@tanstack/react-router'
import { Hero } from '#/components/Hero'
import type { Category } from '#/lib/types'

type IndexSearch = {
  t?: string
  cat?: Category
  outdoor?: boolean
}

const CATEGORIES: ReadonlyArray<Category> = ['breakfast', 'coffee', 'lunch', 'apero', 'all']

export const Route = createFileRoute('/')({
  validateSearch: (raw: Record<string, unknown>): IndexSearch => {
    const out: IndexSearch = {}
    if (typeof raw.t === 'string' && raw.t.length > 0) out.t = raw.t
    if (typeof raw.cat === 'string' && (CATEGORIES as ReadonlyArray<string>).includes(raw.cat)) {
      out.cat = raw.cat as Category
    }
    const v = raw.outdoor
    if (v === true || v === 'true' || v === 1 || v === '1') out.outdoor = true
    return out
  },
  beforeLoad: ({ search }) => {
    if (search.t || search.cat || search.outdoor) {
      throw redirect({ to: '/map', search })
    }
  },
  head: () => ({
    meta: [
      { title: 'Zürich Sunny Spots — Find sun in Zürich' },
      {
        name: 'description',
        content:
          'See which cafés, bars, and restaurants with outdoor seating are in the sun right now — or will be at any time today.',
      },
    ],
  }),
  component: Hero,
})
