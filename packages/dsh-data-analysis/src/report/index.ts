export type {
  CompiledDagComponent,
  CompiledDagEdge,
  CompiledDagNode,
  CompiledSessionDag,
  CompileSessionDagResult,
  ReportDagEdgeKind,
  ReportDagNodeKind,
} from './dag.ts'
export { compileSessionDag } from './dag.ts'
export type {
  ChartBlockV1,
  EvidenceBlockV1,
  ParsedReportDocument,
  ReportBlockedStage,
  ReportBlockedValueV1,
  ReportBlockV1,
  ReportCheckStatus,
  ReportCheckV1,
  ReportDocumentInspection,
  ReportDocumentV1,
  ReportIssueV1,
  ReportReadyValueV1,
  ReportRenderValueV1,
  ReportSectionV1,
  ReportVisualCandidate,
  TableBlockV1,
  TextBlockV1,
} from './document.ts'
export {
  parseReportDocument,
  REPORT_DOCUMENT_VERSION,
} from './document.ts'
export type {
  ReportArtifactColumn,
  ReportArtifactProjection,
  ReportCompatibilityProjection,
  ReportDagArtifactProjection,
  ReportDagArtifactStatus,
  ReportDagJobProjection,
  ReportDagQueryProjection,
  ReportFindingProjection,
  ReportProjectionBundle,
  ReportProjectionInspection,
  ReportSessionDagProjection,
} from './projection.ts'
export { parseReportProjection } from './projection.ts'
export {
  canonicalJson,
  MAX_REPORT_HTML_BYTES,
  publishReport,
  REPORT_DIGEST_VERSION,
  REPORT_MANIFEST_VERSION,
  reportDocumentDigest,
} from './publish.ts'
export { REPORT_RENDERER_VERSION, renderReportHtml } from './render.ts'
export type { MarivoReportToolOptions, ReportPresentationMetaV1 } from './tool.ts'
export {
  createMarivoReportRenderTool,
  installMarivoReportCodeDelivery,
  MARIVO_REPORT_RENDER_TOOL_NAME,
  REPORT_DURABLE_CONTENT_KIND,
  REPORT_PRESENTATION_META_KIND,
  REPORT_PRESENTATION_META_VERSION,
  registerMarivoReportRenderTool,
  renderReportToolValue,
  reportPresentationMeta,
} from './tool.ts'
export type {
  CompiledChartBlock,
  CompiledReport,
  CompiledTableBlock,
  ReportVisualPreflight,
} from './visual.ts'
export { compileReportVisuals, preflightReportVisuals } from './visual.ts'
