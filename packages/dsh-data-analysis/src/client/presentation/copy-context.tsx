import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { CloseIcon } from './icons.tsx'

export function CopyContext({
  text,
  children,
}: {
  text: string
  children: (copy: (restoreFocusTo: HTMLElement) => void) => ReactNode
}) {
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
  async function writeClipboard() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setStatus('copied')
    } catch {
      setStatus('manual')
    }
  }
  function copy(restoreFocusTo: HTMLElement) {
    restoreFocus.current = restoreFocusTo
    setStatus('idle')
    void writeClipboard()
  }
  return (
    <div className="pr-copy pr-interactive">
      {children(copy)}
      <span className="pr-copy-status" aria-live="polite">
        {status === 'copied' ? '已复制' : ''}
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
          <h2 id={titleId}>手动复制 cell 上下文</h2>
          <button
            type="button"
            className="pr-icon-button"
            aria-label="关闭复制窗口"
            onClick={() => dialog.current?.close()}
          >
            <CloseIcon />
          </button>
        </div>
        <p>无法自动复制，请复制以下文本。</p>
        <textarea
          aria-label="cell 上下文"
          ref={field}
          readOnly
          value={text}
          onFocus={() => field.current?.select()}
        />
      </dialog>
    </div>
  )
}
