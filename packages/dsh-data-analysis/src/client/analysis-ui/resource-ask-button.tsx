import { useLayoutEffect, useRef, useState } from 'react'
import { useCopy } from '../i18n/context.tsx'
import { IconButton } from '../ui/controls.tsx'
import { FishLogo } from '../ui/fish-logo.tsx'
import type { AnalysisResourceContext, ComponentIdentity } from './context.tsx'
import { useFocusAfterAsk } from './focus-after-ask.ts'

/** Add the fixed saved resource to its owning conversation draft. */
export function ResourceAskButton({
  component,
  resourceName,
  snapshot,
  ask,
}: {
  component: ComponentIdentity
  resourceName: string
  snapshot: object
  ask: NonNullable<AnalysisResourceContext['askResource']>
}) {
  const t = useCopy()
  const focusAfterAsk = useFocusAfterAsk()
  const revision = useRef(0)
  const componentKey = JSON.stringify(component)
  const identity = useRef({ snapshot, resourceName, componentKey })
  const active = useRef<{
    controller: AbortController
    snapshot: object
    resourceName: string
    componentKey: string
  }>()
  if (
    identity.current.snapshot !== snapshot ||
    identity.current.resourceName !== resourceName ||
    identity.current.componentKey !== componentKey
  ) {
    revision.current++
    identity.current = { snapshot, resourceName, componentKey }
  }
  useLayoutEffect(
    () => () => {
      revision.current++
      const request = active.current
      if (
        request?.snapshot === snapshot &&
        request.resourceName === resourceName &&
        request.componentKey === componentKey
      ) {
        request.controller.abort()
        active.current = undefined
      }
    },
    [snapshot, resourceName, componentKey],
  )
  const [state, setState] = useState<{
    snapshot: object
    resourceName: string
    componentKey: string
    status: 'pending' | 'failed'
  }>()
  const status =
    state?.snapshot === snapshot &&
    state.resourceName === resourceName &&
    state.componentKey === componentKey
      ? state.status
      : undefined
  const label = t('marivo.presentation.ui-ask-resource')
  return (
    <>
      <span className="fv-icon" data-icon="ask-resource">
        <IconButton
          variant="outline"
          size="icon-sm"
          label={label}
          tip={label}
          aria-disabled={status === 'pending' || undefined}
          aria-busy={status === 'pending' || undefined}
          onClick={(event) => {
            if (status === 'pending') return
            const button = event.currentTarget
            const request = ++revision.current
            const controller = new AbortController()
            active.current = { controller, snapshot, resourceName, componentKey }
            setState({ snapshot, resourceName, componentKey, status: 'pending' })
            void ask({ component, resourceName }, controller.signal).then(
              (focus) => {
                if (request !== revision.current) return
                active.current = undefined
                setState(undefined)
                focusAfterAsk.prepare(focus ?? undefined, document.activeElement === button)
                requestAnimationFrame(focusAfterAsk.finish)
              },
              () => {
                if (request === revision.current) {
                  active.current = undefined
                  setState({ snapshot, resourceName, componentKey, status: 'failed' })
                }
              },
            )
          }}
        >
          <FishLogo size={16} />
        </IconButton>
      </span>
      {status === 'failed' && (
        <span role="status">{t('marivo.presentation.ui-dataset-ask-failed')}</span>
      )}
    </>
  )
}
