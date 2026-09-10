import {
  CodeBlock,
  DisclosureRow,
  IconCodeOutline16,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { useMemo, useState } from 'react'
import { useCopy } from '../i18n/context.tsx'
import { pythonToolModel } from './model.ts'

const styles = `
.mp-tool{min-width:0;max-width:100%;font-size:12px;color:var(--dsw-alias-label-primary,#1d3036)}
.mp-summary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;margin-left:8px;color:var(--dsw-alias-label-secondary,#5b7076)}
.mp-body{min-width:0;margin:8px 0 8px 20px;border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:8px;padding:12px;display:grid;gap:12px}
.mp-body section,.mp-body details{min-width:0}.mp-body h4{font-size:12px;margin:0 0 6px}
.mp-scroll{max-height:360px;overflow:auto;min-width:0}.mp-body pre{font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre;tab-size:4;margin:0}
.mp-code pre{white-space:pre!important;overflow:visible!important;max-height:none!important}
.mp-code button{display:none}.mp-input-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.mp-input-heading h4{margin:0}
.mp-facts{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0}.mp-facts div{display:flex;gap:6px;min-width:0}.mp-facts dd{margin:0;overflow-wrap:anywhere}.mp-facts dt{color:var(--dsw-alias-label-secondary,#5b7076)}
.mp-notice{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-state-warn-label,#805b20)}
.mp-body button{font:inherit;cursor:pointer}.mp-body summary{cursor:pointer}.mp-state{font-size:11px;margin-left:8px}
.mp-inspect{border:1px solid var(--dsw-alias-border-l2,#dce5e5);border-radius:6px;padding:3px 8px;background:var(--dsw-alias-bg-base,#fff);color:inherit}
.mp-tool[data-state=failed] .mp-state,.mp-tool[data-state=warning] .mp-state,.mp-tool[data-state=timed-out] .mp-state{color:var(--dsw-alias-state-warn-label,#805b20)}
`

export function PythonToolCard({ block, inspect }: Pick<ToolCallOwnerProps, 'block' | 'inspect'>) {
  const t = useCopy()
  const [open, setOpen] = useState(false)
  const [copy, setCopy] = useState<{ code: string; ok: boolean }>()
  const model = useMemo(() => pythonToolModel(block), [block])
  const copySource = async () => {
    if (model.code === undefined) return
    const code = model.code
    const ok = await writeClipboard(code).catch(() => false)
    setCopy({ code, ok })
  }
  return (
    <div className="mp-tool" data-state={model.state}>
      <style>{styles}</style>
      <DisclosureRow
        icon={<IconCodeOutline16 />}
        title="marivo_python"
        open={open}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => setOpen((value) => !value)}
        collapsedContent={
          <>
            <span className="mp-summary">{model.summary}</span>
            <span className="mp-state">{t(`marivo.python.${model.state}`)}</span>
          </>
        }
      >
        {open && (
          <div className="mp-body">
            <section aria-label={t('marivo.python.input')}>
              <div className="mp-input-heading">
                <h4>{t('marivo.python.input')}</h4>
                {model.code !== undefined && (
                  <button type="button" className="mp-inspect" onClick={() => void copySource()}>
                    {t(
                      copy?.code === model.code && copy.ok
                        ? 'marivo.python.copied'
                        : 'marivo.python.copy',
                    )}
                  </button>
                )}
              </div>
              {copy && copy.code === model.code && !copy.ok && (
                <p role="status" className="mp-notice">
                  {t('marivo.python.copy-failed')}
                </p>
              )}
              <div className="mp-scroll">
                {model.code === undefined ? (
                  <pre>{model.input}</pre>
                ) : (
                  // Host CodeBlock removes one trailing newline for display. Compensate here;
                  // copy above uses source directly because highlighted DOM also normalizes CRLF.
                  <CodeBlock
                    code={`${model.code}\n`}
                    lang="python"
                    className="mp-code"
                    copyLabel={t('marivo.python.copy')}
                    copiedLabel={t('marivo.python.copied')}
                  />
                )}
              </div>
            </section>
            <dl className="mp-facts">
              {model.datasources !== undefined && (
                <div>
                  <dt>datasources</dt>
                  <dd>{JSON.stringify(model.datasources)}</dd>
                </div>
              )}
              {model.timeoutMs !== undefined && (
                <div>
                  <dt>timeoutMs</dt>
                  <dd>{model.timeoutMs} ms</dd>
                </div>
              )}
              {model.facts.map(({ name, value }) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {model.notices.map((notice) => (
              <p className="mp-notice" key={notice}>
                {notice}
              </p>
            ))}
            {model.facts.some((fact) => fact.name === 'truncated' && fact.value === 'true') && (
              <p className="mp-notice">{t('marivo.python.truncated')}</p>
            )}
            {(['stdout', 'stderr'] as const).map((name) =>
              model[name] === undefined ? null : (
                <section key={name} aria-label={name}>
                  <h4>{name}</h4>
                  <pre className="mp-scroll">{model[name]}</pre>
                </section>
              ),
            )}
            {model.fallback !== undefined && (
              <section aria-label={t('marivo.python.output')}>
                <h4>{t('marivo.python.output')}</h4>
                <pre className="mp-scroll">{model.fallback}</pre>
              </section>
            )}
            <details>
              <summary>{t('marivo.python.raw')}</summary>
              <h4>{t('marivo.python.input')}</h4>
              <pre className="mp-scroll">{model.input}</pre>
              {model.output !== undefined && (
                <>
                  <h4>{t('marivo.python.output')}</h4>
                  <pre className="mp-scroll">{model.output}</pre>
                </>
              )}
            </details>
            {inspect && (
              <div>
                <button type="button" className="mp-inspect" onClick={inspect}>
                  {t('marivo.python.inspect')}
                </button>
              </div>
            )}
          </div>
        )}
      </DisclosureRow>
    </div>
  )
}
