import path from 'node:path'
import { parse as parseJavaScript } from 'acorn'
import { type DefaultTreeAdapterMap, parse as parseHtml } from 'parse5'
import postcss, { type AtRule, type Declaration, type Root, type Rule } from 'postcss'
import { SaxesParser } from 'saxes'
import { REPORT_CHECK_RULE_BY_CODE, validateReportContract } from './contracts.ts'
import {
  ReportCheckInvocationError,
  type ReportCheckIssueV1,
  type ReportCheckLimits,
  type ReportCheckOptions,
  type ReportCheckResultV1,
} from './types.ts'

type HtmlNode = DefaultTreeAdapterMap['node']
type HtmlElement = DefaultTreeAdapterMap['element']

export const DEFAULT_REPORT_CHECK_LIMITS: Readonly<ReportCheckLimits> = {
  maxFiles: 512,
  maxDepth: 32,
  maxTextFileBytes: 16 * 1024 * 1024,
  maxTotalTextBytes: 64 * 1024 * 1024,
  maxDataUrlBytes: 256 * 1024,
  maxIssues: 200,
}

const OPAQUE_EXTENSIONS = new Set([
  '.png',
  '.apng',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp4',
  '.webm',
  '.ogg',
  '.mp3',
  '.wav',
  '.flac',
  '.pdf',
  '.csv',
  '.tsv',
  '.parquet',
  '.arrow',
  '.feather',
])
const SAFE_DATA_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
])
const LINK_DEPENDENCY_RELATIONS = new Set([
  'apple-touch-icon',
  'icon',
  'manifest',
  'modulepreload',
  'preload',
  'prefetch',
  'stylesheet',
])
const DYNAMIC_RESOURCE_PROPERTIES = new Set(['data', 'href', 'poster', 'src', 'srcset'])
const SECRET_NAME =
  /(?:^|[-_.])(api[-_]?key|access[-_]?token|secret|password|credential|private[-_]?key)(?:$|[-_.])/i
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const

interface Location {
  line: number | null
  column: number | null
}

interface ResourceRequest {
  absolutePath: string
  displayPath: string
  depth: number
  originPath: string
  location: Location
}

interface RegistryOperation {
  registry: 'dataset' | 'trace'
  kind: 'register' | 'read'
  method: string
  id: string | null
  payload?: unknown
  location: Location
}

interface JavaScriptAnalysis {
  operations: RegistryOperation[]
  bodyCount: number
  hasDynamicNetwork: boolean
}

interface ScriptLoad {
  absolutePath: string | null
  analysis: JavaScriptAnalysis | null
  type: 'classic' | 'module' | 'json' | 'other'
  async: boolean
  defer: boolean
  path: string
  location: Location
}

interface HtmlPage {
  absolutePath: string
  displayPath: string
  ids: Set<string>
  fragmentLinks: Array<{
    targetAbsolutePath: string
    fragment: string
    path: string
    location: Location
  }>
  scripts: ScriptLoad[]
  hasInteractive: boolean
}

interface ScanState {
  workspaceRoot: string
  bundleRoot: string
  entryPath: string
  files: ReportCheckOptions['files']
  signal: AbortSignal
  limits: ReportCheckLimits
  issues: ReportCheckIssueV1[]
  queued: Set<string>
  processed: Set<string>
  queue: ResourceRequest[]
  htmlPages: HtmlPage[]
  javascript: Map<string, JavaScriptAnalysis>
  moduleScripts: Set<string>
  filesChecked: number
  bytesChecked: number
  textBytesChecked: number
  coverageIncomplete: boolean
  externalObserved: boolean
  focusStyleObserved: boolean
  motionObserved: boolean
  reducedMotionObserved: boolean
}

function abortIfNeeded(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw new ReportCheckInvocationError('aborted', 'report check was cancelled', {
    cause: signal.reason,
  })
}

function relativeSlash(root: string, target: string): string {
  const relative = path.relative(root, target)
  return (relative === '' ? '.' : relative).split(path.sep).join('/')
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

function locationFrom(
  value: { startLine?: number; startCol?: number } | null | undefined,
): Location {
  return { line: value?.startLine ?? null, column: value?.startCol ?? null }
}

function sourceOffsetLocation(text: string, offset: number): Location {
  let line = 1
  let column = 1
  for (let index = 0; index < offset; index++) {
    if (text[index] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}

function htmlParseErrorLocation(
  text: string,
  error: { code: string; startLine?: number; startCol?: number },
): Location {
  if (error.code !== 'eof-in-tag') return locationFrom(error)
  let tagStart = -1
  let quote: '"' | "'" | null = null
  let quoteOffset = -1
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (tagStart < 0 && character === '<') {
      tagStart = index
      continue
    }
    if (tagStart < 0) continue
    if (quote === null && (character === '"' || character === "'")) {
      quote = character
      quoteOffset = index
    } else if (quote !== null && character === quote) {
      quote = null
      quoteOffset = -1
    } else if (quote === null && character === '>') {
      tagStart = -1
    }
  }
  return tagStart < 0
    ? locationFrom(error)
    : quoteOffset < 0
      ? sourceOffsetLocation(text, tagStart)
      : sourceOffsetLocation(text, quoteOffset)
}

function addIssue(
  state: ScanState,
  code: string,
  displayPath: string,
  location: Location,
  message: string,
  repair: string | null = null,
): void {
  const rule = REPORT_CHECK_RULE_BY_CODE.get(code)
  if (rule === undefined) {
    throw new ReportCheckInvocationError('checker-internal', `unknown report check rule: ${code}`)
  }
  state.issues.push({
    severity: rule.severity,
    code,
    path: displayPath,
    line: location.line,
    column: location.column,
    message,
    repair,
  })
}

function attribute(element: HtmlElement, name: string): string | null {
  return element.attrs.find((item) => item.name.toLowerCase() === name)?.value ?? null
}

function hasAttribute(element: HtmlElement, name: string): boolean {
  return element.attrs.some((item) => item.name.toLowerCase() === name)
}

function linkReferenceKind(element: HtmlElement): 'dependency' | 'navigation' {
  const relations = attribute(element, 'rel')?.toLowerCase().trim().split(/\s+/) ?? []
  return relations.some((relation) => LINK_DEPENDENCY_RELATIONS.has(relation))
    ? 'dependency'
    : 'navigation'
}

function linkAllowsRasterDataUrl(element: HtmlElement): boolean {
  const relations = attribute(element, 'rel')?.toLowerCase().trim().split(/\s+/) ?? []
  return (
    relations.some((relation) => ['apple-touch-icon', 'icon'].includes(relation)) ||
    (relations.includes('preload') && attribute(element, 'as')?.toLowerCase() === 'image')
  )
}

function elementLocation(element: HtmlElement, attributeName?: string): Location {
  const source = element.sourceCodeLocation
  if (attributeName !== undefined && source?.attrs?.[attributeName] !== undefined) {
    return locationFrom(source.attrs[attributeName])
  }
  return locationFrom(source?.startTag ?? source)
}

function childNodes(node: HtmlNode): HtmlNode[] {
  return 'childNodes' in node && Array.isArray(node.childNodes) ? node.childNodes : []
}

function elements(root: HtmlNode): HtmlElement[] {
  const result: HtmlElement[] = []
  const stack: HtmlNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    if ('tagName' in node && typeof node.tagName === 'string') result.push(node as HtmlElement)
    const children = childNodes(node)
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]!)
  }
  return result
}

function textContent(node: HtmlNode): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  return childNodes(node).map(textContent).join('')
}

function decodeDataUrl(value: string): { mime: string; bytes: number } | null {
  const comma = value.indexOf(',')
  if (comma < 5) return null
  const header = value.slice(5, comma)
  const mime = (header.split(';')[0] ?? '').toLowerCase()
  const body = value.slice(comma + 1)
  try {
    if (/(?:^|;)base64(?:;|$)/i.test(header)) {
      return { mime, bytes: Buffer.from(body, 'base64').byteLength }
    }
    return { mime, bytes: Buffer.byteLength(decodeURIComponent(body)) }
  } catch {
    return null
  }
}

function splitUrl(value: string): { pathPart: string; fragment: string | null } {
  const hash = value.indexOf('#')
  const beforeHash = hash < 0 ? value : value.slice(0, hash)
  const query = beforeHash.indexOf('?')
  return {
    pathPart: query < 0 ? beforeHash : beforeHash.slice(0, query),
    fragment: hash < 0 ? null : value.slice(hash + 1),
  }
}

function externalKind(value: string): 'network' | 'action' | 'file' | 'dangerous' | null {
  if (/^javascript:/i.test(value)) return 'dangerous'
  if (/^file:/i.test(value)) return 'file'
  if (/^(?:https?:)?\/\//i.test(value)) return 'network'
  if (/^(?:mailto|tel):/i.test(value)) return 'action'
  return null
}

function reference(
  state: ScanState,
  page: HtmlPage | null,
  fromAbsolutePath: string,
  fromDisplayPath: string,
  rawValue: string,
  kind: 'dependency' | 'navigation',
  depth: number,
  location: Location,
  allowRasterDataUrl = false,
): void {
  const value = rawValue.trim()
  if (value === '') {
    addIssue(
      state,
      'html.element-attributes-invalid',
      fromDisplayPath,
      location,
      'resource reference must not be empty',
      'Provide a non-empty local or external reference.',
    )
    return
  }
  const external = externalKind(value)
  if (external === 'dangerous') {
    addIssue(
      state,
      'html.dangerous-url-scheme',
      fromDisplayPath,
      location,
      'javascript: URLs are forbidden',
      'Use a normal link or an explicit event listener.',
    )
    return
  }
  if (external === 'file') {
    addIssue(
      state,
      'resource.file-url-forbidden',
      fromDisplayPath,
      location,
      'file: URLs bypass the report bundle boundary',
      'Use a relative bundle path.',
    )
    return
  }
  if (external === 'network') {
    state.externalObserved = true
    addIssue(
      state,
      kind === 'dependency'
        ? 'resource.external-dependency-unchecked'
        : 'resource.external-navigation-unchecked',
      fromDisplayPath,
      location,
      kind === 'dependency'
        ? 'external dependency was observed but not fetched or validated'
        : 'external navigation target was observed but not validated',
    )
    return
  }
  if (external === 'action') {
    state.externalObserved = true
    addIssue(
      state,
      'resource.external-action-unchecked',
      fromDisplayPath,
      location,
      'external mail or telephone action was observed but not validated',
    )
    return
  }
  if (value.startsWith('data:')) {
    const decoded = decodeDataUrl(value)
    if (!allowRasterDataUrl || decoded === null || !SAFE_DATA_IMAGE_TYPES.has(decoded.mime)) {
      addIssue(
        state,
        'resource.data-url-kind-forbidden',
        fromDisplayPath,
        location,
        'only bounded raster image data URLs are allowed',
        'Use a local bundle file for scripts, HTML, fonts, SVG, or other data.',
      )
      return
    }
    if (decoded.bytes > state.limits.maxDataUrlBytes) {
      state.coverageIncomplete = true
      addIssue(
        state,
        'budget.data-url-bytes-exceeded',
        fromDisplayPath,
        location,
        `data URL is ${decoded.bytes} bytes; limit is ${state.limits.maxDataUrlBytes}`,
        'Write the image as a local bundle file or reduce its size.',
      )
    }
    return
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    addIssue(
      state,
      'resource.outside-bundle',
      fromDisplayPath,
      location,
      'absolute resource paths are outside the report bundle contract',
      'Use a relative path below the bundle root.',
    )
    return
  }
  const parts = splitUrl(value)
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(parts.pathPart)
  } catch {
    addIssue(
      state,
      'html.element-attributes-invalid',
      fromDisplayPath,
      location,
      'resource path contains invalid percent encoding',
    )
    return
  }
  const targetAbsolutePath = path.resolve(path.dirname(fromAbsolutePath), decodedPath || '.')
  if (!inside(state.bundleRoot, targetAbsolutePath)) {
    addIssue(
      state,
      'resource.outside-bundle',
      fromDisplayPath,
      location,
      'resource path escapes the report bundle',
      'Move the resource below the bundle root and use a relative path.',
    )
    return
  }
  if (parts.fragment !== null && page !== null) {
    if (parts.fragment === '') {
      addIssue(
        state,
        'html.fragment-target-missing',
        fromDisplayPath,
        location,
        'empty fragment target is not allowed',
      )
    } else {
      page.fragmentLinks.push({
        targetAbsolutePath: decodedPath === '' ? fromAbsolutePath : targetAbsolutePath,
        fragment: parts.fragment,
        path: fromDisplayPath,
        location,
      })
    }
  }
  if (decodedPath === '') return
  if (depth > state.limits.maxDepth) {
    state.coverageIncomplete = true
    addIssue(
      state,
      'budget.graph-depth-exceeded',
      fromDisplayPath,
      location,
      `resource graph depth exceeds ${state.limits.maxDepth}`,
      'Flatten or split the report bundle dependency graph.',
    )
    return
  }
  if (!state.queued.has(targetAbsolutePath)) {
    if (state.queued.size >= state.limits.maxFiles) {
      state.coverageIncomplete = true
      addIssue(
        state,
        'budget.file-count-exceeded',
        fromDisplayPath,
        location,
        `resource graph exceeds ${state.limits.maxFiles} files`,
        'Remove unused resources or split the report.',
      )
      return
    }
    state.queued.add(targetAbsolutePath)
    state.queue.push({
      absolutePath: targetAbsolutePath,
      displayPath: relativeSlash(state.bundleRoot, targetAbsolutePath),
      depth,
      originPath: fromDisplayPath,
      location,
    })
  }
}

function parseSrcset(value: string): string[] {
  const result: string[] = []
  const whitespace = /[\t\n\f\r ]/
  let position = 0
  while (position < value.length) {
    while (
      position < value.length &&
      (whitespace.test(value[position]!) || value[position] === ',')
    ) {
      position += 1
    }
    if (position >= value.length) break

    const start = position
    while (position < value.length && !whitespace.test(value[position]!)) position += 1
    let target = value.slice(start, position)
    let endedByComma = false
    while (target.endsWith(',')) {
      target = target.slice(0, -1)
      endedByComma = true
    }
    if (target !== '') result.push(target)
    if (endedByComma) continue

    let parentheses = 0
    while (position < value.length) {
      const character = value[position++]!
      if (character === '(') parentheses += 1
      else if (character === ')' && parentheses > 0) parentheses -= 1
      else if (character === ',' && parentheses === 0) break
    }
  }
  return result
}

function cssUrls(value: string): string[] {
  const result: string[] = []
  let index = 0
  while (index < value.length) {
    const found = value.toLowerCase().indexOf('url(', index)
    if (found < 0) break
    let cursor = found + 4
    while (/\s/.test(value[cursor] ?? '')) cursor++
    const quote = value[cursor] === '"' || value[cursor] === "'" ? value[cursor++] : null
    let output = ''
    let escaped = false
    while (cursor < value.length) {
      const char = value[cursor++]!
      if (escaped) {
        output += char
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if ((quote !== null && char === quote) || (quote === null && char === ')')) break
      output += char
    }
    result.push(output.trim())
    if (quote === null) {
      index = cursor
    } else {
      const close = value.indexOf(')', cursor)
      index = close < 0 ? cursor : close + 1
    }
  }
  return result
}

function importTarget(params: string): string | null {
  const trimmed = params.trim()
  if (trimmed.startsWith('url(')) return cssUrls(trimmed)[0] ?? null
  const quote = trimmed[0]
  if (quote !== '"' && quote !== "'") return null
  const end = trimmed.indexOf(quote, 1)
  return end < 0 ? null : trimmed.slice(1, end)
}

function cssLocation(node: { source?: { start?: { line: number; column: number } } }): Location {
  return {
    line: node.source?.start?.line ?? null,
    column: node.source?.start?.column ?? null,
  }
}

function analyzeCss(
  state: ScanState,
  text: string,
  absolutePath: string,
  displayPath: string,
  depth: number,
  baseLine = 0,
): void {
  let root: Root
  try {
    root = postcss.parse(text, { from: displayPath })
  } catch (error) {
    const candidate = error as { line?: number; column?: number; reason?: string }
    addIssue(
      state,
      'css.parse-error',
      displayPath,
      {
        line: candidate.line === undefined ? null : candidate.line + baseLine,
        column: candidate.column ?? null,
      },
      candidate.reason ?? 'CSS syntax is invalid',
      'Correct the CSS syntax before delivery.',
    )
    return
  }
  root.walkAtRules((rule: AtRule) => {
    const location = cssLocation(rule)
    if (location.line !== null) location.line += baseLine
    if (rule.name.toLowerCase() === 'import') {
      const target = importTarget(rule.params)
      if (target !== null) {
        reference(state, null, absolutePath, displayPath, target, 'dependency', depth + 1, location)
      }
    }
    if (
      rule.name.toLowerCase() === 'media' &&
      /prefers-reduced-motion\s*:\s*reduce/i.test(rule.params)
    ) {
      state.reducedMotionObserved = true
    }
  })
  root.walkDecls((declaration: Declaration) => {
    const location = cssLocation(declaration)
    if (location.line !== null) location.line += baseLine
    for (const target of cssUrls(declaration.value)) {
      reference(
        state,
        null,
        absolutePath,
        displayPath,
        target,
        'dependency',
        depth + 1,
        location,
        true,
      )
    }
    const property = declaration.prop.toLowerCase()
    if (
      (property.startsWith('animation') || property.startsWith('transition')) &&
      !/^(?:none|0(?:s|ms)?)(?:\s|$)/i.test(declaration.value.trim())
    ) {
      state.motionObserved = true
    }
  })
  root.walkRules((rule: Rule) => {
    const selector = rule.selector
    if (/:focus(?:-visible|-within)?\b/i.test(selector)) state.focusStyleObserved = true
    if (!/:hover\b/i.test(selector)) return
    const reveals = rule.nodes.some(
      (node) =>
        node.type === 'decl' &&
        ['display', 'visibility', 'opacity', 'content'].includes(node.prop.toLowerCase()),
    )
    if (reveals && !/:focus(?:-visible|-within)?\b/i.test(selector)) {
      const location = cssLocation(rule)
      if (location.line !== null) location.line += baseLine
      addIssue(
        state,
        'a11y.hover-only-content',
        displayPath,
        location,
        'CSS reveals content on hover without an equivalent focus selector',
        'Add a focus/focus-visible path or use an always-accessible disclosure control.',
      )
    }
  })
}

interface AcornNode {
  type: string
  start: number
  end: number
  loc?: { start: { line: number; column: number } }
  [key: string]: unknown
}

function isNode(value: unknown): value is AcornNode {
  return (
    typeof value === 'object' && value !== null && typeof (value as AcornNode).type === 'string'
  )
}

function walkJavaScript(root: AcornNode, visit: (node: AcornNode) => void): void {
  const stack: AcornNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    visit(node)
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index--) {
          if (isNode(value[index])) stack.push(value[index])
        }
      } else if (isNode(value)) {
        stack.push(value)
      }
    }
  }
}

function memberCall(node: AcornNode): { object: string; method: string; args: AcornNode[] } | null {
  if (node.type !== 'CallExpression') return null
  const callee = node.callee
  if (!isNode(callee) || callee.type !== 'MemberExpression' || callee.computed === true) return null
  const object = callee.object
  const property = callee.property
  if (
    !isNode(object) ||
    object.type !== 'Identifier' ||
    typeof object.name !== 'string' ||
    !isNode(property) ||
    property.type !== 'Identifier' ||
    typeof property.name !== 'string'
  ) {
    return null
  }
  const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : []
  return { object: object.name, method: property.name, args }
}

function literalString(node: AcornNode | undefined): string | null {
  return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null
}

function memberProperty(node: unknown): string | null {
  if (!isNode(node) || node.type !== 'MemberExpression') return null
  const property = node.property
  if (!isNode(property)) return null
  if (node.computed === true) return literalString(property)
  return property.type === 'Identifier' && typeof property.name === 'string' ? property.name : null
}

function recordJavaScriptResourceReference(
  state: ScanState,
  node: AcornNode,
  valueNode: AcornNode | undefined,
  absolutePath: string,
  displayPath: string,
  depth: number,
  baseLine: number,
): boolean {
  const target = literalString(valueNode)
  if (target === null) return true
  reference(
    state,
    null,
    absolutePath,
    displayPath,
    target,
    'dependency',
    depth + 1,
    jsLocation(node, baseLine),
  )
  return false
}

function markModuleReference(state: ScanState, fromAbsolutePath: string, value: string): void {
  if (externalKind(value) !== null || value.startsWith('data:')) return
  const parts = splitUrl(value)
  if (path.posix.isAbsolute(parts.pathPart) || path.win32.isAbsolute(parts.pathPart)) return
  try {
    state.moduleScripts.add(
      path.resolve(path.dirname(fromAbsolutePath), decodeURIComponent(parts.pathPart)),
    )
  } catch {
    // The shared reference admission emits the path diagnostic.
  }
}

function jsLocation(node: AcornNode, baseLine: number): Location {
  return {
    line: node.loc === undefined ? null : node.loc.start.line + baseLine,
    column: node.loc === undefined ? null : node.loc.start.column + 1,
  }
}

function analyzeJavaScript(
  state: ScanState,
  text: string,
  absolutePath: string,
  displayPath: string,
  depth: number,
  sourceType: 'script' | 'module',
  baseLine = 0,
): JavaScriptAnalysis | null {
  let program: AcornNode
  try {
    program = parseJavaScript(text, {
      ecmaVersion: 'latest',
      sourceType,
      locations: true,
      allowHashBang: true,
    }) as unknown as AcornNode
  } catch (error) {
    const candidate = error as { message?: string; loc?: { line: number; column: number } }
    addIssue(
      state,
      'javascript.parse-error',
      displayPath,
      {
        line: candidate.loc === undefined ? null : candidate.loc.line + baseLine,
        column: candidate.loc === undefined ? null : candidate.loc.column + 1,
      },
      candidate.message ?? 'JavaScript syntax is invalid',
      'Correct the JavaScript syntax before delivery.',
    )
    return null
  }
  const operations: RegistryOperation[] = []
  let hasDynamicNetwork = false
  walkJavaScript(program, (node) => {
    abortIfNeeded(state.signal)
    const call = memberCall(node)
    if (call !== null && ['ReportData', 'ReportTrace'].includes(call.object)) {
      const registry = call.object === 'ReportData' ? 'dataset' : 'trace'
      if (call.method === 'register') {
        let payload: unknown
        if (call.args[1] !== undefined) {
          try {
            payload = JSON.parse(text.slice(call.args[1].start, call.args[1].end))
          } catch {
            payload = undefined
          }
        }
        operations.push({
          registry,
          kind: 'register',
          method: call.method,
          id: literalString(call.args[0]),
          payload,
          location: jsLocation(node, baseLine),
        })
      } else if (
        (registry === 'dataset' && ['get', 'records'].includes(call.method)) ||
        (registry === 'trace' && call.method === 'get')
      ) {
        operations.push({
          registry,
          kind: 'read',
          method: call.method,
          id: literalString(call.args[0]),
          location: jsLocation(node, baseLine),
        })
      }
    }
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') {
      const source = isNode(node.source) ? literalString(node.source) : null
      if (source !== null) {
        if (sourceType === 'module') markModuleReference(state, absolutePath, source)
        reference(
          state,
          null,
          absolutePath,
          displayPath,
          source,
          'dependency',
          depth + 1,
          jsLocation(node, baseLine),
        )
      }
    }
    if (node.type === 'ExportNamedDeclaration' && isNode(node.source)) {
      const source = literalString(node.source)
      if (source !== null) {
        if (sourceType === 'module') markModuleReference(state, absolutePath, source)
        reference(
          state,
          null,
          absolutePath,
          displayPath,
          source,
          'dependency',
          depth + 1,
          jsLocation(node, baseLine),
        )
      }
    }
    if (node.type === 'ImportExpression' && isNode(node.source)) {
      const source = literalString(node.source)
      if (source !== null) {
        markModuleReference(state, absolutePath, source)
        reference(
          state,
          null,
          absolutePath,
          displayPath,
          source,
          'dependency',
          depth + 1,
          jsLocation(node, baseLine),
        )
      } else {
        hasDynamicNetwork = true
      }
    }
    if (
      node.type === 'AssignmentExpression' &&
      DYNAMIC_RESOURCE_PROPERTIES.has(memberProperty(node.left) ?? '')
    ) {
      const dynamic = recordJavaScriptResourceReference(
        state,
        node,
        isNode(node.right) ? node.right : undefined,
        absolutePath,
        displayPath,
        depth,
        baseLine,
      )
      hasDynamicNetwork ||= dynamic
    }
    if (
      node.type === 'CallExpression' &&
      memberProperty(node.callee) === 'setAttribute' &&
      Array.isArray(node.arguments)
    ) {
      const args = node.arguments.filter(isNode)
      const resourceAttribute = literalString(args[0])?.toLowerCase() ?? ''
      if (DYNAMIC_RESOURCE_PROPERTIES.has(resourceAttribute)) {
        const dynamic = recordJavaScriptResourceReference(
          state,
          node,
          args[1],
          absolutePath,
          displayPath,
          depth,
          baseLine,
        )
        hasDynamicNetwork ||= dynamic
      }
    }
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee
      if (
        isNode(callee) &&
        callee.type === 'Identifier' &&
        typeof callee.name === 'string' &&
        ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].includes(callee.name)
      ) {
        hasDynamicNetwork = true
      }
    }
  })
  if (hasDynamicNetwork) {
    state.externalObserved = true
    addIssue(
      state,
      'resource.dynamic-network-unchecked',
      displayPath,
      { line: 1 + baseLine, column: 1 },
      'dynamic network capability was observed but runtime targets were not inspected',
    )
  }
  const bodyCount = Array.isArray(program.body) ? program.body.length : 0
  if (operations.some((operation) => operation.kind === 'register') && bodyCount !== 1) {
    for (const operation of operations.filter((item) => item.kind === 'register')) {
      addIssue(
        state,
        operation.registry === 'dataset' ? 'dataset.schema-invalid' : 'trace.schema-invalid',
        displayPath,
        operation.location,
        'a registration file must contain exactly one static register call',
        'Move other logic into a consumer script.',
      )
    }
  }
  return { operations, bodyCount, hasDynamicNetwork }
}

function analyzeSvg(state: ScanState, text: string, displayPath: string): void {
  let failure: Error | null = null
  let hasTitle = false
  let hasDescription = false
  const parser = new SaxesParser({ xmlns: false })
  parser.on('opentag', (tag) => {
    if (tag.name.toLowerCase() === 'title') hasTitle = true
    if (tag.name.toLowerCase() === 'desc') hasDescription = true
  })
  parser.on('error', (error) => {
    failure ??= error
  })
  try {
    parser.write(text).close()
  } catch (error) {
    failure ??= error as Error
  }
  if (failure !== null) {
    addIssue(
      state,
      'svg.parse-error',
      displayPath,
      { line: parser.line + 1, column: parser.column + 1 },
      failure.message,
      'Correct the SVG/XML syntax before delivery.',
    )
    return
  }
  if (!hasTitle || !hasDescription) {
    addIssue(
      state,
      'a11y.svg-name-missing',
      displayPath,
      { line: 1, column: 1 },
      'standalone SVG must contain both title and desc elements',
      'Add concise title and desc elements.',
    )
  }
}

function named(element: HtmlElement): boolean {
  return (
    textContent(element).trim() !== '' ||
    (attribute(element, 'aria-label')?.trim() ?? '') !== '' ||
    (attribute(element, 'aria-labelledby')?.trim() ?? '') !== '' ||
    (attribute(element, 'title')?.trim() ?? '') !== ''
  )
}

function analyzeHtml(
  state: ScanState,
  text: string,
  absolutePath: string,
  displayPath: string,
  depth: number,
): HtmlPage {
  const parserErrors: Array<{
    code: string
    startLine?: number
    startCol?: number
  }> = []
  const document = parseHtml(text, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => parserErrors.push(error),
  })
  for (const error of parserErrors) {
    addIssue(
      state,
      'html.parse-error',
      displayPath,
      htmlParseErrorLocation(text, error),
      `HTML parser error: ${error.code}`,
      'Correct the malformed HTML token or nesting.',
    )
  }
  const all = elements(document)
  const page: HtmlPage = {
    absolutePath,
    displayPath,
    ids: new Set(),
    fragmentLinks: [],
    scripts: [],
    hasInteractive: false,
  }
  const doctypes = childNodes(document).filter((node) => node.nodeName === '#documentType')
  if (doctypes.length !== 1) {
    addIssue(
      state,
      'html.doctype-missing',
      displayPath,
      { line: 1, column: 1 },
      'document must contain one HTML doctype',
      'Add <!doctype html> as the first declaration.',
    )
  }
  const htmlElements = all.filter((element) => element.tagName === 'html')
  if (htmlElements.length !== 1 || (attribute(htmlElements[0]!, 'lang')?.trim() ?? '') === '') {
    addIssue(
      state,
      'html.lang-missing',
      displayPath,
      htmlElements[0] === undefined
        ? { line: 1, column: 1 }
        : elementLocation(htmlElements[0], 'lang'),
      'html element must declare a non-empty lang attribute',
      'Set lang to the report language, for example zh-CN.',
    )
  }
  const titles = all.filter((element) => element.tagName === 'title')
  if (titles.length !== 1 || textContent(titles[0]!).trim() === '') {
    addIssue(
      state,
      'html.title-invalid',
      displayPath,
      titles[0] === undefined ? { line: 1, column: 1 } : elementLocation(titles[0]),
      'document must contain one non-empty title',
      'Add one descriptive title element.',
    )
  }
  const viewport = all.find(
    (element) =>
      element.tagName === 'meta' && attribute(element, 'name')?.toLowerCase() === 'viewport',
  )
  if (viewport === undefined || (attribute(viewport, 'content')?.trim() ?? '') === '') {
    addIssue(
      state,
      'html.viewport-missing',
      displayPath,
      viewport === undefined ? { line: 1, column: 1 } : elementLocation(viewport),
      'document must declare a non-empty viewport meta tag',
      'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    )
  }
  const main = all.filter(
    (element) => element.tagName === 'main' || attribute(element, 'role') === 'main',
  )
  if (main.length !== 1) {
    addIssue(
      state,
      'html.main-invalid',
      displayPath,
      main[0] === undefined ? { line: 1, column: 1 } : elementLocation(main[0]),
      'document must contain exactly one main content region',
      'Use one main element, or one role="main" when no main element exists.',
    )
  }

  const duplicateIds = new Set<string>()
  for (const element of all) {
    const id = attribute(element, 'id')
    if (id !== null && id !== '') {
      if (page.ids.has(id)) duplicateIds.add(id)
      page.ids.add(id)
    }
  }
  for (const id of duplicateIds) {
    const element = all.find((candidate) => attribute(candidate, 'id') === id)!
    addIssue(
      state,
      'html.duplicate-id',
      displayPath,
      elementLocation(element, 'id'),
      `duplicate id ${JSON.stringify(id)}`,
      'Give every element a unique id.',
    )
  }

  const labels = new Set(
    all
      .filter((element) => element.tagName === 'label')
      .map((element) => attribute(element, 'for'))
      .filter((value): value is string => value !== null && value !== ''),
  )
  const headings: Array<{ level: number; element: HtmlElement }> = []
  for (const element of all) {
    abortIfNeeded(state.signal)
    const tag = element.tagName.toLowerCase()
    const location = elementLocation(element)
    const id = attribute(element, 'id')
    const name = attribute(element, 'name')
    if ((id !== null && SECRET_NAME.test(id)) || (name !== null && SECRET_NAME.test(name))) {
      addIssue(
        state,
        'security.secret-like-name',
        displayPath,
        elementLocation(element, id !== null && SECRET_NAME.test(id) ? 'id' : 'name'),
        'secret-like identifier name was observed; values were not inspected',
        'Remove secret-bearing fields and use non-sensitive display names.',
      )
    }
    for (const ariaName of ['aria-labelledby', 'aria-describedby']) {
      const refs = attribute(element, ariaName)?.trim().split(/\s+/).filter(Boolean) ?? []
      for (const ref of refs) {
        if (!page.ids.has(ref)) {
          addIssue(
            state,
            'html.aria-reference-missing',
            displayPath,
            elementLocation(element, ariaName),
            `${ariaName} references missing id ${JSON.stringify(ref)}`,
            'Reference an existing element id.',
          )
        }
      }
    }
    if (tag === 'base') {
      addIssue(
        state,
        'html.base-element-forbidden',
        displayPath,
        location,
        'base elements can rewrite the report bundle path boundary',
        'Remove the base element and use explicit relative paths.',
      )
    }
    const href = attribute(element, 'href')
    const src = attribute(element, 'src')
    if (tag === 'link' && href !== null) {
      reference(
        state,
        page,
        absolutePath,
        displayPath,
        href,
        linkReferenceKind(element),
        depth + 1,
        elementLocation(element, 'href'),
        linkAllowsRasterDataUrl(element),
      )
    } else if (tag === 'a' && href !== null) {
      reference(
        state,
        page,
        absolutePath,
        displayPath,
        href,
        'navigation',
        depth + 1,
        elementLocation(element, 'href'),
      )
    }
    if (['img', 'source', 'video', 'audio'].includes(tag) && src !== null) {
      reference(
        state,
        page,
        absolutePath,
        displayPath,
        src,
        'dependency',
        depth + 1,
        elementLocation(element, 'src'),
        tag === 'img' || tag === 'source',
      )
    }
    for (const target of parseSrcset(attribute(element, 'srcset') ?? '')) {
      reference(
        state,
        page,
        absolutePath,
        displayPath,
        target,
        'dependency',
        depth + 1,
        elementLocation(element, 'srcset'),
        tag === 'img' || tag === 'source',
      )
    }
    if (tag === 'video' && attribute(element, 'poster') !== null) {
      reference(
        state,
        page,
        absolutePath,
        displayPath,
        attribute(element, 'poster')!,
        'dependency',
        depth + 1,
        elementLocation(element, 'poster'),
        true,
      )
    }
    if (tag === 'object' && attribute(element, 'data') !== null) {
      reference(
        state,
        page,
        absolutePath,
        displayPath,
        attribute(element, 'data')!,
        'dependency',
        depth + 1,
        elementLocation(element, 'data'),
      )
    }
    if (tag === 'style') {
      analyzeCss(
        state,
        textContent(element),
        absolutePath,
        displayPath,
        depth,
        (element.sourceCodeLocation?.startTag?.endLine ?? 1) - 1,
      )
    }
    const inlineStyle = attribute(element, 'style')
    if (inlineStyle !== null) {
      analyzeCss(
        state,
        `x{${inlineStyle}}`,
        absolutePath,
        displayPath,
        depth,
        (elementLocation(element, 'style').line ?? 1) - 1,
      )
    }
    if (tag === 'script') {
      const type = attribute(element, 'type')?.trim().toLowerCase() ?? ''
      const scriptType: ScriptLoad['type'] =
        type === 'module'
          ? 'module'
          : type === '' || ['text/javascript', 'application/javascript'].includes(type)
            ? 'classic'
            : ['application/json', 'application/ld+json'].includes(type)
              ? 'json'
              : 'other'
      const scriptLocation = elementLocation(element, src === null ? undefined : 'src')
      const load: ScriptLoad = {
        absolutePath: null,
        analysis: null,
        type: scriptType,
        async: hasAttribute(element, 'async'),
        defer: hasAttribute(element, 'defer'),
        path: displayPath,
        location: scriptLocation,
      }
      if (src !== null) {
        const parts = splitUrl(src)
        if (
          externalKind(src) === null &&
          !src.startsWith('data:') &&
          !path.posix.isAbsolute(parts.pathPart) &&
          !path.win32.isAbsolute(parts.pathPart)
        ) {
          try {
            load.absolutePath = path.resolve(
              path.dirname(absolutePath),
              decodeURIComponent(parts.pathPart),
            )
            load.path = relativeSlash(state.bundleRoot, load.absolutePath)
            if (scriptType === 'module') state.moduleScripts.add(load.absolutePath)
          } catch {
            // The shared reference admission emits the invalid encoding diagnostic.
          }
        }
        reference(
          state,
          page,
          absolutePath,
          displayPath,
          src,
          'dependency',
          depth + 1,
          scriptLocation,
        )
      } else if (scriptType === 'classic' || scriptType === 'module') {
        load.analysis = analyzeJavaScript(
          state,
          textContent(element),
          absolutePath,
          displayPath,
          depth,
          scriptType === 'module' ? 'module' : 'script',
          (element.sourceCodeLocation?.startTag?.endLine ?? 1) - 1,
        )
      } else if (scriptType === 'json') {
        try {
          JSON.parse(textContent(element))
        } catch (error) {
          addIssue(
            state,
            'json.parse-error',
            displayPath,
            location,
            `inline JSON is invalid: ${(error as Error).message}`,
          )
        }
      }
      page.scripts.push(load)
    }
    if (tag === 'img') {
      if (!hasAttribute(element, 'alt')) {
        addIssue(
          state,
          'a11y.image-alt-invalid',
          displayPath,
          location,
          'image must explicitly declare alt text or alt="" when decorative',
          'Add meaningful alt text, or explicit empty alt for a decorative image.',
        )
      }
    }
    if (['input', 'select', 'textarea'].includes(tag)) {
      page.hasInteractive = true
      const controlId = attribute(element, 'id')
      if (!named(element) && (controlId === null || !labels.has(controlId))) {
        addIssue(
          state,
          'a11y.control-name-missing',
          displayPath,
          location,
          'form control has no label or accessible name',
          'Associate a label or provide an accessible name.',
        )
      }
    }
    if (tag === 'button' || tag === 'a') {
      page.hasInteractive = true
      if (!named(element)) {
        addIssue(
          state,
          'a11y.control-name-missing',
          displayPath,
          location,
          `${tag} has no accessible name`,
          'Add visible text or an accessible name.',
        )
      }
    }
    if (tag === 'table') {
      const descendants = elements(element)
      if (
        !descendants.some((candidate) => candidate.tagName === 'caption') &&
        (attribute(element, 'aria-describedby')?.trim() ?? '') === ''
      ) {
        addIssue(
          state,
          'a11y.table-caption-missing',
          displayPath,
          location,
          'table has no caption',
          'Add a caption or a clearly associated description.',
        )
      }
      const headers = descendants.filter((candidate) => candidate.tagName === 'th')
      if (headers.length === 0) {
        addIssue(
          state,
          'a11y.table-header-missing',
          displayPath,
          location,
          'table has no header cells',
          'Use th elements for row or column headers.',
        )
      } else if (
        headers.some((header) => !hasAttribute(header, 'scope') && !hasAttribute(header, 'headers'))
      ) {
        addIssue(
          state,
          'a11y.table-header-association-uncertain',
          displayPath,
          location,
          'table header association is not explicit',
          'Add scope or headers/id relationships for complex tables.',
        )
      }
    }
    if (tag === 'svg') {
      const descendants = elements(element)
      if (
        !descendants.some((candidate) => candidate.tagName === 'title') ||
        !descendants.some((candidate) => candidate.tagName === 'desc')
      ) {
        addIssue(
          state,
          'a11y.svg-name-missing',
          displayPath,
          location,
          'inline SVG must contain title and desc elements',
          'Add a title and description to the SVG.',
        )
      }
    }
    if (/^h[1-6]$/.test(tag)) headings.push({ level: Number(tag[1]), element })
    const tabindex = attribute(element, 'tabindex')
    if (tabindex !== null && Number.isInteger(Number(tabindex)) && Number(tabindex) > 0) {
      addIssue(
        state,
        'a11y.positive-tabindex',
        displayPath,
        elementLocation(element, 'tabindex'),
        'positive tabindex creates an unstable focus order',
        'Use DOM order and tabindex="0" only when necessary.',
      )
    }
    if (['audio', 'video'].includes(tag) && hasAttribute(element, 'autoplay')) {
      addIssue(
        state,
        'a11y.autoplay-enabled',
        displayPath,
        elementLocation(element, 'autoplay'),
        'autoplay media is not allowed',
        'Remove autoplay and let the reader start media explicitly.',
      )
    }
    if (attribute(element, 'data-status') !== null && !named(element)) {
      addIssue(
        state,
        'a11y.color-only-state',
        displayPath,
        elementLocation(element, 'data-status'),
        'state marker has no textual, ARIA, or titled meaning beyond styling',
        'Add a textual label or accessible state description.',
      )
    }
    if (
      (tag === 'meta' &&
        attribute(element, 'name') === 'dsh-report-starter' &&
        attribute(element, 'content') === 'unresolved') ||
      id === 'dsh-starter-placeholder-dataset' ||
      id === 'dsh-starter-placeholder-trace'
    ) {
      addIssue(
        state,
        'starter.placeholder-unresolved',
        displayPath,
        location,
        'Starter placeholder sentinel remains unresolved',
        'Replace or remove the Starter placeholder and its calls.',
      )
    }
  }
  const h1s = headings.filter((heading) => heading.level === 1)
  if (h1s.length !== 1 || textContent(h1s[0]!.element).trim() === '') {
    addIssue(
      state,
      'a11y.h1-invalid',
      displayPath,
      h1s[0] === undefined ? { line: 1, column: 1 } : elementLocation(h1s[0].element),
      'document must contain exactly one non-empty h1',
      'Add one descriptive h1.',
    )
  }
  for (let index = 1; index < headings.length; index++) {
    if (headings[index]!.level > headings[index - 1]!.level + 1) {
      addIssue(
        state,
        'a11y.heading-order-invalid',
        displayPath,
        elementLocation(headings[index]!.element),
        `heading level jumps from h${headings[index - 1]!.level} to h${headings[index]!.level}`,
        'Use consecutive heading levels.',
      )
    }
  }
  return page
}

function fileKind(
  target: string,
): 'html' | 'css' | 'javascript' | 'json' | 'svg' | 'opaque' | 'unsupported' {
  const extension = path.extname(target).toLowerCase()
  if (extension === '.html' || extension === '.htm') return 'html'
  if (extension === '.css') return 'css'
  if (extension === '.js' || extension === '.mjs') return 'javascript'
  if (extension === '.json') return 'json'
  if (extension === '.svg') return 'svg'
  if (OPAQUE_EXTENSIONS.has(extension)) return 'opaque'
  return 'unsupported'
}

async function processResource(state: ScanState, request: ResourceRequest): Promise<void> {
  abortIfNeeded(state.signal)
  if (state.processed.has(request.absolutePath)) return
  state.processed.add(request.absolutePath)
  let stat: Awaited<ReturnType<ScanState['files']['stat']>>
  try {
    stat = await state.files.stat(request.absolutePath, state.signal)
  } catch (error) {
    if (request.absolutePath === state.entryPath) {
      throw new ReportCheckInvocationError('io-failed', 'report entry could not be inspected', {
        cause: error,
      })
    }
    addIssue(
      state,
      'resource.missing',
      request.originPath,
      request.location,
      `local resource is missing: ${request.displayPath}`,
      'Create the resource or correct the reference.',
    )
    return
  }
  if (stat.kind !== 'file') {
    addIssue(
      state,
      'resource.not-regular-file',
      request.displayPath,
      { line: null, column: null },
      'referenced resource is not a regular file',
      'Reference a regular file inside the bundle.',
    )
    return
  }
  let canonical: string
  try {
    canonical = await state.files.realpath(request.absolutePath, state.signal)
  } catch (error) {
    throw new ReportCheckInvocationError('io-failed', 'resource realpath could not be determined', {
      cause: error,
    })
  }
  if (!inside(state.bundleRoot, canonical)) {
    addIssue(
      state,
      'resource.outside-bundle',
      request.originPath,
      request.location,
      `resource symlink escapes the bundle: ${request.displayPath}`,
      'Replace the symlink with a file contained by the bundle.',
    )
    return
  }
  state.filesChecked += 1
  state.bytesChecked += stat.size
  if (SECRET_NAME.test(request.displayPath)) {
    addIssue(
      state,
      'security.secret-like-name',
      request.displayPath,
      { line: null, column: null },
      'secret-like resource name was observed; contents were not treated as proof of safety',
      'Remove secret-bearing files from the report bundle.',
    )
  }
  const kind = fileKind(request.absolutePath)
  if (kind === 'unsupported') {
    addIssue(
      state,
      'resource.type-unsupported',
      request.displayPath,
      { line: null, column: null },
      `unsupported report resource type ${path.extname(request.absolutePath) || '(none)'}`,
      'Use a supported static web, media, font, or data file type.',
    )
    return
  }
  if (kind === 'opaque') return
  if (stat.size > state.limits.maxTextFileBytes) {
    state.coverageIncomplete = true
    addIssue(
      state,
      'budget.text-file-bytes-exceeded',
      request.displayPath,
      { line: null, column: null },
      `text resource is ${stat.size} bytes; limit is ${state.limits.maxTextFileBytes}`,
      'Reduce or split the text resource.',
    )
    return
  }
  if (state.textBytesChecked + stat.size > state.limits.maxTotalTextBytes) {
    state.coverageIncomplete = true
    addIssue(
      state,
      'budget.total-text-bytes-exceeded',
      request.displayPath,
      { line: null, column: null },
      `parsed text would exceed ${state.limits.maxTotalTextBytes} bytes`,
      'Remove unused text resources or split the report.',
    )
    return
  }
  let bytes: Uint8Array
  try {
    bytes = await state.files.readFile(request.absolutePath, state.signal)
  } catch (error) {
    throw new ReportCheckInvocationError('io-failed', 'report resource could not be read', {
      cause: error,
    })
  }
  state.textBytesChecked += bytes.byteLength
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new ReportCheckInvocationError('io-failed', 'report text resource is not valid UTF-8', {
      cause: error,
    })
  }
  if (kind === 'html') {
    state.htmlPages.push(
      analyzeHtml(state, text, request.absolutePath, request.displayPath, request.depth),
    )
  } else if (kind === 'css') {
    analyzeCss(state, text, request.absolutePath, request.displayPath, request.depth)
  } else if (kind === 'javascript') {
    const analysis = analyzeJavaScript(
      state,
      text,
      request.absolutePath,
      request.displayPath,
      request.depth,
      path.extname(request.absolutePath).toLowerCase() === '.mjs' ||
        state.moduleScripts.has(request.absolutePath)
        ? 'module'
        : 'script',
    )
    if (analysis !== null) state.javascript.set(request.absolutePath, analysis)
  } else if (kind === 'json') {
    try {
      JSON.parse(text)
    } catch (error) {
      addIssue(
        state,
        'json.parse-error',
        request.displayPath,
        { line: 1, column: 1 },
        `JSON syntax is invalid: ${(error as Error).message}`,
        'Write strict JSON without comments, NaN, Infinity, or trailing commas.',
      )
    }
  } else if (kind === 'svg') {
    analyzeSvg(state, text, request.displayPath)
  }
}

function validateRegistries(state: ScanState): void {
  for (const page of state.htmlPages) {
    let datasetProvider = false
    let traceProvider = false
    const datasets = new Map<string, unknown>()
    const traces = new Map<string, unknown>()
    for (const script of page.scripts) {
      if (script.absolutePath !== null) {
        const basename = path.basename(script.absolutePath)
        if (basename === 'report-data.js') datasetProvider = true
        if (basename === 'report-trace.js') traceProvider = true
        script.analysis = state.javascript.get(script.absolutePath) ?? null
      }
      const analysis = script.analysis
      if (analysis === null) continue
      for (const operation of analysis.operations) {
        const codePrefix = operation.registry
        const provider = operation.registry === 'dataset' ? datasetProvider : traceProvider
        const registry = operation.registry === 'dataset' ? datasets : traces
        if (script.async || script.defer || script.type === 'module' || !provider) {
          addIssue(
            state,
            `${codePrefix}.registry-order-invalid`,
            script.path,
            operation.location,
            `${codePrefix} registry operation is not preceded by its classic provider`,
            `Load report-${operation.registry === 'dataset' ? 'data' : 'trace'}.js first as a classic ordered script.`,
          )
        }
        if (operation.id === null) continue
        if (operation.kind === 'register') {
          if (registry.has(operation.id)) {
            addIssue(
              state,
              `${codePrefix}.duplicate-id`,
              script.path,
              operation.location,
              `duplicate ${codePrefix} registration ${JSON.stringify(operation.id)}`,
              'Use one stable id per page.',
            )
            continue
          }
          const validation = validateReportContract(
            operation.registry === 'dataset' ? 'dataset' : 'trace',
            operation.payload,
          )
          const payload =
            typeof operation.payload === 'object' && operation.payload !== null
              ? (operation.payload as Record<string, unknown>)
              : null
          const payloadId = payload?.[operation.registry === 'dataset' ? 'dataset_id' : 'trace_id']
          if (!validation.valid || payloadId !== operation.id) {
            const identityErrors = validation.semanticErrors.filter((error) =>
              /dangling|identity|failed_run_ids|incomplete_run_ids|unknown (?:Run|Artifact)/i.test(
                error,
              ),
            )
            addIssue(
              state,
              operation.registry === 'trace' && identityErrors.length > 0
                ? 'trace.identity-dangling'
                : `${codePrefix}.schema-invalid`,
              script.path,
              operation.location,
              payloadId !== operation.id
                ? `registration id does not match payload id ${JSON.stringify(payloadId)}`
                : validation.errors.slice(0, 3).join('; ') || 'registration payload is invalid',
              'Regenerate the snapshot with the supported report kit contract.',
            )
          } else {
            registry.set(operation.id, operation.payload)
            if (operation.registry === 'dataset') {
              const root = operation.payload as Record<string, unknown>
              const table = root.table as Record<string, unknown>
              const columns = Array.isArray(table.columns) ? table.columns : []
              for (const column of columns) {
                if (
                  typeof column === 'object' &&
                  column !== null &&
                  typeof (column as Record<string, unknown>).name === 'string' &&
                  SECRET_NAME.test(String((column as Record<string, unknown>).name))
                ) {
                  addIssue(
                    state,
                    'security.secret-like-name',
                    script.path,
                    operation.location,
                    'secret-like dataset column name was observed; values were not inspected',
                    'Remove sensitive columns before emitting the report snapshot.',
                  )
                }
              }
            }
          }
        } else if (!registry.has(operation.id)) {
          addIssue(
            state,
            `${codePrefix}.unregistered-read`,
            script.path,
            operation.location,
            `${operation.method} reads unregistered id ${JSON.stringify(operation.id)}`,
            'Load and register the snapshot before the consumer script.',
          )
        }
      }
    }
    const artifactDataset = [...datasets.values()].some((value) => {
      const root = value as Record<string, unknown>
      const source = root.source as Record<string, unknown>
      return source?.kind === 'marivo_artifact'
    })
    if (artifactDataset && traces.size === 0) {
      addIssue(
        state,
        'trace.missing-for-artifact-report',
        page.displayPath,
        { line: 1, column: 1 },
        'Artifact-backed report has no valid Session trace registration',
        'Emit a focused Session trace or explicitly document why no appendix is included.',
      )
    }
  }
}

function validateFragments(state: ScanState): void {
  const pages = new Map(state.htmlPages.map((page) => [page.absolutePath, page]))
  for (const page of state.htmlPages) {
    for (const link of page.fragmentLinks) {
      const target = pages.get(link.targetAbsolutePath)
      if (target !== undefined && !target.ids.has(link.fragment)) {
        addIssue(
          state,
          'html.fragment-target-missing',
          link.path,
          link.location,
          `fragment target ${JSON.stringify(link.fragment)} does not exist`,
          'Reference an existing id.',
        )
      }
    }
  }
}

function compareIssues(left: ReportCheckIssueV1, right: ReportCheckIssueV1): number {
  const severity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
  if (severity !== 0) return severity
  const byPath = left.path.localeCompare(right.path, 'en')
  if (byPath !== 0) return byPath
  const leftLine = left.line ?? Number.POSITIVE_INFINITY
  const rightLine = right.line ?? Number.POSITIVE_INFINITY
  if (leftLine !== rightLine) return leftLine - rightLine
  const leftColumn = left.column ?? Number.POSITIVE_INFINITY
  const rightColumn = right.column ?? Number.POSITIVE_INFINITY
  if (leftColumn !== rightColumn) return leftColumn - rightColumn
  const byCode = left.code.localeCompare(right.code, 'en')
  if (byCode !== 0) return byCode
  return left.message.localeCompare(right.message, 'en')
}

function finalizeIssues(state: ScanState): {
  issues: ReportCheckIssueV1[]
  omitted: number
  counts: { errors: number; warnings: number; infos: number }
} {
  const unique = new Map<string, ReportCheckIssueV1>()
  for (const issue of state.issues) {
    const key = [
      issue.severity,
      issue.code,
      issue.path,
      issue.line,
      issue.column,
      issue.message,
    ].join('\u0000')
    unique.set(key, issue)
  }
  const sorted = [...unique.values()].sort(compareIssues)
  const counts = {
    errors: sorted.filter((issue) => issue.severity === 'error').length,
    warnings: sorted.filter((issue) => issue.severity === 'warning').length,
    infos: sorted.filter((issue) => issue.severity === 'info').length,
  }
  if (sorted.length <= state.limits.maxIssues) return { issues: sorted, omitted: 0, counts }
  const kept = sorted.slice(0, state.limits.maxIssues - 1)
  const omitted = sorted.length - kept.length
  kept.push({
    severity: 'info',
    code: 'budget.issue-count-truncated',
    path: relativeSlash(state.bundleRoot, state.entryPath),
    line: null,
    column: null,
    message: `${omitted} additional diagnostics were omitted after stable sorting`,
    repair: 'Fix returned diagnostics and rerun the checker to reveal any remaining issues.',
  })
  return { issues: kept, omitted, counts }
}

/** Check one already-admitted Workspace report bundle without mutating files or using Agent state. */
export async function checkReportBundle(options: ReportCheckOptions): Promise<ReportCheckResultV1> {
  abortIfNeeded(options.signal)
  const limits = { ...DEFAULT_REPORT_CHECK_LIMITS, ...options.limits }
  if (limits.maxIssues < 2) {
    throw new ReportCheckInvocationError('checker-internal', 'maxIssues must be at least 2')
  }
  const bundleRoot = path.dirname(options.entryPath)
  const state: ScanState = {
    workspaceRoot: options.workspaceRoot,
    bundleRoot,
    entryPath: options.entryPath,
    files: options.files,
    signal: options.signal,
    limits,
    issues: [],
    queued: new Set([options.entryPath]),
    processed: new Set(),
    queue: [
      {
        absolutePath: options.entryPath,
        displayPath: 'index.html',
        depth: 0,
        originPath: 'index.html',
        location: { line: 1, column: 1 },
      },
    ],
    htmlPages: [],
    javascript: new Map(),
    moduleScripts: new Set(),
    filesChecked: 0,
    bytesChecked: 0,
    textBytesChecked: 0,
    coverageIncomplete: false,
    externalObserved: false,
    focusStyleObserved: false,
    motionObserved: false,
    reducedMotionObserved: false,
  }
  while (state.queue.length > 0) await processResource(state, state.queue.shift()!)
  validateFragments(state)
  validateRegistries(state)
  if (state.htmlPages.some((page) => page.hasInteractive) && !state.focusStyleObserved) {
    addIssue(
      state,
      'a11y.focus-style-missing',
      'index.html',
      { line: 1, column: 1 },
      'interactive content was observed without an explicit focus style',
      'Add a visible :focus or :focus-visible style.',
    )
  }
  if (state.motionObserved && !state.reducedMotionObserved) {
    addIssue(
      state,
      'a11y.reduced-motion-missing',
      'index.html',
      { line: 1, column: 1 },
      'animation or transition was observed without a prefers-reduced-motion override',
      'Add a reduced-motion media query that disables nonessential motion.',
    )
  }
  const finalized = finalizeIssues(state)
  const staticCoverage = state.coverageIncomplete ? 'incomplete' : 'complete'
  const status =
    finalized.counts.errors === 0 && staticCoverage === 'complete'
      ? 'passed_static'
      : 'failed_static'
  return {
    schema: 'dsh-data-analysis-report-check/v1',
    status,
    entry_path: relativeSlash(options.workspaceRoot, options.entryPath),
    bundle_root: relativeSlash(options.workspaceRoot, bundleRoot),
    checked_at: (options.now ?? (() => new Date()))().toISOString(),
    coverage: {
      static: staticCoverage,
      external: state.externalObserved ? 'not_checked' : 'none_observed',
      browser: 'not_run',
      visual: 'not_run',
      analysis: 'not_checked',
    },
    summary: {
      ...finalized.counts,
      files_checked: state.filesChecked,
      bytes_checked: state.bytesChecked,
    },
    issues: finalized.issues,
    omitted_issue_count: finalized.omitted,
  }
}
