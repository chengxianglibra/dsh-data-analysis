import { createContext, useContext } from 'react'
import type { AnalysisResource } from '../../presentation/contracts/analysis-document.ts'
import type { PythonCodeRef, PythonExecutionDatasource } from '../../python-execution-contracts.ts'
import type { OpenSemanticRef } from '../presentation/source-facts.ts'

export interface PythonCodeReadResult {
  text: string
  sha256: string
  datasources?: PythonExecutionDatasource[]
}

export interface AnalysisResourceContext {
  readResource: (name: string) => AnalysisResource | undefined
  candidate?: boolean
  /** Opens the current definition through the existing semantic browser; absent offline. */
  openSemanticRef?: OpenSemanticRef
  /**
   * Reads the saved Python source bound to a snapshot by the Host; absent offline.
   * Resolves undefined when the record is missing; sha256 identifies the verified execution record.
   */
  readCode?: (
    codeRef: PythonCodeRef,
    signal: AbortSignal,
  ) => Promise<PythonCodeReadResult | undefined>
  /** Inserts a saved DataFrame cell into the current Harness input after host validation. */
  askDataset?: (selection: { resourceName: string; row: number; field: string }) => Promise<void>
  /** Inserts a saved Frame cell into the current Harness input after host validation. */
  askPoint?: (selection: { resourceName: string; row: number; field: string }) => Promise<void>
}
export const AnalysisResources = createContext<AnalysisResourceContext>({
  readResource: () => undefined,
})
export const useAnalysisResources = () => useContext(AnalysisResources)
