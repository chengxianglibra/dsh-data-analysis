// @ts-nocheck -- JSX is bundled by the plugin client build.
import { ChevronDownIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../ui/controls.tsx'
import { Input } from '../ui/primitives/input.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/primitives/popover.tsx'

const timezones = Array.from(
  new Set(
    [
      'UTC',
      'Africa/Cairo',
      'Africa/Johannesburg',
      'Africa/Lagos',
      'America/Anchorage',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Mexico_City',
      'America/New_York',
      'America/Sao_Paulo',
      'America/St_Johns',
      'Asia/Bangkok',
      'Asia/Dubai',
      'Asia/Hong_Kong',
      'Asia/Jakarta',
      'Asia/Kathmandu',
      'Asia/Kolkata',
      'Asia/Seoul',
      'Asia/Shanghai',
      'Asia/Singapore',
      'Asia/Tokyo',
      'Australia/Adelaide',
      'Australia/Perth',
      'Australia/Sydney',
      'Europe/Berlin',
      'Europe/Istanbul',
      'Europe/London',
      'Europe/Moscow',
      'Europe/Paris',
      'Pacific/Auckland',
      'Pacific/Honolulu',
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(Intl.supportedValuesOf?.('timeZone') ?? []),
    ].filter(Boolean),
  ),
).sort()

/** The text field remains authoritative, including custom zones and fixed offsets. */
export function TimezoneInput({ id, descriptionId, value, onChange, required, disabled, t }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [choice, setChoice] = useState('')
  const filtered = timezones.filter((zone) => zone.toLowerCase().includes(query.toLowerCase()))
  function choose() {
    if (!choice) return
    onChange(choice)
    setOpen(false)
  }
  return (
    <div className="mc-timezone-control">
      <Input
        id={id}
        aria-label="wall_clock_timezone"
        aria-describedby={descriptionId}
        autoComplete="off"
        required={required}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setQuery('')
            setChoice('')
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t('marivo.credentials.choose-timezone')}
            disabled={disabled}
          >
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="mc-timezone-popover">
          <Input
            aria-label={t('marivo.credentials.search-timezone')}
            placeholder={t('marivo.credentials.search-timezone')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setChoice('')
            }}
          />
          <select
            className="mc-timezone-select"
            aria-label={t('marivo.credentials.choose-timezone')}
            size={8}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && choice) {
                event.preventDefault()
                choose()
              }
            }}
          >
            <option value="" disabled>
              {t('marivo.credentials.choose-timezone')}
            </option>
            {filtered.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          {!filtered.length && <p role="status">{t('marivo.credentials.timezone-no-matches')}</p>}
          <Button type="button" onClick={choose} disabled={!choice}>
            {t('marivo.credentials.use-timezone')}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  )
}
