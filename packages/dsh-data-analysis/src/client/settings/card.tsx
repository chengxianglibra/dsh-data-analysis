import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { useCopy } from '../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'
import { UI_STYLES } from '../ui/theme.ts'

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
    <li className={`mv-ui marivo-settings-card${open ? ' marivo-settings-open' : ''}`}>
      <style>{styles}</style>
      <Button
        type="button"
        className="marivo-settings-header"
        aria-expanded={open}
        aria-controls="marivo-settings-body"
        aria-label={`${t(open ? 'marivo.settings.collapse' : 'marivo.settings.expand')}: ${t('marivo.settings.title')}`}
        onClick={() => setOpen(!open)}
      >
        <span className="marivo-settings-heading">
          <span className="marivo-settings-name">{t('marivo.settings.title')}</span>
          <span className="marivo-settings-description">{t('marivo.settings.description')}</span>
        </span>
        {draft && (
          <span className="marivo-settings-pending" role="status">
            {t('marivo.settings.unsaved')}
          </span>
        )}
        <svg
          className="marivo-settings-chevron"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
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
      {open && (
        <div id="marivo-settings-body" className="marivo-settings-body">
          <div className="marivo-settings-field">
            <label htmlFor="marivo-python-timeout">{t('marivo.settings.timeout')}</label>
            <input
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
            <p id="marivo-python-timeout-hint">{t('marivo.settings.hint')}</p>
            {timeoutMs === undefined && (
              <p id="marivo-python-timeout-error" role="alert">
                {t('marivo.settings.invalid')}
              </p>
            )}
            {!snapshot.writable && <p role="status">{t('marivo.settings.read-only')}</p>}
            {failed && <p role="alert">{t('marivo.settings.failed')}</p>}
          </div>
          <div className="marivo-settings-actions">
            <Button
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
              variant="primary"
              className="marivo-settings-save"
              disabled={disabled || !draft || timeoutMs === undefined}
              onClick={() => void save()}
            >
              {t(saving ? 'marivo.settings.saving' : 'marivo.settings.save')}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

// Preserve the Host plugin-card frame; style only the plugin-owned form content.
const styles =
  UI_STYLES +
  `
.marivo-settings-card{list-style:none;border:.5px solid var(--dsw-alias-border-l4,var(--mv-border));border-radius:16px;background:var(--dsw-alias-bg-layer-3,var(--mv-bg));color:var(--mv-text);transition:border-color .16s}
.marivo-settings-card:hover,.marivo-settings-open{border-color:var(--dsw-alias-label-dimmed,var(--mv-control-border))}
.marivo-settings-open{background:var(--dsw-alias-bg-layer-2,var(--mv-bg))}
.marivo-settings-card button.marivo-settings-header{box-sizing:border-box;width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.marivo-settings-heading{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.marivo-settings-name{font-size:15px;font-weight:600;line-height:22px}
.marivo-settings-description{font-size:13px;line-height:20px;color:var(--mv-muted)}
.marivo-settings-chevron{flex:none;color:var(--mv-muted);transition:transform .16s}
.marivo-settings-open .marivo-settings-chevron{transform:rotate(180deg)}
.marivo-settings-pending{flex:none;font-size:12px;line-height:18px;border-radius:4px;padding:1px 8px;background:var(--mv-soft);color:var(--mv-muted)}
.marivo-settings-body{border-top:.5px solid var(--mv-border);margin:0 16px;padding-bottom:8px}
.marivo-settings-field{display:flex;flex-direction:column;gap:4px;padding:16px 0}
.marivo-settings-body p{margin:0;font-size:12px;color:var(--mv-muted);line-height:18px}
.marivo-settings-body p[role=alert]{color:var(--mv-danger)}
.marivo-settings-body label{font-size:14px;line-height:22px;font-weight:500}
.marivo-settings-field input{box-sizing:border-box;width:100%;min-width:0;min-height:36px;padding:6px 10px;border:1px solid var(--mv-control-border);border-radius:6px;background:var(--mv-bg);font:14px/22px system-ui,sans-serif;color:var(--mv-text);font-variant-numeric:tabular-nums}
.marivo-settings-field input[aria-invalid=true]{border-color:var(--mv-danger)}
.marivo-settings-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding:12px 0 4px;border-top:.5px solid var(--mv-border)}
.marivo-settings-card :disabled{opacity:.5;cursor:default}
.marivo-settings-card :focus-visible{outline:2px solid var(--mv-focus);outline-offset:2px}
@media(prefers-reduced-motion:reduce){.marivo-settings-card,.marivo-settings-chevron{transition:none}}
`
