import {
  parseStructuredRules,
  useFormValidation,
  useIsStreaming,
  useStateField,
} from '@openuidev/react-lang'
import { DatePicker } from '@openuidev/react-ui'
import { type ComponentProps, useEffect, useMemo, useRef, useState } from 'react'

type DateRange = NonNullable<ComponentProps<typeof DatePicker>['selectedRangeDates']>

function date(value: unknown): Date | undefined {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : undefined
}

function range(value: unknown): DateRange | undefined {
  if (!value || typeof value !== 'object' || !('from' in value)) return undefined
  const from = date(value.from)
  const to = 'to' in value ? date(value.to) : undefined
  return from ? { from, to } : undefined
}

function clickedDay(
  previous: DateRange | undefined,
  next: DateRange | undefined,
): Date | undefined {
  if (!next)
    return previous?.from && previous.to?.getTime() === previous.from.getTime()
      ? previous.from
      : undefined
  const from = next.from
  const to = next.to
  if (!from) return undefined
  if (!to || from.getTime() === to.getTime()) return from
  if (from.getTime() !== previous?.from?.getTime()) return from
  if (to.getTime() !== previous?.to?.getTime()) return to
  return undefined
}

/** Keep official field state and validation; only the calendar's open session is local. */
export function AnalysisDatePicker({
  name,
  mode,
  rules: rawRules,
  value,
}: {
  name: string
  mode: 'single' | 'range'
  rules: unknown
  value: unknown
}) {
  const isStreaming = useIsStreaming()
  const formValidation = useFormValidation()
  const field = useStateField(name, value)
  const rules = useMemo(() => parseStructuredRules(rawRules), [rawRules])
  const hasRules = rules.length > 0
  const [open, setOpen] = useState(false)
  const firstClick = useRef(false)

  useEffect(() => {
    if (!isStreaming && hasRules && formValidation) {
      formValidation.registerField(field.name, rules, () => field.value)
      return () => formValidation.unregisterField(field.name)
    }
    return undefined
  }, [field.name, field.value, formValidation, hasRules, isStreaming, rules])

  const update = (next: unknown) => {
    field.setValue(next)
    if (hasRules) formValidation?.validateField(field.name, next, rules)
  }
  const setIsOpen = (next: boolean) => {
    firstClick.current = false
    setOpen(next)
  }
  if (mode === 'single')
    return (
      <DatePicker
        // The upstream picker falls back to its internal value when a controlled
        // single date becomes undefined. Remount across the empty boundary so
        // clearing OpenUI state cannot reveal a stale internal selection.
        key={date(field.value) ? 'selected' : 'empty'}
        mode="single"
        selectedSingleDate={date(field.value)}
        setSelectedSingleDate={(next) => {
          update(next)
          if (next) setOpen(false)
        }}
        isOpen={open}
        setIsOpen={setIsOpen}
      />
    )

  const selected = range(field.value)
  return (
    <DatePicker
      mode="range"
      selectedRangeDates={selected ?? { from: undefined }}
      setSelectedRangeDates={(next) => {
        if (!firstClick.current) {
          const day = clickedDay(selected, next)
          if (!day) return
          firstClick.current = true
          update({ from: day, to: day })
          return
        }
        const complete = next?.from && next.to ? next : selected
        if (!complete?.from || !complete.to) return
        update(complete)
        firstClick.current = false
        setOpen(false)
      }}
      isOpen={open}
      setIsOpen={setIsOpen}
    />
  )
}
