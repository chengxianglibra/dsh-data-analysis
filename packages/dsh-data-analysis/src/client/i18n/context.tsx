import { createContext, type ReactNode, useContext } from 'react'
import type { PresentationLocale } from '../../presentation/contracts/types.ts'
import { type Translator, translator } from './copy.ts'

// The standalone reader supplies its document language. Host roots supply the DSH service.
const CopyContext = createContext<Translator>(translator('en-US'))
const ActionsContext = createContext<Translator | undefined>(undefined)
export function CopyProvider({ t, children }: { t: Translator; children: ReactNode }) {
  return <CopyContext.Provider value={t}>{children}</CopyContext.Provider>
}
export function HostCopyProvider({ t, children }: { t: Translator; children: ReactNode }) {
  return (
    <ActionsContext.Provider value={t}>
      <CopyProvider t={t}>{children}</CopyProvider>
    </ActionsContext.Provider>
  )
}
export function ReportCopyProvider({
  locale,
  children,
}: {
  locale: PresentationLocale
  children: ReactNode
}) {
  return <CopyProvider t={translator(locale)}>{children}</CopyProvider>
}
export function useCopy(): Translator {
  return useContext(CopyContext)
}
export function useActionCopy(): Translator {
  const report = useCopy()
  return useContext(ActionsContext) ?? report
}
