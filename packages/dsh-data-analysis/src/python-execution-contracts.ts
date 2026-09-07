/** Host-issued reference to an immutable successful Python execution snapshot. */
export interface PythonCodeRef {
  executionId: string
  sha256: string
}

export interface PythonCodeSnippet extends PythonCodeRef {
  language: 'python'
  text: string
  provenance: 'execution'
}
