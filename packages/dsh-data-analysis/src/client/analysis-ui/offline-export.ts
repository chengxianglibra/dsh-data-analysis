import type {
  AnalysisDocument,
  AnalysisResource,
} from '../../presentation/contracts/analysis-document.ts'
import { OFFLINE_RUNTIME } from './offline-runtime.generated.ts'

// The standalone renderer has no Host callbacks. Replace Host-only identities before
// serialization; captured values, view metadata and images remain in the file.
function offlineResource(resource: AnalysisResource): AnalysisResource {
  if (resource.kind === 'image') {
    return { ...resource, declaration: { kind: 'image-file', path: 'offline' } }
  }
  const snapshot =
    resource.snapshot.kind === 'frame'
      ? {
          ...resource.snapshot,
          source: { kind: 'frame' as const, sessionId: 'offline', artifactId: null },
          frame: { ...resource.snapshot.frame, inputId: 'offline' },
        }
      : resource.snapshot
  return {
    ...resource,
    declaration: {
      kind: resource.snapshot.kind === 'frame' ? 'frame-snapshot' : 'dataset-snapshot',
      snapshotRef: 'offline',
    },
    snapshot,
    binding: {
      workspaceId: 'offline',
      sessionId: 'offline',
      callId: 'offline',
      codeRef: { executionId: '00000000-0000-4000-8000-000000000000', sha256: '0'.repeat(64) },
    },
  }
}

/** Produce a self-contained browser document from an already validated saved Build. */
export function exportAnalysisHtml(document: AnalysisDocument): string {
  const offline: AnalysisDocument = {
    ...document,
    workspaceId: 'offline',
    reportId: 'offline',
    buildId: 'offline',
    recordId: 'marivo-ui:offline:offline',
    resources: Object.fromEntries(
      Object.entries(document.resources).map(([name, resource]) => [
        name,
        offlineResource(resource),
      ]),
    ),
  }
  // JSON is an inert script element, but HTML parsing still treats </script as markup.
  const data = JSON.stringify(offline).replaceAll('<', '\\u003c')
  const runtime = OFFLINE_RUNTIME.replace(/<\/script/gi, '<\\/script')
  const lang = document.locale
  const title = document.title
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  const notice =
    lang === 'zh-CN'
      ? '离线报告包含保存的数据快照；就此提问、实时语义定义和 Python 源码不可用。'
      : 'This offline report contains saved data snapshots. Asking questions, live semantic definitions, and Python source are unavailable.'
  return `<!doctype html>\n<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"><title>${title}</title><style>html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif}#report{max-width:1440px;margin:auto}noscript{display:block;padding:1rem}.offline-notice{max-width:1408px;margin:1rem auto 0;padding:0 1rem;color:#526070;font-size:.875rem}</style></head><body><noscript>${lang === 'zh-CN' ? '此分析视图需要启用 JavaScript。' : 'JavaScript is required to open this analysis view.'}</noscript><p class="offline-notice">${notice}</p><main id="report"></main><script type="application/json" id="report-data">${data}</script><script>${runtime}</script></body></html>`
}
