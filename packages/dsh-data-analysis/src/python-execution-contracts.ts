/** Host-issued reference to an immutable successful Python execution snapshot. */
export interface PythonCodeRef {
  executionId: string
  sha256: string
}

export interface PythonCodeSnippet extends PythonCodeRef {
  language: 'python'
  text: string
  provenance: 'execution'
  datasources?: PythonExecutionDatasource[]
}

/** A datasource declaration accepted for one Host-bound Python execution. */
export interface PythonExecutionDatasource {
  name: string
  backend: string | null
}

/** Host-bound attachments from this successful invocation, never Workspace-authored provenance. */
export interface PythonCaptureRecord {
  workspaceId: string
  sessionId: string
  callId: string
  rootCallId: string
  entries: { captureId: string; path: string; sha256: string }[]
}
