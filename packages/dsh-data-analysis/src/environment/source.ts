import type { MarivoEnvironment } from './binding.ts'

/** A fixed binding or a lazy per-Agent/per-Workspace binding. */
export type MarivoEnvironmentSource = MarivoEnvironment | (() => Promise<MarivoEnvironment>)

/** A fixed domain adapter or a lazy adapter backed by a Workspace Environment. */
export type MarivoBridgeSource<T> = T | (() => Promise<T>)

export function resolveMarivoEnvironmentSource(
  source: MarivoEnvironmentSource,
): Promise<MarivoEnvironment> {
  return typeof source === 'function' ? source() : Promise.resolve(source)
}

export function resolveMarivoBridgeSource<T>(source: MarivoBridgeSource<T>): Promise<T> {
  return typeof source === 'function' ? (source as () => Promise<T>)() : Promise.resolve(source)
}
