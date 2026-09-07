import { useRef, useState } from 'react'

export function CopyContext({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle')
  const field = useRef<HTMLTextAreaElement>(null)
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setStatus('copied')
    } catch {
      setStatus('manual')
    }
  }
  return (
    <div className="pr-copy pr-interactive">
      <button type="button" onClick={() => void copy()}>
        复制追问上下文
      </button>
      <span aria-live="polite">
        {status === 'copied' ? '已复制，可粘贴到对话中继续分析。' : ''}
      </span>
      {status === 'manual' && (
        <label>
          无法自动复制，请选择以下文本后复制。
          <textarea
            aria-label="追问上下文"
            ref={field}
            readOnly
            value={text}
            onFocus={() => field.current?.select()}
          />
        </label>
      )}
    </div>
  )
}
