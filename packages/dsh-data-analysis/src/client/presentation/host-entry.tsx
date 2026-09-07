import type { ReactNode } from 'react'
import type { PresentationDocument } from '../../presentation/contracts/types.ts'
import type { ReaderEditing } from './editor-controls.tsx'
import { PresentationReader } from './reader.tsx'
import { PRESENTATION_STYLES } from './styles.ts'

// DSH's ThemePresenter owns the active palette, including manually selected themes.
// Keep Host token adaptation outside the shared/portable reader and printed snapshot.
const HOST_PRESENTATION_STYLES = `
@media screen{.pr-host .pr-reader{--pr-bg:var(--dsw-alias-bg-base,#fff);--pr-soft:var(--dsw-alias-bg-module-platform,#f4f7f7);--pr-text:var(--dsw-alias-label-primary,#1d3036);--pr-muted:var(--dsw-alias-label-secondary,#5b7076);--pr-border:var(--dsw-alias-border-l2,#dce5e5);--pr-accent:var(--dsw-alias-state-business-primary,#087c71);--pr-warning:var(--dsw-alias-state-warn-label,#805b20);color-scheme:inherit}}
`

/** Host integrations supply only outer actions; document interpretation stays shared. */
export function HostPresentationReader({
  document,
  actions,
  editing,
}: {
  document: PresentationDocument
  editing?: ReaderEditing
  actions?: ReactNode
}) {
  return (
    <div className="pr-host">
      <style>{PRESENTATION_STYLES}</style>
      <style>{HOST_PRESENTATION_STYLES}</style>
      {actions && <div className="pr-host-actions pr-interactive">{actions}</div>}
      <div className="pr-host-live">
        <PresentationReader document={document} editing={editing} />
      </div>
      <div className="pr-host-print">
        <PresentationReader document={document} mode="static" />
      </div>
    </div>
  )
}
