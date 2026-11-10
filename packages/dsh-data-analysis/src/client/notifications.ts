import type { Context } from '@deepseek-ai/cordis'
import { credentialChangesRemote } from '../datasource/changes-contract.ts'
import { nextStepsRemote } from '../next-steps/contracts.ts'

const mounts = new WeakMap<Context, Promise<() => void | Promise<void>>>()

/** Typert mounts one contribution per package, shared by both notification streams. */
export function mountNotifications(ctx: Context) {
  let mounted = mounts.get(ctx)
  if (!mounted) {
    mounted = ctx.remote.$mount({
      ...credentialChangesRemote,
      descriptors: [...credentialChangesRemote.descriptors, ...nextStepsRemote.descriptors],
    })
    mounts.set(ctx, mounted)
    void mounted.catch(() => {})
    const current = mounted
    ctx.effect(() => async () => {
      mounts.delete(ctx)
      await (await current)()
    })
  }
  return mounted
}
