import { createContext, useContext } from 'react'
import type { AnalysisResource } from '../../presentation/contracts/analysis-document.ts'

export interface AnalysisResourceContext {
  readResource: (name: string) => AnalysisResource | undefined
  candidate?: boolean
}
export const AnalysisResources = createContext<AnalysisResourceContext>({
  readResource: () => undefined,
})
export const useAnalysisResources = () => useContext(AnalysisResources)
