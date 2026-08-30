import { MarivoDatasourceBridge } from './datasource/bridge.ts'
import { MarivoHelpBridge } from './disclosure/bridge.ts'
import type { MarivoEnvironment } from './environment/binding.ts'
import { MarivoEvidenceBridge } from './evidence/bridge.ts'
import { MarivoReportBridge } from './report/bridge.ts'

export interface MarivoBridgeSet {
  readonly help: MarivoHelpBridge
  readonly datasource: MarivoDatasourceBridge
  readonly evidence: MarivoEvidenceBridge
  readonly report: MarivoReportBridge
}

/** Compose domain adapters without adding domain methods back to the Environment. */
export function createMarivoBridgeSet(environment: MarivoEnvironment): MarivoBridgeSet {
  return Object.freeze({
    help: new MarivoHelpBridge(environment),
    datasource: new MarivoDatasourceBridge(environment),
    evidence: new MarivoEvidenceBridge(environment),
    report: new MarivoReportBridge(environment),
  })
}
