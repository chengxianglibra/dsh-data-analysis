import { useMemo, useState } from 'react'
import type { PresentationBlock, PresentationDocument } from '../../presentation/contracts/types.ts'
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
    <>
      <p className="pr-source-code-note">
        {display.formatted ? '已格式化展示；复制代码保留执行原文。' : '无法格式化，显示执行原文。'}
      </p>
      <pre tabIndex={interactive ? 0 : undefined}>
        <code className={`language-${language}`}>
          {tokens.map((token) => (
            <span key={token.offset} style={token.color ? { color: token.color } : undefined}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </>
  )
}

function CopyCode({ text }: { text: string }) {
  const [status, setStatus] = useState('')
  return (
    <div className="pr-source-code-copy">
      <button
        type="button"
        onClick={async () => {
          try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
            await navigator.clipboard.writeText(text)
            setStatus('已复制')
          } catch {
            setStatus('复制失败，请选择下方代码手动复制')
          }
        }}
      >
        复制代码
      </button>
      <span role="status">{status}</span>
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
  const { entries, notices } = sourceCodeFacts(document, block)
  return (
    <div className="pr-source-code">
      {entries.map((entry) => (
        <section className="pr-source-code-snippet" key={entry.key}>
          <header className="pr-source-code-header">
            <h3>{entry.language === 'python' ? 'Python' : 'SQL'} · 执行记录</h3>
            {interactive && <CopyCode text={entry.text} />}
          </header>
          {entry.authorAssociated && <p className="pr-muted">该执行记录由作者关联到此数据集。</p>}
          <FormattedCode text={entry.text} language={entry.language} interactive={interactive} />
        </section>
      ))}
      {notices.map((notice) => (
        <p className="pr-notice" key={notice}>
          {notice}
        </p>
      ))}
      {entries.length === 0 && <p className="pr-muted">未保存生成代码</p>}
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
  const blocks = block
    ? [block]
    : document.blocks.filter((item) => item.kind === 'source' || 'datasetId' in item)
  if (!blocks.length) {
    return (
      <details className="pr-source-code-summary">
        <summary>代码</summary>
        <SourceCode document={document} />
      </details>
    )
  }
  return blocks.map((item) => (
    <details className="pr-source-code-summary" key={item.id} data-code-block-id={item.id}>
      <summary>代码{block ? '' : ` · ${item.kind === 'metric' ? item.label : item.id}`}</summary>
      <SourceCode document={document} block={item} />
    </details>
  ))
}
