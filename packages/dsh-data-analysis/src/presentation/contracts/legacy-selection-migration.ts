import {
  createLibrary,
  createParser,
  type ElementNode,
  jsonToOpenUI,
  type LibraryJSONSchema,
  parseExpression,
  tokenize,
} from '@openuidev/lang-core'
import { z } from 'zod/v4'
import { analysisCatalogSchema } from './analysis-catalog.ts'
import {
  type SelectionSources,
  snapshotFilterBindingSchema,
  snapshotFilterSchema,
} from './snapshot-filter.ts'

/** Convert the v3 component tree without reading or changing the saved Build. */
export function migrateLegacySelections(program: string, locale: 'zh-CN' | 'en-US') {
  const schema = structuredClone(analysisCatalogSchema)
  schema.$defs ??= {}
  schema.properties ??= {}
  schema.$defs.SnapshotFilter = z.toJSONSchema(snapshotFilterSchema)
  schema.properties.SnapshotFilter = { $ref: '#/$defs/SnapshotFilter' }
  for (const name of ['AnalysisFrameView', 'DatasetView']) {
    const def = schema.$defs[name]
    if (!def?.properties) throw new Error('report-version-unsupported')
    def.properties.filters = z.toJSONSchema(z.array(snapshotFilterBindingSchema).optional())
  }
  // Any parent slot accepting dataset views also accepted SnapshotFilter in v3.
  const addLegacySlot = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      if (
        value.some(
          (item) =>
            item &&
            typeof item === 'object' &&
            '$ref' in item &&
            item.$ref === '#/$defs/DatasetView',
        )
      )
        value.push({ $ref: '#/$defs/SnapshotFilter' })
      for (const item of value) addLegacySlot(item)
    } else for (const item of Object.values(value)) addLegacySlot(item)
  }
  addLegacySlot(schema.$defs)
  const result = createParser(schema).parse(program)
  if (
    !result.root ||
    result.meta.incomplete ||
    result.meta.unresolved.length ||
    result.meta.errors.length
  )
    throw new Error('report-version-unsupported')
  const sources: SelectionSources = {}
  const identifiers = new Map<string, string>()
  const scan = (node: ElementNode): void => {
    if (node.typeName === 'SnapshotFilter') {
      const filter = snapshotFilterSchema.parse(node.props)
      let source = identifiers.get(filter.filterId)
      if (!source) {
        source = `legacy${identifiers.size + 1}`
        identifiers.set(filter.filterId, source)
        const { filterId: _filterId, ...declaration } = filter
        sources[source] = declaration
      } else if (
        JSON.stringify(sources[source]) !==
        JSON.stringify(
          Object.fromEntries(Object.entries(filter).filter(([key]) => key !== 'filterId')),
        )
      ) {
        throw new Error('report-version-unsupported')
      }
    }
    for (const value of Object.values(node.props))
      for (const child of Array.isArray(value) ? value : [value]) if (isElement(child)) scan(child)
  }
  scan(result.root)
  const expression = (source: string) => parseExpression(tokenize(source))
  const node = (
    typeName: string,
    props: Record<string, unknown>,
    statementId?: string,
  ): ElementNode => ({
    type: 'element',
    typeName,
    props,
    partial: false,
    ...(statementId ? { statementId } : {}),
  })
  const translate = (current: ElementNode): ElementNode => {
    if (current.typeName === 'SnapshotFilter') {
      const filter = snapshotFilterSchema.parse(current.props)
      const source = identifiers.get(filter.filterId)!
      const prefix = `$source_${source.length}_${source}`
      const state = `$${source}`
      const draft = `${prefix}_draft`
      const options = `${prefix}_options`
      const defaults = `${prefix}_default`
      const mode = filter.mode ?? 'single'
      const item =
        mode === 'single'
          ? 'SelectItem(item.id, item.label)'
          : 'CheckBoxItem(item.label, "", item.id)'
      const control =
        mode === 'date-range'
          ? node('DatePicker', { name: source, mode: 'range', value: expression(draft) })
          : node(mode === 'single' ? 'Select' : 'CheckBoxGroup', {
              name: source,
              items: expression(`@Each(${options}, "item", ${item})`),
              value: expression(mode === 'single' ? state : draft),
            })
      const resetLabel = locale === 'zh-CN' ? '恢复默认' : 'Reset'
      const clearLabel = locale === 'zh-CN' ? '清除' : 'Clear'
      const applyLabel = locale === 'zh-CN' ? '应用' : 'Apply'
      const controls = [node('FormControl', { label: filter.label, input: control })]
      if (mode !== 'single') {
        const allowed = filter.options?.allowAll !== false
        controls.push(
          node('Button', {
            label: applyLabel,
            action: expression(
              `@Set(${state}, @SelectionOrCurrent(${state}, ${draft}, ${options}, ${JSON.stringify(mode)}, ${allowed}))`,
            ),
          }),
        )
      }
      if (filter.options?.allowAll !== false) {
        const empty = mode === 'single' ? '"a"' : '{}'
        const action =
          mode === 'single'
            ? `@Set(${state}, ${empty})`
            : `Action([@Set(${state}, ${empty}), @Set(${draft}, ${empty})])`
        controls.push(node('Button', { label: clearLabel, action: expression(action) }))
      }
      const reset =
        mode === 'single'
          ? `@Set(${state}, ${defaults})`
          : `Action([@Set(${state}, ${defaults}), @Set(${draft}, ${defaults})])`
      controls.push(node('Button', { label: resetLabel, action: expression(reset) }))
      return node('Stack', { children: controls }, current.statementId)
    }
    const props = Object.fromEntries(
      Object.entries(current.props).map(([key, value]) => [
        key,
        Array.isArray(value)
          ? value.map((item) => (isElement(item) ? translate(item) : item))
          : isElement(value)
            ? translate(value)
            : value,
      ]),
    )
    if (
      (current.typeName === 'DatasetView' || current.typeName === 'AnalysisFrameView') &&
      props.filters !== undefined
    ) {
      props.filters = z
        .array(snapshotFilterBindingSchema)
        .parse(props.filters)
        .map((binding) => {
          const old = typeof binding === 'string' ? binding : binding.filter
          const source = identifiers.get(old)
          if (!source) throw new Error('report-version-unsupported')
          return {
            source,
            ...(typeof binding === 'string' ? {} : { field: binding.field }),
            selection: expression(`$${source}`),
          }
        })
    }
    return { ...current, props }
  }
  const library = {
    ...createLibrary({ components: [] }),
    toJSONSchema: (): LibraryJSONSchema => analysisCatalogSchema,
  }
  const converted = jsonToOpenUI(translate(result.root), library)
  const states = Object.keys(sources)
    .map((id) => `$${id} = null`)
    .join('\n')
  return { program: `${converted}\n${states}`, selectionSources: sources }
}
function isElement(value: unknown): value is ElementNode {
  return (
    !!value &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'element' &&
    'props' in value &&
    'typeName' in value
  )
}
