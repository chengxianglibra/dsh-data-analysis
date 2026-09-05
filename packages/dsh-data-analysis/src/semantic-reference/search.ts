import { type Candidate, LIMIT, type Projection, type RankedCandidate } from './contracts.ts'
export interface UsageScore {
  readonly count: number
  readonly last: number
}
export type UsageScores = ReadonlyMap<string, UsageScore>
export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ')
}
function tokens(text: string): string[] {
  return text.split(/[\s.:_-]+/u).filter(Boolean)
}
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
function length(text: string): number {
  return Array.from(text).length
}
export function dice(a: string, b: string): number {
  const grams = (text: string): Set<string> => {
    const chars = Array.from(text)
    return new Set(chars.slice(0, -2).map((_, i) => chars.slice(i, i + 3).join('')))
  }
  const left = grams(a),
    right = grams(b)
  if (!left.size || !right.size) return 0
  return (2 * [...left].filter((gram) => right.has(gram)).length) / (left.size + right.size)
}
interface Match {
  item: Candidate
  tier: number
  score: number
  field: number
}
function match(item: Candidate, query: string): Match {
  const name = normalize(item.name),
    path = normalize(item.ref.path),
    key = normalize(item.refKey)
  const fields = [name, path, key]
  const all = [...fields, normalize(item.ref.kind)]
  const searchTokens = all.flatMap(tokens)
  if (fields.includes(query)) return { item, tier: 0, score: 1, field: 0 }
  const prefixes = [...fields, ...searchTokens]
    .map((value, field) => ({ value, field }))
    .filter(({ value }) => value.startsWith(query))
  if (prefixes.length) {
    prefixes.sort((a, b) => length(a.value) - length(b.value) || a.field - b.field)
    const best = prefixes[0]!
    return {
      item,
      tier: 1,
      score: length(query) / length(best.value),
      field: best.field < 3 ? best.field : 3,
    }
  }
  const document = [...all, normalize(item.businessDefinition ?? '')].join(' ')
  const qt = tokens(query)
  if (qt.length && qt.every((token) => document.includes(token)))
    return {
      item,
      tier: 2,
      score: qt.reduce((sum, token) => sum + length(token), 0) / Math.max(1, length(document)),
      field: 0,
    }
  return {
    item,
    tier: 3,
    score:
      length(query) < 3
        ? 0
        : Math.max(...[name, ...tokens(path), path].map((value) => dice(query, value))),
    field: 0,
  }
}
export function search(
  projection: Projection,
  rawQuery: string,
  usage: UsageScores = new Map(),
): readonly RankedCandidate[] {
  const query = normalize(rawQuery)
  const heat = (a: Candidate, b: Candidate): number =>
    (usage.get(b.refKey)?.count ?? 0) - (usage.get(a.refKey)?.count ?? 0) ||
    (usage.get(b.refKey)?.last ?? 0) - (usage.get(a.refKey)?.last ?? 0)
  const fallback = (a: Candidate, b: Candidate): number =>
    projection.kinds.indexOf(a.ref.kind) - projection.kinds.indexOf(b.ref.kind) ||
    compareText(a.refKey, b.refKey)
  if (!query) {
    const recent = projection.items
      .filter((item) => (usage.get(item.refKey)?.count ?? 0) > 0)
      .sort((a, b) => heat(a, b) || fallback(a, b))
      .slice(0, 10)
    const keys = new Set(recent.map((item) => item.refKey))
    return [
      ...recent.map((item): RankedCandidate => ({ ...item, section: 'recent' })),
      ...projection.items
        .filter((item) => !keys.has(item.refKey))
        .sort(fallback)
        .slice(0, LIMIT - recent.length)
        .map((item): RankedCandidate => ({ ...item, section: 'kind' })),
    ]
  }
  const matches = projection.items.map((item) => match(item, query))
  const strictCount = matches.filter((item) => item.tier < 3).length
  return matches
    .filter((m) => m.tier < 3 || (strictCount < 12 && m.score >= 0.42))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        b.score - a.score ||
        a.field - b.field ||
        heat(a.item, b.item) ||
        compareText(a.item.refKey, b.item.refKey),
    )
    .slice(0, LIMIT)
    .map((m) => ({ ...m.item, section: m.tier === 3 ? 'fuzzy' : 'strict' }))
}
