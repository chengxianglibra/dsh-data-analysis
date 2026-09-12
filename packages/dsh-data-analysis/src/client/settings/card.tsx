import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { useCopy } from '../i18n/context.tsx'

export interface PythonSettingsValue {
  pythonTimeoutMs: number
}

/** Seconds in the form, exact integer milliseconds at the Host boundary. */
export function timeoutMilliseconds(text: string): number | undefined {
  if (!/^\d+(?:\.\d{1,3})?$/.test(text.trim())) return undefined
  const value = Math.round(Number(text) * 1000)
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : undefined
}

export function PythonSettingsCard({ scope }: { scope: SettingsScope<PythonSettingsValue> }) {
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
    <li className={`marivo-settings-card${open ? ' marivo-settings-open' : ''}`}>
      <style>{styles}</style>
      <button
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
      </button>
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
              aria-describedby="marivo-python-timeout-hint"
              aria-invalid={timeoutMs === undefined}
              onChange={(event) => edit(event.target.value)}
            />
            <p id="marivo-python-timeout-hint">{t('marivo.settings.hint')}</p>
            {timeoutMs === undefined && <p role="alert">{t('marivo.settings.invalid')}</p>}
            {!snapshot.writable && <p role="status">{t('marivo.settings.read-only')}</p>}
            {failed && <p role="alert">{t('marivo.settings.failed')}</p>}
          </div>
          <div className="marivo-settings-actions">
            <button
              type="button"
              disabled={saving || !draft}
              onClick={() => {
                setDraft(undefined)
                setFailed(false)
              }}
            >
              {t('marivo.settings.discard')}
            </button>
            <button
              type="button"
              className="marivo-settings-save"
              disabled={disabled || !draft || timeoutMs === undefined}
              onClick={() => void save()}
            >
              {t(saving ? 'marivo.settings.saving' : 'marivo.settings.save')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

// Match Harness PluginCard/fields chrome; those components are not public runtime exports.
const styles = `
.marivo-settings-card{list-style:none;border:.5px solid var(--dsw-alias-border-l4,#ddd);border-radius:16px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#202124);transition:border-color .16s,background .16s}
.marivo-settings-card:hover,.marivo-settings-open{border-color:var(--dsw-alias-label-dimmed,#ccc)}
.marivo-settings-open{background:var(--dsw-alias-bg-layer-2,#fff)}
.marivo-settings-header{box-sizing:border-box;width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.marivo-settings-heading{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.marivo-settings-name{font-size:15px;font-weight:600;line-height:1.4}
.marivo-settings-description{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#888)}
.marivo-settings-chevron{flex:none;color:var(--dsw-alias-label-tertiary,#888);transition:transform .16s}
.marivo-settings-open .marivo-settings-chevron{transform:rotate(180deg)}
.marivo-settings-pending{flex:none;font-size:12px;border-radius:4px;padding:0 4px;background:var(--dsw-alias-bg-layer-1,#f5f5f5);color:var(--dsw-alias-label-tertiary,#888)}
.marivo-settings-body{border-top:.5px solid var(--dsw-alias-border-l2,#eee);margin:0 16px;padding-bottom:8px}
.marivo-settings-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.marivo-settings-body p{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);line-height:1.5}
.marivo-settings-body p[role=alert]{color:var(--dsw-alias-label-error,#c33)}
.marivo-settings-body label{font-size:13px;line-height:1.5;font-weight:500}
.marivo-settings-field input{box-sizing:border-box;width:100%;min-width:0;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4,#ddd);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#fff);font:inherit;font-size:13px;line-height:1.5;color:inherit}
.marivo-settings-field input[aria-invalid=true]{border-color:var(--dsw-alias-label-error,#c33)}
.marivo-settings-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:.5px solid var(--dsw-alias-border-l2,#eee)}
.marivo-settings-actions button{appearance:none;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer;background:none;color:var(--dsw-alias-label-secondary,#666)}
.marivo-settings-actions .marivo-settings-save{border-color:transparent;background:var(--dsw-alias-label-primary,#202124);color:var(--dsw-alias-bg-layer-3,#fff)}
.marivo-settings-card :disabled{opacity:.4;cursor:default}
.marivo-settings-card :focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4682e9);outline-offset:1px}
`
