import { useRef } from 'react'
import { Coffee, LayoutGrid, Sun, Umbrella, Utensils, Wine } from 'lucide-react'
import type { Category } from '#/lib/types'

export type FilterBarProps = {
  value: Category
  onChange: (cat: Category) => void
  /** Show only places with confirmed outdoor seating. */
  outdoor: boolean
  onOutdoorChange: (next: boolean) => void
}

type ChipDef = {
  cat: Category
  label: string
  Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
}

const CHIPS: ChipDef[] = [
  { cat: 'all', label: 'All', Icon: LayoutGrid },
  { cat: 'breakfast', label: 'Breakfast', Icon: Sun },
  { cat: 'coffee', label: 'Coffee', Icon: Coffee },
  { cat: 'lunch', label: 'Lunch', Icon: Utensils },
  { cat: 'apero', label: 'Apéro', Icon: Wine },
]

export function FilterBar(props: FilterBarProps): React.ReactElement {
  const { value, onChange, outdoor, onOutdoorChange } = props
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + dir + CHIPS.length) % CHIPS.length
    const nextBtn = buttonsRef.current[nextIndex]
    nextBtn?.focus()
    const nextChip = CHIPS[nextIndex]
    if (nextChip) onChange(nextChip.cat)
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
      <div role="radiogroup" aria-label="Category filter" className="flex items-center gap-1.5">
        {CHIPS.map((chip, i) => {
          const active = chip.cat === value
          const Icon = chip.Icon
          return (
            <button
              key={chip.cat}
              ref={(el) => {
                buttonsRef.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(chip.cat)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              className={[
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1',
                active
                  ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200',
              ].join(' ')}
            >
              <Icon aria-hidden="true" className="w-4 h-4" />
              <span>{chip.label}</span>
            </button>
          )
        })}
      </div>
      <div className="h-5 w-px bg-slate-300 mx-1 shrink-0" aria-hidden="true" />
      <button
        type="button"
        role="switch"
        aria-checked={outdoor}
        aria-label="Show only places with outdoor seating"
        onClick={() => onOutdoorChange(!outdoor)}
        className="inline-flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-100 active:bg-slate-200 transition-colors shrink-0 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1"
      >
        <Umbrella
          aria-hidden="true"
          className={`w-4 h-4 ${outdoor ? 'text-amber-600' : 'text-slate-500'}`}
        />
        <span
          className={`text-sm font-medium ${outdoor ? 'text-slate-900' : 'text-slate-600'}`}
        >
          Outdoor
        </span>
        <span
          aria-hidden="true"
          className={`relative inline-block w-9 h-5 rounded-full transition-colors ${
            outdoor ? 'bg-amber-500' : 'bg-slate-300'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 inline-block w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
              outdoor ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </span>
      </button>
    </div>
  )
}
