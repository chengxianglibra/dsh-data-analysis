import {
  CodeBlock,
  DisclosureRow,
  IconCodeOutlineRegular,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { useMemo, useState } from 'react'
import { useCopy } from '../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { Badge } from '../ui/primitives/badge.tsx'
import { Card, CardContent } from '../ui/primitives/card.tsx'
import { UIStyleSheet } from '../ui/theme.ts'
import { pythonToolModel } from './model.ts'

const styles = `
.mp-tool{min-width:0;max-width:100%}
.mp-summary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;margin-left:.5rem;color:var(--muted-foreground)}
.mp-card{margin:.5rem 0}
.mp-body{min-width:0;display:flex;flex-direction:column;gap:1rem}
.mp-body section,.mp-body details{min-width:0}
.mp-body h4{margin:0 0 .5rem;font-size:.875rem;font-weight:500}
.mp-scroll{max-height:360px;overflow:auto;min-width:0}
.mp-body pre{font-family:var(--mv-font-mono,ui-monospace,monospace);font-size:.8125rem;white-space:pre;tab-size:4;margin:0}
.mp-code{overflow:visible}
.mp-code pre{white-space:pre!important;overflow:visible!important;max-height:none!important}
.mp-code button{display:none}
.mp-input-heading{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.5rem}
.mp-input-heading h4{margin:0}
.mp-facts{font-variant-numeric:tabular-nums;display:flex;flex-wrap:wrap;gap:.5rem 1rem;margin:0}
.mp-facts div{display:flex;gap:.5rem;min-width:0}
.mp-facts dd{margin:0;overflow-wrap:anywhere}
.mp-facts dt{color:var(--muted-foreground)}
.mp-notice{white-space:pre-wrap;overflow-wrap:anywhere}
.mp-body summary{cursor:pointer}
.mp-state{margin-left:.5rem}
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
    <div className="mv-ui mp-tool" data-state={model.state}>
      <UIStyleSheet />
      <style>{styles}</style>
      <DisclosureRow
        icon={<IconCodeOutlineRegular size={16} />}
        title="marivo_python"
        open={open}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => setOpen((value) => !value)}
        collapsedContent={
          <>
            <span className="mp-summary">{model.summary}</span>
            <Badge
              variant={
                model.state === 'failed' || model.state === 'timed-out'
                  ? 'destructive'
                  : 'secondary'
              }
              className="mp-state"
            >
              {t(`marivo.python.${model.state}`)}
            </Badge>
          </>
        }
      >
        {open && (
          <Card className="mp-card">
            <CardContent className="mp-body">
              <section aria-label={t('marivo.python.input')}>
                <div className="mp-input-heading">
                  <h4>{t('marivo.python.input')}</h4>
                  {model.code !== undefined && (
                    <Button
                      variant="outline"
                      type="button"
                      className="mp-inspect"
                      onClick={() => void copySource()}
                    >
                      {t(
                        copy?.code === model.code && copy.ok
                          ? 'marivo.python.copied'
                          : 'marivo.python.copy',
                      )}
                    </Button>
                  )}
                </div>
                {copy && copy.code === model.code && !copy.ok && (
                  <Alert role="status" className="mp-notice">
                    <AlertDescription>{t('marivo.python.copy-failed')}</AlertDescription>
                  </Alert>
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
                <Alert role="status" className="mp-notice" key={notice}>
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              ))}
              {model.facts.some((fact) => fact.name === 'truncated' && fact.value === 'true') && (
                <Alert role="status" className="mp-notice">
                  <AlertDescription>{t('marivo.python.truncated')}</AlertDescription>
                </Alert>
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
                  <Button variant="outline" type="button" className="mp-inspect" onClick={inspect}>
                    {t('marivo.python.inspect')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </DisclosureRow>
    </div>
  )
}
