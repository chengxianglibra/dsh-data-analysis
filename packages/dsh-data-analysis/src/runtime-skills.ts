import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import {
  createScope,
  type Scope,
  type ScopeKey,
  scopeOf,
  scopeParentOf,
} from '@deepseek-ai/dsh-scope'
import type { SkillCandidate } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { finishCleanup, PendingTasks } from './lifecycle.ts'

const runtimeSkillNames = new Set(['marivo-analysis', 'marivo-semantic', 'marivo-service'])
const runtimeSkillRank = 50

/** Register the bound Runtime skills ahead of same-layer workspace definitions. */
export function installRuntimeSkills(ctx: Context, skillsRoot: string): () => Promise<void> {
  let filesystem: FileSystemSkillProvider
  const unregister = ctx.skills.registerProvider((control) => {
    filesystem = new FileSystemSkillProvider(ctx, control, {
      providerName: 'dsh-data-analysis-marivo',
      includeDefaultRoots: false,
      customSkillDirs: [skillsRoot],
      watch: false,
    })
    const promote = (candidate: SkillCandidate): SkillCandidate =>
      runtimeSkillNames.has(candidate.name) ? { ...candidate, rank: runtimeSkillRank } : candidate
    return {
      name: filesystem.name,
      async list(options) {
        const observation = await filesystem.list(options)
        if (Array.isArray(observation)) return observation.map(promote)
        return { ...observation, candidates: observation.candidates.map(promote) }
      },
      get: (candidate, options) => filesystem.get(candidate, options),
    }
  })
  ctx.effect(function* () {
    yield async () => filesystem.dispose()
  }, 'Marivo Runtime skill filesystem')
  const unobserve = ctx.on('fs/observed', (target, _observation, actor) => {
    if (actor === undefined || !('name' in actor)) return
    if (actor.name === 'edit' || actor.name === 'write') {
      filesystem.observeHostMutation(target.displayPath)
    }
  })
  let closing: Promise<void> | undefined
  return () => {
    if (closing) return closing
    closing = finishCleanup([unregister, unobserve, () => filesystem.dispose()])
    return closing
  }
}

interface ScopedRuntimeSkills {
  readonly scope: Scope
  readonly stop: () => Promise<void>
  users: number
}

/** Share a Runtime provider in each live Agent's enclosing preset layer. */
export function createRuntimeSkillScopes(ctx: Context, skillsRoot: string) {
  const scopes = new Map<ScopeKey, ScopedRuntimeSkills>()
  const agents = new Map<Agent, ScopeKey>()
  const retiring = new PendingTasks()
  const failures: unknown[] = []
  let active = true
  let closing: Promise<void> | undefined

  const releaseKey = (key: ScopeKey) => {
    const entry = scopes.get(key)
    if (!entry || --entry.users > 0) return
    scopes.delete(key)
    retiring.track(
      finishCleanup([entry.stop, () => entry.scope.dispose()]).catch((error) => {
        failures.push(error)
      }),
    )
  }
  const release = (agent: Agent) => {
    const key = agents.get(agent)
    if (key === undefined) return
    agents.delete(agent)
    releaseKey(key)
  }
  return {
    sync(agent: Agent): void {
      if (!active) return
      const agentKey = scopeOf(agent.ctx)
      const key = agentKey === undefined ? undefined : scopeParentOf(agentKey)
      const previous = agents.get(agent)
      if (key === previous) return
      if (key !== undefined) {
        let entry = scopes.get(key)
        if (!entry) {
          const scope = createScope(ctx, key)
          try {
            entry = { scope, stop: installRuntimeSkills(scope.ctx, skillsRoot), users: 0 }
            scopes.set(key, entry)
          } catch (error) {
            retiring.track(
              scope.dispose().catch((failure) => {
                failures.push(failure)
              }),
            )
            throw error
          }
        }
        entry.users++
        agents.set(agent, key)
      } else {
        agents.delete(agent)
      }
      if (previous !== undefined) releaseKey(previous)
    },
    release,
    close(): Promise<void> {
      if (closing) return closing
      active = false
      for (const agent of [...agents.keys()]) release(agent)
      closing = retiring.drain().then(() => {
        if (failures.length)
          throw new AggregateError(failures, 'Marivo Runtime skill cleanup failed')
      })
      return closing
    },
  }
}
