import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { useCopy } from '../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'
import { Badge } from '../ui/primitives/badge.tsx'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../ui/primitives/card.tsx'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '../ui/primitives/field.tsx'
import { Input } from '../ui/primitives/input.tsx'
import { UIStyleSheet } from '../ui/theme.ts'

export interface PythonSettingsValue {
  pythonTimeoutMs: number
}

/** Seconds in the form, exact integer milliseconds at the Host boundary. */
export function timeoutMilliseconds(text: string): number | undefined {
  if (!/^\d+(?:\.\d{1,3})?$/.test(text.trim())) return undefined
  const value = Math.round(Number(text) * 1000)
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : undefined
}

export function PythonSettingsCard({ scope }: { scope: ConfigForm<PythonSettingsValue> }) {
  const t = useCopy()
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [draft, setDraft] = useState<{
    text: string
    revision: number
  }>()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  if (snapshot.status !== 'ready' || !snapshot.value) return null
  const text = draft?.text ?? String(snapshot.value.pythonTimeoutMs / 1000)
  const timeoutMs = timeoutMilliseconds(text)
  const disabled = !snapshot.writable || saving
  const edit = (text: string) => {
    if (snapshot.revision === undefined) return
    setDraft({ text, revision: draft?.revision ?? snapshot.revision })
    setFailed(false)
  }
  const save = async () => {
    if (!draft || disabled || timeoutMs === undefined) return
    setSaving(true)
    setFailed(false)
    try {
      await scope.mutate(
        [{ op: 'set', path: ['pythonTimeoutMs'], value: timeoutMs }],
        draft.revision,
      )
      // A refused Host write can settle normally after the scope recovers its snapshot.
      const latest = scope.getSnapshot()
      const user = latest.user as Partial<PythonSettingsValue> | undefined
      const overridden = user != null && Object.hasOwn(user, 'pythonTimeoutMs')
      const landed =
        latest.status === 'ready' &&
        latest.value !== undefined &&
        overridden &&
        user?.pythonTimeoutMs === timeoutMs &&
        latest.value.pythonTimeoutMs === timeoutMs
      if (landed) {
        setDraft(undefined)
        setOpen(false)
      } else setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }
  return (
    <li className="mv-ui marivo-settings-card">
      <UIStyleSheet />
      <style>{styles}</style>
      <Card>
        <CardHeader>
          <CardTitle>{t('marivo.settings.title')}</CardTitle>
          <CardDescription>{t('marivo.settings.description')}</CardDescription>
          <CardAction className="marivo-settings-header-actions">
            {draft && (
              <Badge variant="secondary" role="status">
                {t('marivo.settings.unsaved')}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-expanded={open}
              aria-controls="marivo-settings-body"
              aria-label={`${t(open ? 'marivo.settings.collapse' : 'marivo.settings.expand')}: ${t('marivo.settings.title')}`}
              onClick={() => setOpen(!open)}
            >
              <svg
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden="true"
                style={{ transform: open ? 'rotate(180deg)' : undefined }}
              >
                <path
                  d="m3 5 4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Button>
          </CardAction>
        </CardHeader>
        {open && (
          <>
            <CardContent id="marivo-settings-body">
              <FieldGroup>
                <Field data-disabled={disabled} data-invalid={timeoutMs === undefined}>
                  <FieldLabel htmlFor="marivo-python-timeout">
                    {t('marivo.settings.timeout')}
                  </FieldLabel>
                  <Input
                    id="marivo-python-timeout"
                    type="number"
                    min="0.001"
                    max="2147483.647"
                    step="0.001"
                    value={text}
                    disabled={disabled}
                    aria-describedby={`marivo-python-timeout-hint${timeoutMs === undefined ? ' marivo-python-timeout-error' : ''}`}
                    aria-invalid={timeoutMs === undefined}
                    onChange={(event) => edit(event.target.value)}
                  />
                  <FieldDescription id="marivo-python-timeout-hint">
                    {t('marivo.settings.hint')}
                  </FieldDescription>
                  {timeoutMs === undefined && (
                    <FieldError id="marivo-python-timeout-error">
                      {t('marivo.settings.invalid')}
                    </FieldError>
                  )}
                  {!snapshot.writable && (
                    <FieldDescription role="status">
                      {t('marivo.settings.read-only')}
                    </FieldDescription>
                  )}
                  {failed && <FieldError>{t('marivo.settings.failed')}</FieldError>}
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="marivo-settings-actions">
              <Button
                variant="outline"
                type="button"
                disabled={saving || !draft}
                onClick={() => {
                  setDraft(undefined)
                  setFailed(false)
                }}
              >
                {t('marivo.settings.discard')}
              </Button>
              <Button
                type="button"
                disabled={disabled || !draft || timeoutMs === undefined}
                onClick={() => void save()}
              >
                {t(saving ? 'marivo.settings.saving' : 'marivo.settings.save')}
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </li>
  )
}

const styles = `
.marivo-settings-card{list-style:none;min-width:0}
.marivo-settings-header-actions{display:flex;align-items:center;gap:.5rem}
.marivo-settings-actions{justify-content:flex-end;flex-wrap:wrap;gap:.5rem}
`
