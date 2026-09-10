/** Explicit portable export for isolated acceptance fixtures, including JSON-only Builds. */
import { readFile } from 'node:fs/promises'
import { buildPresentation } from '../src/presentation/build/index.ts'
import {
  type PresentationReceipt,
  parsePresentationDocument,
} from '../src/presentation/contracts/index.ts'

export async function presentationHtml(receipt: PresentationReceipt): Promise<Buffer> {
  if (receipt.files.html) return readFile(receipt.files.html.path)
  const document = parsePresentationDocument(
    JSON.parse(await readFile(receipt.files.document.path, 'utf8')),
  )
  return (await buildPresentation(document)).htmlBytes
}
