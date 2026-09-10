import { createHash } from 'node:crypto'
import {
  PRESENTATION_BUDGETS,
  PresentationContractError,
  type PresentationDocument,
  parsePresentationDocument,
} from '../contracts/index.ts'

export interface BuiltPresentation {
  document: PresentationDocument
  documentBytes: Buffer
  htmlBytes?: Buffer
}

interface PortableAssets {
  script: string
  styles: string
  notices: unknown[]
}
interface StaticAssets {
  renderFallback: (document: PresentationDocument) => string
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/** JSON is data, even when a value contains HTML raw-text terminators. */
const inlineJson = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')

/**
 * Render an S2 snapshot without reading source data, generating identity, or writing files.
 * Both renderers are built into the installed package; execution needs no build tooling.
 */
export function buildPresentation(
  value: PresentationDocument,
): Promise<BuiltPresentation & { htmlBytes: Buffer }>
export function buildPresentation(
  value: PresentationDocument,
  options: { html?: boolean },
): Promise<BuiltPresentation>
export async function buildPresentation(
  value: PresentationDocument,
  options: { html?: boolean } = { html: true },
): Promise<BuiltPresentation> {
  parsePresentationDocument(value)
  // Freeze this invocation's input before awaiting assets or invoking either renderer.
  const documentBytes = Buffer.from(JSON.stringify(value), 'utf8')
  const document = parsePresentationDocument(JSON.parse(documentBytes.toString('utf8')))
  if (!options.html) return { document, documentBytes }
  const [portable, staticAssets] = (await Promise.all([
    import(new URL('../../../lib/presentation/assets/portable.js', import.meta.url).href),
    import(new URL('../../../lib/presentation/assets/static.js', import.meta.url).href),
  ])) as [PortableAssets, StaticAssets]
  const fallback = staticAssets.renderFallback(document)
  const script = portable.script.replace(/<\/script/gi, '<\\/script')
  const scriptHash = createHash('sha256').update(script).digest('base64')
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}' 'wasm-unsafe-eval'`,
    "script-src-attr 'none'",
    "style-src 'unsafe-inline'",
    "connect-src 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  const htmlBytes = Buffer.from(
    `<!doctype html>
<html lang="${escapeHtml(document.locale)}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(document.title)}</title>
<style>${portable.styles.replace(/<\/style/gi, '<\\/style')}</style>
</head>
<body data-presentation-portable="true">
<div id="presentation-fallback">${fallback}</div>
<div id="reader"></div>
<script id="presentation-data" type="application/json">${inlineJson(document)}</script>
<script id="third-party-notices" type="application/json">${inlineJson(portable.notices)}</script>
<script id="presentation-runtime">${script}</script>
</body>
</html>
`,
    'utf8',
  )
  if (htmlBytes.length > PRESENTATION_BUDGETS.htmlBytes) {
    throw new PresentationContractError(
      'budget',
      '/html',
      `HTML exceeds the ${PRESENTATION_BUDGETS.htmlBytes} byte budget.`,
      'Reduce repeated blocks, displayed rows, or text before building again.',
    )
  }
  return { document, documentBytes, htmlBytes }
}
