import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useActionCopy } from './../i18n/context.tsx'
import { CloseIcon } from './icons.tsx'

export function CopyContext({
  getText,
  children,
}: {
  getText: () => string
  children: (copy: (restoreFocusTo: HTMLElement) => void) => ReactNode
}) {
  const t = useActionCopy()

  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle')
  const restoreFocus = useRef<HTMLElement | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (status !== 'copied') return undefined
    const timeout = window.setTimeout(() => setStatus('idle'), 2_000)
    return () => window.clearTimeout(timeout)
  }, [status])
  useEffect(() => {
    if (status !== 'manual') return
    dialog.current?.showModal()
    field.current?.focus()
    field.current?.select()
  }, [status])
  async function writeClipboard(value: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(value)
      setStatus('copied')
    } catch {
      setStatus('manual')
    }
  }
  function copy(restoreFocusTo: HTMLElement) {
    restoreFocus.current = restoreFocusTo
    setStatus('idle')
    setError(undefined)
    try {
      const value = getText()
      setText(value)
      void writeClipboard(value)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  return (
    <div className="pr-copy pr-interactive">
      {children(copy)}
      {error && (
        <p role="alert" className="pr-notice">
          {t(error)}
        </p>
      )}
      <span className="pr-copy-status" aria-live="polite">
        {status === 'copied' ? t('marivo.presentation.copied') : ''}
      </span>
      <dialog
        ref={dialog}
        className="pr-dialog pr-copy-dialog"
        aria-labelledby={titleId}
        onClose={() => {
          setStatus('idle')
          if (restoreFocus.current?.isConnected) restoreFocus.current.focus()
        }}
      >
        <div className="pr-dialog-header">
          <h2 id={titleId}>{t('marivo.presentation.copy-cell-context-manually')}</h2>
          <button
            type="button"
            className="pr-icon-button"
            aria-label={t('marivo.presentation.close-copy-dialog')}
            onClick={() => dialog.current?.close()}
          >
            <CloseIcon />
          </button>
        </div>
        <p>{t('marivo.presentation.automatic-copying-is-unavailable-copy-the-text-below')}</p>
        <textarea
          aria-label={t('marivo.presentation.cell-context')}
          ref={field}
          readOnly
          value={text}
          onFocus={() => field.current?.select()}
        />
      </dialog>
    </div>
  )
}
