import { useMemo, useState } from 'react'
import type { PresentationBlock, PresentationDocument } from '../../presentation/contracts/types.ts'
import { useActionCopy, useCopy } from './../i18n/context.tsx'
import { sourceCodeFacts } from './source-code-model.ts'
import { formatSource } from './source-format.ts'
import { highlightSource } from './source-highlight.ts'

function FormattedCode({
  text,
  language,
  interactive,
}: {
  text: string
  language: 'python' | 'sql'
  interactive: boolean
}) {
  const display = useMemo(() => formatSource(text, language), [text, language])
  const tokens = useMemo(() => highlightSource(display.text, language), [display.text, language])
  return (
    <pre tabIndex={interactive ? 0 : undefined}>
      <code className={`language-${language}`}>
        {tokens.map((token) => (
          <span key={token.offset} style={token.color ? { color: token.color } : undefined}>
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  )
}

function CopyCode({ text }: { text: string }) {
  const t = useActionCopy()

  const [status, setStatus] = useState('')
  return (
    <div className="pr-source-code-copy">
      <button
        type="button"
        onClick={async () => {
          try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
            await navigator.clipboard.writeText(text)
            setStatus('marivo.presentation.copied')
          } catch {
            setStatus('marivo.presentation.copy-failed-select-the-code-below-to-copy-manually')
          }
        }}
      >
        {t('marivo.presentation.copy-code')}
      </button>
      <span role="status">{t(status)}</span>
    </div>
  )
}

export function SourceCode({
  document,
  block,
  interactive = false,
}: {
  document: PresentationDocument
  block?: PresentationBlock
  interactive?: boolean
}) {
  const t = useCopy()

  const { entries, notices } = sourceCodeFacts(document, block)
  return (
    <div className="pr-source-code">
      {entries.map((entry) => (
        <section className="pr-source-code-snippet" key={entry.key}>
          <header className="pr-source-code-header">
            <h3>{entry.language === 'python' ? 'Python' : 'SQL'}</h3>
            {interactive && <CopyCode text={entry.text} />}
          </header>
          <FormattedCode text={entry.text} language={entry.language} interactive={interactive} />
        </section>
      ))}
      {notices.map((notice) => (
        <p className="pr-notice" key={t(notice)}>
          {t(notice)}
        </p>
      ))}
      {entries.length === 0 && (
        <p className="pr-muted">{t('marivo.presentation.no-related-queries')}</p>
      )}
    </div>
  )
}

/** Native disclosures remain usable in saved HTML with JavaScript disabled. */
export function SourceCodeSummary({
  document,
  block,
}: {
  document: PresentationDocument
  block?: PresentationBlock
}) {
  const t = useCopy()

  const blocks = block
    ? [block]
    : document.blocks.filter((item) => item.kind === 'source' || 'datasetId' in item)
  if (!blocks.length) {
    return (
      <details className="pr-source-code-summary">
        <summary>{t('marivo.presentation.related-queries')}</summary>
        <SourceCode document={document} />
      </details>
    )
  }
  return blocks.map((item) => (
    <details className="pr-source-code-summary" key={item.id} data-code-block-id={item.id}>
      <summary>
        {t('marivo.presentation.related-queries')}
        {t(block ? '' : ` · ${item.kind === 'metric' ? item.label : item.id}`)}
      </summary>
      <SourceCode document={document} block={item} />
    </details>
  ))
}
