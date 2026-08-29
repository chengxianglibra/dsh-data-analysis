import type { ReportIssueV2 } from './document.ts'
import type {
  ReportDagArtifactProjection,
  ReportDagJobProjection,
  ReportSessionDagProjection,
} from './projection.ts'

export type ReportDagNodeKind = 'job' | 'artifact'
export type ReportDagEdgeKind = 'input' | 'produces' | 'reuses'

export interface CompiledDagNode {
  readonly key: string
  readonly domId: string
  readonly detailId: string
  readonly kind: ReportDagNodeKind
  readonly label: string
  readonly subtitle: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly job?: ReportDagJobProjection
  readonly artifact?: ReportDagArtifactProjection
}

export interface CompiledDagEdge {
  readonly from: string
  readonly to: string
  readonly kind: ReportDagEdgeKind
  readonly path: string
}

export interface CompiledDagComponent {
  readonly id: string
  readonly nodes: readonly CompiledDagNode[]
  readonly edges: readonly CompiledDagEdge[]
  readonly width: number
  readonly height: number
}

export interface CompiledSessionDag {
  readonly components: readonly CompiledDagComponent[]
  readonly jobs: readonly ReportDagJobProjection[]
  readonly artifacts: readonly ReportDagArtifactProjection[]
}

export type CompileSessionDagResult =
  | { readonly ok: true; readonly value: CompiledSessionDag }
  | { readonly ok: false; readonly issues: readonly ReportIssueV2[] }

interface RawEdge {
  readonly from: string
  readonly to: string
  readonly kind: ReportDagEdgeKind
}

const NODE_WIDTH = 184
const NODE_HEIGHT = 58
const COLUMN_GAP = 92
const ROW_GAP = 34
const PADDING = 28

function issue(code: string, message: string, repair: string): ReportIssueV2 {
  return { code, location: 'marivo.session_dag', message, repair }
}

function jobKey(id: string): string {
  return `job:${id}`
}

function artifactKey(ref: string): string {
  return `artifact:${ref}`
}

function shortIdentity(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 10)}…${value.slice(-10)}`
}

function stableCompare(left: string, right: string): number {
  return left.localeCompare(right)
}

function edgePath(from: CompiledDagNode, to: CompiledDagNode): string {
  const forward = to.x >= from.x
  const startX = forward ? from.x + from.width : from.x
  const endX = forward ? to.x : to.x + to.width
  const startY = from.y + from.height / 2
  const endY = to.y + to.height / 2
  const bend = Math.max(36, Math.abs(endX - startX) / 2)
  const firstX = forward ? startX + bend : startX - bend
  const secondX = forward ? endX - bend : endX + bend
  return `M ${startX} ${startY} C ${firstX} ${startY}, ${secondX} ${endY}, ${endX} ${endY}`
}

/** Compile the checked bipartite Session projection into deterministic layered DAG components. */
export function compileSessionDag(projection: ReportSessionDagProjection): CompileSessionDagResult {
  const driftIssues = projection.artifacts.flatMap((artifact) =>
    artifact.issues.filter(
      (artifactIssue) =>
        artifactIssue.code === 'dag-artifact-identity-drift' ||
        artifactIssue.code === 'dag-artifact-projection-drift',
    ),
  )
  if (driftIssues.length > 0) return { ok: false, issues: driftIssues }

  const jobByKey = new Map(projection.jobs.map((job) => [jobKey(job.id), job] as const))
  const artifactByKey = new Map(
    projection.artifacts.map((artifact) => [artifactKey(artifact.ref), artifact] as const),
  )
  const keys = [...artifactByKey.keys(), ...jobByKey.keys()].sort(stableCompare)
  const keySet = new Set(keys)
  const edges: RawEdge[] = []
  const edgeKeys = new Set<string>()
  for (const job of projection.jobs) {
    const targetJob = jobKey(job.id)
    for (const ref of job.inputArtifactRefs) {
      const sourceArtifact = artifactKey(ref)
      if (!keySet.has(sourceArtifact))
        return {
          ok: false,
          issues: [
            issue(
              'dag-artifact-missing',
              `Job ${JSON.stringify(job.id)} input Artifact ${JSON.stringify(ref)} is missing.`,
              'Repair the Session graph projection and render the complete report again.',
            ),
          ],
        }
      const identity = `${sourceArtifact}\u0000${targetJob}\u0000input`
      if (!edgeKeys.has(identity)) {
        edgeKeys.add(identity)
        edges.push({ from: sourceArtifact, to: targetJob, kind: 'input' })
      }
    }
    const output = artifactKey(job.outputArtifactRef)
    if (!keySet.has(output))
      return {
        ok: false,
        issues: [
          issue(
            'dag-artifact-missing',
            `Job ${JSON.stringify(job.id)} output Artifact ${JSON.stringify(job.outputArtifactRef)} is missing.`,
            'Repair the Session graph projection and render the complete report again.',
          ),
        ],
      }
    const outputArtifact = artifactByKey.get(output)
    if (outputArtifact?.status === 'boundary')
      return {
        ok: false,
        issues: [
          issue(
            'dag-job-output-not-main',
            `Job ${JSON.stringify(job.id)} output ${JSON.stringify(job.outputArtifactRef)} is not a main Artifact.`,
            'Exclude the non-main Job from the Session graph projection and render the report again.',
          ),
        ],
      }
    const kind: ReportDagEdgeKind = job.reusedArtifact ? 'reuses' : 'produces'
    const identity = `${targetJob}\u0000${output}\u0000${kind}`
    if (!edgeKeys.has(identity)) {
      edgeKeys.add(identity)
      edges.push({ from: targetJob, to: output, kind })
    }
  }

  const outgoing = new Map(keys.map((key) => [key, [] as string[]] as const))
  const incomingCount = new Map<string, number>(keys.map((key) => [key, 0]))
  const undirected = new Map(keys.map((key) => [key, new Set<string>()] as const))
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to)
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1)
    undirected.get(edge.from)?.add(edge.to)
    undirected.get(edge.to)?.add(edge.from)
  }
  for (const values of outgoing.values()) values.sort(stableCompare)

  const ready = keys
    .filter((key) => incomingCount.get(key) === 0)
    .sort(stableCompare)
    .reverse()
  const rank = new Map<string, number>(keys.map((key) => [key, 0]))
  let visited = 0
  while (ready.length > 0) {
    const key = ready.pop()
    if (key === undefined) break
    visited += 1
    for (const target of outgoing.get(key) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(key) ?? 0) + 1))
      const remaining = (incomingCount.get(target) ?? 0) - 1
      incomingCount.set(target, remaining)
      if (remaining === 0) {
        ready.push(target)
      }
    }
  }
  if (visited !== keys.length)
    return {
      ok: false,
      issues: [
        issue(
          'dag-cycle',
          'The checked Session action/Artifact graph contains a directed cycle.',
          'Repair the persisted Job input/output identities before rendering the report again.',
        ),
      ],
    }

  const components: string[][] = []
  const remaining = new Set(keys)
  const stableAdjacent = new Map(
    [...undirected.entries()].map(
      ([key, values]) => [key, [...values].sort(stableCompare)] as const,
    ),
  )
  for (const first of keys) {
    if (!remaining.delete(first)) continue
    const queue = [first]
    let queueIndex = 0
    const component: string[] = []
    while (queueIndex < queue.length) {
      const key = queue[queueIndex]
      queueIndex += 1
      if (key === undefined) break
      component.push(key)
      for (const adjacent of stableAdjacent.get(key) ?? []) {
        if (!remaining.delete(adjacent)) continue
        queue.push(adjacent)
      }
    }
    components.push(component)
  }

  const orderedComponents = components
    .map((component) => {
      let earliestJobTime = Number.POSITIVE_INFINITY
      for (const key of component) {
        const startedAt = jobByKey.get(key)?.startedAt
        if (startedAt === undefined) continue
        const timestamp = Date.parse(startedAt)
        if (Number.isFinite(timestamp) && timestamp < earliestJobTime) earliestJobTime = timestamp
      }
      return { component, earliestJobTime, stableKey: component[0] ?? '' }
    })
    .sort(
      (left, right) =>
        left.earliestJobTime - right.earliestJobTime ||
        left.stableKey.localeCompare(right.stableKey),
    )

  const compiledComponents = orderedComponents.map(
    ({ component: componentKeys }, componentIndex) => {
      const ranks = new Map<number, string[]>()
      for (const key of componentKeys) {
        const value = rank.get(key) ?? 0
        const items = ranks.get(value) ?? []
        items.push(key)
        ranks.set(value, items)
      }
      for (const values of ranks.values()) values.sort(stableCompare)
      const nodes: CompiledDagNode[] = []
      for (const [rankValue, rankKeys] of [...ranks.entries()].sort((a, b) => a[0] - b[0])) {
        for (const [row, key] of rankKeys.entries()) {
          const job = jobByKey.get(key)
          const artifact = artifactByKey.get(key)
          const index = nodes.length + 1
          nodes.push({
            key,
            domId: `dag-${String(componentIndex + 1)}-node-${String(index)}`,
            detailId: `dag-${String(componentIndex + 1)}-detail-${String(index)}`,
            kind: job === undefined ? 'artifact' : 'job',
            label: job?.intent ?? artifact?.family ?? 'Artifact',
            subtitle: shortIdentity(job?.id ?? artifact?.ref ?? key),
            x: PADDING + rankValue * (NODE_WIDTH + COLUMN_GAP),
            y: PADDING + row * (NODE_HEIGHT + ROW_GAP),
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            ...(job === undefined ? {} : { job }),
            ...(artifact === undefined ? {} : { artifact }),
          })
        }
      }
      const nodeByKey = new Map(nodes.map((node) => [node.key, node] as const))
      const componentEdges = edges
        .filter((edge) => nodeByKey.has(edge.from) && nodeByKey.has(edge.to))
        .map((edge) => ({
          ...edge,
          path: edgePath(nodeByKey.get(edge.from)!, nodeByKey.get(edge.to)!),
        }))
      const maxX = Math.max(...nodes.map((node) => node.x + node.width), NODE_WIDTH)
      const maxY = Math.max(...nodes.map((node) => node.y + node.height), NODE_HEIGHT)
      return {
        id: `dag-component-${String(componentIndex + 1)}`,
        nodes,
        edges: componentEdges,
        width: maxX + PADDING,
        height: maxY + PADDING,
      }
    },
  )

  return {
    ok: true,
    value: {
      components: compiledComponents,
      jobs: projection.jobs,
      artifacts: projection.artifacts,
    },
  }
}
