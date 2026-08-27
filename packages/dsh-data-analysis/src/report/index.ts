export {
  parseReportDocument,
  REPORT_DOCUMENT_VERSION,
} from './document.ts'
export type {
  ChartBlockV1,
  EvidenceBlockV1,
  ParsedReportDocument,
  ReportBlockedStage,
  ReportBlockedValueV1,
  ReportBlockV1,
  ReportDocumentV1,
  ReportIssueV1,
  ReportReadyValueV1,
  ReportRenderValueV1,
  ReportSectionV1,
  TableBlockV1,
  TextBlockV1,
} from './document.ts'
export {
  parseReportProjection,
} from './projection.ts'
export type {
  ReportArtifactColumn,
  ReportArtifactProjection,
  ReportCompatibilityProjection,
  ReportFindingProjection,
  ReportProjectionBundle,
} from './projection.ts'
export {
  canonicalJson,
  MAX_REPORT_HTML_BYTES,
  publishReport,
  REPORT_DIGEST_VERSION,
  REPORT_MANIFEST_VERSION,
  reportDocumentDigest,
} from './publish.ts'
export { renderReportHtml, REPORT_RENDERER_VERSION } from './render.ts'
export {
  createMarivoReportRenderTool,
  installMarivoReportCodeDelivery,
  MARIVO_REPORT_RENDER_TOOL_NAME,
  REPORT_DURABLE_CONTENT_KIND,
  REPORT_PRESENTATION_META_KIND,
  REPORT_PRESENTATION_META_VERSION,
  registerMarivoReportRenderTool,
  reportPresentationMeta,
  renderReportToolValue,
} from './tool.ts'
export type { MarivoReportToolOptions, ReportPresentationMetaV1 } from './tool.ts'
export { compileReportVisuals } from './visual.ts'
export type {
  CompiledChartBlock,
  CompiledReport,
  CompiledTableBlock,
} from './visual.ts'
