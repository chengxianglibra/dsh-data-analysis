import { Service, type Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

interface TestShellContributor {
  name: string
  variables: Readonly<Record<`DSH_${string}`, { description: string }>>
  resolve(execution: ToolExecution): Readonly<Partial<Record<`DSH_${string}`, string>>>
}

/** Minimal faithful test double for the Harness managed DSH_* environment registry. */
export class TestShellEnv extends Service {
  readonly contributors = new Map<string, TestShellContributor>()
  readonly owners = new Map<string, string>()

  constructor(ctx: Context) {
    super(ctx, 'shellEnv')
  }

  register(contributor: TestShellContributor): () => void {
    if (this.contributors.has(contributor.name)) throw new Error(`duplicate contributor ${contributor.name}`)
    for (const key of Object.keys(contributor.variables)) {
      if (!key.startsWith('DSH_') || ['DSH_HOME', 'DSH_SHELL', 'DSH_SESSION_ID'].includes(key)) {
        throw new Error(`invalid or reserved DSH environment key ${key}`)
      }
      const owner = this.owners.get(key)
      if (owner !== undefined) throw new Error(`DSH environment key ${key} is owned by ${owner}`)
    }
    this.contributors.set(contributor.name, contributor)
    for (const key of Object.keys(contributor.variables)) this.owners.set(key, contributor.name)
    return () => {
      this.contributors.delete(contributor.name)
      for (const key of Object.keys(contributor.variables)) this.owners.delete(key)
    }
  }

  collect(execution: ToolExecution): Readonly<Record<string, string>> {
    return Object.freeze(Object.assign(
      {},
      ...[...this.contributors.values()].map(contributor => contributor.resolve(execution)),
    ))
  }

  list(): Array<{ contributor: string; key: `DSH_${string}`; description: string }> {
    return [...this.contributors.values()].flatMap(contributor =>
      Object.entries(contributor.variables).map(([key, value]) => ({
        contributor: contributor.name,
        key: key as `DSH_${string}`,
        description: value.description,
      })),
    )
  }
}
