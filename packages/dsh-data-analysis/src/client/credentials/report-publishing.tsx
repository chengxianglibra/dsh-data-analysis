import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type {
  PublishingCredentialView,
  PublishingField,
} from '../../report-publishing/credential-contract.ts'
import { useCopy } from '../i18n/context.tsx'
import { Button } from '../ui/controls.tsx'
import { Alert, AlertDescription } from '../ui/primitives/alert.tsx'
import { Badge } from '../ui/primitives/badge.tsx'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/primitives/card.tsx'
import { Field, FieldGroup, FieldLabel, FieldSet } from '../ui/primitives/field.tsx'
import { Input } from '../ui/primitives/input.tsx'
import type { CredentialClientModel, PublishingCredentialRequest } from './model.ts'

const labels = {
  accessKeyId: 'marivo.credentials.scoped-access-key',
  secretAccessKey: 'marivo.credentials.scoped-secret-key',
  sessionToken: 'marivo.credentials.scoped-session-token',
} as const
type Editor = { field: PublishingField } & ({ action: 'set'; value: string } | { action: 'unset' })

export function ReportPublishingCredentials({
  model,
  workspaceId,
}: {
  model: CredentialClientModel
  workspaceId: string
}) {
  const t = useCopy()
  const id = useId()
  const [view, setView] = useState<PublishingCredentialView>()
  const [editor, setEditor] = useState<Editor>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const current = useRef<AbortController>()
  const run = useCallback(
    async (request: PublishingCredentialRequest) => {
      if (current.current) return
      const controller = new AbortController()
      current.current = controller
      setEditor(undefined)
      setBusy(true)
      setError('')
      try {
        const next = await model.publishingCredentials(workspaceId, request, controller.signal)
        if (!controller.signal.aborted) setView(next)
      } catch (failure) {
        if (!controller.signal.aborted) {
          setView(undefined)
          setError(
            failure instanceof Error &&
              'code' in failure &&
              failure.code === 'report-publishing-config-changed'
              ? 'marivo.credentials.publishing-config-changed'
              : 'marivo.credentials.publishing-credential-unconfirmed',
          )
        }
      } finally {
        if (current.current === controller) {
          current.current = undefined
          setBusy(false)
        }
      }
    },
    [model, workspaceId],
  )
  useEffect(() => {
    void run({ endpoint: 'describe' })
    return () => {
      current.current?.abort()
      current.current = undefined
    }
  }, [run])

  function save() {
    if (!view?.enabled || !editor) return
    const { configId } = view
    const { field, action } = editor
    if (action === 'unset') void run({ endpoint: 'unset', configId, field })
    else if (editor.value) void run({ endpoint: 'set', configId, field, value: editor.value })
  }

  return (
    <Card className="mc-fields" aria-labelledby={id}>
      <CardHeader>
        <CardTitle id={id} role="heading" aria-level={3}>
          {t('marivo.credentials.report-publishing-credentials')}
        </CardTitle>
        {view?.enabled && (
          <CardDescription className="break-words">
            {view.name} · {view.bucket}
          </CardDescription>
        )}
        <CardAction>
          <Button
            variant="outline"
            type="button"
            disabled={busy}
            onClick={() => void run({ endpoint: 'describe' })}
          >
            {t('marivo.credentials.refresh-credential-status')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent aria-busy={busy}>
        {error && (
          <Alert role="alert" className="mc-alert">
            <AlertDescription>{t(error)}</AlertDescription>
          </Alert>
        )}
        {busy && !view && (
          <p role="status">{t('marivo.credentials.loading-publishing-credentials')}</p>
        )}
        {view?.enabled === false && (
          <p className="mc-note">{t('marivo.credentials.publishing-disabled')}</p>
        )}
        {view?.enabled &&
          view.fields.map((item) => {
            const active = editor?.field === item.field ? editor : undefined
            const inputId = `${id}-${item.field}`
            return (
              <FieldSet
                className="mc-field"
                key={item.field}
                aria-label={item.reference}
                disabled={busy}
              >
                <FieldGroup>
                  <div className="mc-field-header">
                    <div className="mc-field-title">
                      <h4>{item.reference}</h4>
                      <p>
                        {t(labels[item.field])} {t('marivo.credentials.source')}
                        {item.source ?? t('marivo.credentials.none')}
                        {!item.writable && t('marivo.credentials.read-only-source')}
                      </p>
                    </div>
                    <div className="mc-field-actions">
                      <Badge className="mc-badge" data-ready={item.configured}>
                        {t(
                          item.configured
                            ? 'marivo.credentials.configured'
                            : 'marivo.credentials.not-configured',
                        )}
                      </Badge>
                      {item.writable && !active && (
                        <Button
                          variant="outline"
                          type="button"
                          onClick={() => setEditor({ action: 'set', field: item.field, value: '' })}
                        >
                          {t(
                            item.configured
                              ? 'marivo.credentials.replace'
                              : 'marivo.credentials.add-credential',
                          )}
                        </Button>
                      )}
                      {item.writable && item.configured && !active && (
                        <Button
                          variant="destructive"
                          type="button"
                          onClick={() => setEditor({ action: 'unset', field: item.field })}
                        >
                          {t('marivo.credentials.delete-saved-value')}
                        </Button>
                      )}
                    </div>
                  </div>
                  {active?.action === 'set' && (
                    <Field>
                      <FieldLabel htmlFor={inputId}>{t('marivo.credentials.new-value')}</FieldLabel>
                      <Input
                        id={inputId}
                        type="password"
                        autoComplete="new-password"
                        maxLength={65_536}
                        value={active.value}
                        onChange={(event) => setEditor({ ...active, value: event.target.value })}
                      />
                      <div className="mc-field-actions">
                        <Button type="button" disabled={!active.value} onClick={save}>
                          {t(
                            item.configured
                              ? 'marivo.credentials.confirm-replacement'
                              : 'marivo.credentials.add-credential',
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          type="button"
                          onClick={() => setEditor(undefined)}
                        >
                          {t('marivo.credentials.cancel')}
                        </Button>
                      </div>
                    </Field>
                  )}
                  {active?.action === 'unset' && (
                    <div className="mc-confirm">
                      <p>
                        {t('marivo.credentials.delete-shared-publishing-credential', {
                          p0: item.reference,
                        })}
                      </p>
                      <div className="mc-field-actions">
                        <Button variant="destructive" type="button" onClick={save}>
                          {t('marivo.credentials.confirm-saved-value-deletion')}
                        </Button>
                        <Button
                          variant="outline"
                          type="button"
                          onClick={() => setEditor(undefined)}
                        >
                          {t('marivo.credentials.keep')}
                        </Button>
                      </div>
                    </div>
                  )}
                </FieldGroup>
              </FieldSet>
            )
          })}
      </CardContent>
    </Card>
  )
}
