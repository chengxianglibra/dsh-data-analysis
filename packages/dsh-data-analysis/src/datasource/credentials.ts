import { type CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'
import { MarivoEnvironmentError } from '../environment/index.ts'
import { assertMarivoCredentialReferences, marivoCredentialStorageRef } from './shell-env.ts'

/** Resolve mapped credentials once and optionally project values into an operation overlay. */
export async function inspectMarivoDatasourceCredentials(
  refs: readonly string[],
  credentials: Pick<CredentialProvider, 'resolve'>,
  signal: AbortSignal,
  accept?: (ref: string, value: string) => void,
): Promise<string[]> {
  const uniqueRefs = [...new Set(refs)]
  assertMarivoCredentialReferences(uniqueRefs)
  const missing: string[] = []
  for (const ref of uniqueRefs) {
    signal.throwIfAborted()
    let resolved: { readonly value: string } | undefined
    try {
      resolved = await credentials.resolve(credentialRef(marivoCredentialStorageRef(ref)))
    } catch {
      throw new MarivoEnvironmentError(
        'datasource-credential-resolve-failed',
        'A mapped Marivo datasource credential could not be resolved',
        { ref },
      )
    }
    if (resolved === undefined) missing.push(ref)
    else accept?.(ref, resolved.value)
  }
  return missing
}
