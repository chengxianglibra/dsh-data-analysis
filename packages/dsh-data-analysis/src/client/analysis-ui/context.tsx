import { createContext, useContext } from 'react'
import type { AnalysisResource } from '../../presentation/contracts/analysis-document.ts'
import type { OpenSemanticRef } from '../presentation/source-facts.ts'

export interface AnalysisResourceContext {
  readResource: (name: string) => AnalysisResource | undefined
  candidate?: boolean
  /** Opens the current definition through the existing semantic browser; absent offline. */
  openSemanticRef?: OpenSemanticRef
}
export const AnalysisResources = createContext<AnalysisResourceContext>({
  readResource: () => undefined,
})
export const useAnalysisResources = () => useContext(AnalysisResources)
