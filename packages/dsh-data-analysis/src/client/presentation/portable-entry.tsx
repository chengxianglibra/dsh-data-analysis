import { Component, type ReactNode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { parsePresentationDocument } from '../../presentation/contracts/index.ts'
import type { PresentationDocument } from '../../presentation/contracts/types.ts'
import { savePresentationHtml } from './download.ts'
import { PresentationReader } from './reader.tsx'

class PortableBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch() {
    delete document.documentElement.dataset.presentationReady
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

function ReadyReader({ value }: { value: PresentationDocument }) {
  useEffect(() => {
    document.documentElement.dataset.presentationReady = 'true'
    return () => {
      delete document.documentElement.dataset.presentationReady
    }
  }, [])
  return (
    <PresentationReader
      document={value}
      exportActions={{
        downloadFullReport: () => {
          const saved = document.documentElement.cloneNode(true) as HTMLElement
          delete saved.dataset.presentationReady
          saved.querySelector('#reader')?.replaceChildren()
          savePresentationHtml(
            new TextEncoder().encode(`<!doctype html>${saved.outerHTML}`),
            `marivo-${value.reportId}-${value.buildId}.html`,
          )
        },
      }}
    />
  )
}

const root = document.getElementById('reader')
const payload = document.getElementById('presentation-data')
if (!root || !payload?.textContent)
  throw new Error('Missing portable presentation document or root.')
const value = parsePresentationDocument(JSON.parse(payload.textContent))
createRoot(root).render(
  <PortableBoundary>
    <ReadyReader value={value} />
  </PortableBoundary>,
)
