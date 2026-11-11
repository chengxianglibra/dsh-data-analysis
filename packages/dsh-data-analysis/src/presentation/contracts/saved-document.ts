import { parseSavedPresentation } from './analysis-document.ts'

/** Decode a verified saved document, distinguishing invalid content from I/O failures. */
export function parseSavedDocumentBytes(bytes: Uint8Array) {
  try {
    return parseSavedPresentation(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'report-version-unsupported') throw error
    throw new Error('report-document-incompatible', { cause: error })
  }
}
