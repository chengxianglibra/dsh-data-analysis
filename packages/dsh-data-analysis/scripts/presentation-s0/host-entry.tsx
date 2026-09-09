import { useEffect, useState, version } from 'react'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import type {
  PresentationDocument,
  PresentationReceipt,
} from '../../src/presentation/contracts/types.ts'
import { S0Reader } from './reader.tsx'
import { S0_STYLES } from './styles.ts'

/** Temporary plugin installed only in the S0 isolated Web profile. */
export function installS0(ctx: any, receipts: PresentationReceipt[]) {
  const rpc = ctx.get('connection').rpc
  const read = async (receipt: PresentationReceipt, html = false) => {
    const file = html ? receipt.files.html : receipt.files.document
    const result = await rpc.call('/api', 'marivo-presentation-s0/files/read', {
      workspaceId: receipt.workspaceId,
      reportId: 'report',
      buildId: receipt.buildId,
      asset: file.asset,
      sha256: file.sha256,
    })
    if (!result.ok) throw new Error(result.error.message)
    if (
      typeof result.value !== 'object' ||
      result.value === null ||
      !('bodyBase64' in result.value) ||
      typeof result.value.bodyBase64 !== 'string'
    )
      throw new Error('Invalid S0 file response')
    return Uint8Array.from(atob(result.value.bodyBase64), (char) => char.charCodeAt(0))
  }
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({ name: 'sidebar.footer.action', id: 'presentation-s0-entry' }, () => (
      <button type="button" onClick={() => window.dispatchEvent(new Event('presentation-s0-open'))}>
        打开 S0 验证
      </button>
    )),
  )
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'presentation-s0-overlay' },
      function Overlay() {
        const [open, setOpen] = useState(false)
        const [document, setDocument] = useState<PresentationDocument>()
        const [selected, setSelected] = useState<PresentationReceipt>()
        const [error, setError] = useState('')
        useEffect(() => {
          const show = () => setOpen(true)
          window.addEventListener('presentation-s0-open', show)
          return () => window.removeEventListener('presentation-s0-open', show)
        }, [])
        if (!open) return null
        return (
          <div
            role="dialog"
            aria-label="S0 展示验证"
            style={{
              position: 'fixed',
              inset: 10,
              zIndex: 10000,
              overflow: 'auto',
              background: '#f2f5f1',
              padding: 16,
            }}
          >
            <style>{S0_STYLES}</style>
            <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {receipts.map((receipt) => (
                <button
                  key={receipt.buildId}
                  type="button"
                  onClick={async () => {
                    setError('')
                    try {
                      setDocument(
                        parsePresentationDocument(
                          JSON.parse(new TextDecoder().decode(await read(receipt))),
                        ),
                      )
                      setSelected(receipt)
                    } catch (error) {
                      setError(String(error))
                      setDocument(undefined)
                    }
                  }}
                >
                  {receipt.title}
                </button>
              ))}
              {selected && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const bytes = await read(selected, true)
                      const url = URL.createObjectURL(
                        new Blob([bytes], { type: 'text/html;charset=utf-8' }),
                      )
                      const link = window.document.createElement('a')
                      link.href = url
                      link.download = `${selected.buildId}.html`
                      link.click()
                      setTimeout(() => URL.revokeObjectURL(url), 1000)
                    } catch (error) {
                      setError(String(error))
                    }
                  }}
                >
                  下载 HTML
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)}>
                关闭
              </button>
            </nav>
            <small data-host-react={version}>
              Host React {version} · 实际 DSH RPC · 隔离验证 profile
            </small>
            {error && <p role="alert">{error}</p>}
            {document && <S0Reader document={document} />}
          </div>
        )
      },
    ),
  )
}
