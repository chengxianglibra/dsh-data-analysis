import { createRoot } from 'react-dom/client'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import { S0Reader } from './reader.tsx'

const document = parsePresentationDocument(
  JSON.parse(globalThis.document.getElementById('presentation-data')!.textContent!),
)
createRoot(globalThis.document.getElementById('reader')!).render(<S0Reader document={document} />)
globalThis.document.getElementById('fallback')!.hidden = true
