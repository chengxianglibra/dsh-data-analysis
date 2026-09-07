import { MarivoDatasourceBridge } from './datasource/bridge.ts'
import { MarivoHelpBridge } from './disclosure/bridge.ts'
import type { MarivoEnvironment } from './environment/binding.ts'
import { MarivoPresentationProjection } from './presentation/projection/index.ts'

export interface MarivoBridgeSet {
  readonly help: MarivoHelpBridge
  readonly datasource: MarivoDatasourceBridge
  readonly presentation: MarivoPresentationProjection
}

/** Compose domain adapters without adding domain methods back to the Environment. */
export function createMarivoBridgeSet(environment: MarivoEnvironment): MarivoBridgeSet {
  return Object.freeze({
    help: new MarivoHelpBridge(environment),
    datasource: new MarivoDatasourceBridge(environment),
    presentation: new MarivoPresentationProjection(environment),
  })
}
