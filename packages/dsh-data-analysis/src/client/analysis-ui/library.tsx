import type { ElementNode } from '@openuidev/lang-core'
import { createLibrary, defineComponent } from '@openuidev/react-lang'
import { openuiLibrary } from '@openuidev/react-ui'
import { createContext, type ReactNode, useContext, useLayoutEffect, useRef } from 'react'
import { z } from 'zod/v4'
import {
  datasetDisplaySchema,
  datasetViewSchema,
} from '../../presentation/contracts/dataset-view.ts'
import { frameDisplaySchema, frameViewSchema } from '../../presentation/contracts/frame-view.ts'
import { snapshotFilterSchema } from '../../presentation/contracts/snapshot-filter.ts'
import { useCopy } from '../i18n/context.tsx'
import { Markdown } from '../presentation/markdown.tsx'
import { Tabs } from '../ui/tabs.tsx'
import { useAnalysisResources } from './context.tsx'
import { DashboardAccordion, DashboardTextCallout } from './dashboard-components.tsx'
import { AnalysisDataView } from './data-view.tsx'
import { Card, DashboardGrid as Grid, DashboardGridItem as GridItem, Stack } from './layout.tsx'
import { ReadingComponent, useReportReading } from './reading-state.tsx'
import { SnapshotFilterControl } from './snapshot-filter-controls.tsx'

const frameProps = z.object({
  ref: z.string().min(1),
  view: frameViewSchema.optional(),
  display: frameDisplaySchema.optional(),
  filters: z.array(z.string()).optional(),
})
const datasetProps = z.object({
  ref: z.string().min(1),
  view: datasetViewSchema.optional(),
  display: datasetDisplaySchema.optional(),
  filters: z.array(z.string()).optional(),
})

type AnalysisTabItem = ElementNode & {
  props: { value: string; trigger: string; content: unknown[] }
}
function isAnalysisItem(
  item: unknown,
  typeName: 'TabItem' | 'AccordionItem',
): item is AnalysisTabItem {
  if (
    !item ||
    typeof item !== 'object' ||
    !('type' in item) ||
    item.type !== 'element' ||
    !('typeName' in item) ||
    item.typeName !== typeName ||
    !('props' in item) ||
    !item.props ||
    typeof item.props !== 'object'
  )
    return false
  const props = item.props
  return (
    'value' in props &&
    typeof props.value === 'string' &&
    Boolean(props.value.trim()) &&
    'trigger' in props &&
    typeof props.trigger === 'string' &&
    Boolean(props.trigger.trim()) &&
    'content' in props &&
    Array.isArray(props.content)
  )
}

function usePendingStatement(statementId?: string) {
  const context = useAnalysisResources()
  return Boolean(
    context.candidate &&
      context.isStreaming &&
      statementId !== undefined &&
      context.pendingStatementId === statementId,
  )
}

function ResourceView({
  kind,
  props,
  statementId,
}: {
  kind: 'frame' | 'dataset'
  props: z.infer<typeof frameProps>
  statementId?: string
}) {
  const context = useAnalysisResources()
  const namedPending = usePendingStatement(statementId)
  const valid = (kind === 'frame' ? frameProps : datasetProps).safeParse(props)
  const pending =
    namedPending ||
    (!valid.success &&
      context.candidate &&
      context.isStreaming &&
      context.pendingStatementId !== undefined)
  return (
    <ReadingComponent.Provider value={statementId ?? `${kind}:${props.ref}`}>
      <AnalysisDataView
        kind={kind}
        component={{ kind, statementId, view: props.view, display: props.display }}
        resourceName={props.ref}
        view={props.view}
        display={props.display}
        filters={props.filters}
        configuration={pending ? 'pending' : valid.success ? undefined : 'invalid'}
      />
    </ReadingComponent.Provider>
  )
}

export const AnalysisFrameView = defineComponent({
  name: 'AnalysisFrameView',
  description:
    'Persisted Frame snapshot; view auto/table/metric/line/area/bar/pie/heatmap/comparison/decomposition. Display supports time tick format and timezone, timeContext, seriesLayout for lines, title, subtitle, numeric formats, density and other Frame options; options are validated against the saved Frame and resolved view.',
  props: frameProps,
  component: ({ props, statementId }) => (
    <ResourceView kind="frame" props={props} statementId={statementId} />
  ),
})
export const DatasetView = defineComponent({
  name: 'DatasetView',
  description:
    'Captured DataFrame snapshot; auto/table/metric/line/area/bar/heatmap. Display supports time tick format and timezone, seriesLayout for lines, title, subtitle and numeric formats. Chart encoding names saved columns; axis order follows saved rows. No aggregation or analysis semantics.',
  props: datasetProps,
  component: ({ props, statementId }) => (
    <ResourceView kind="dataset" props={props} statementId={statementId} />
  ),
})
export const SnapshotFilter = defineComponent({
  name: 'SnapshotFilter',
  description:
    'Select saved category values for explicitly bound views of the same snapshot; no recalculation.',
  props: snapshotFilterSchema,
  component: ({ props }) => <SnapshotFilterControl declaration={props} />,
})
function ResourceImage({
  src,
  alt,
  statementId,
}: {
  src?: string
  alt?: string
  statementId?: string
}) {
  const pending = usePendingStatement(statementId)
  const context = useAnalysisResources()
  const resource = context.readResource(src ?? '')
  const ready = !pending && resource?.kind === 'image' ? { resource, alt } : undefined
  const reading = useReportReading()
  const previous = useRef<{ reading: typeof reading; value: NonNullable<typeof ready> }>()
  useLayoutEffect(() => {
    if (ready) previous.current = { reading, value: ready }
    else if (!context.candidate || context.removedResourceNames?.includes(src ?? ''))
      previous.current = undefined
  })
  const visible =
    ready ??
    (context.candidate &&
    !context.removedResourceNames?.includes(src ?? '') &&
    previous.current &&
    previous.current.reading === reading
      ? previous.current.value
      : undefined)
  return visible ? (
    <img className="au-image" src={visible.resource.dataUrl} alt={visible.alt ?? ''} />
  ) : null
}

export const analysisCatalogId = 'dsh-data-analysis/analysis-ui/v1'
const officialNames = [
  'Stack',
  'TextContent',
  'Card',
  'Tabs',
  'TabItem',
  'Image',
  'TextCallout',
  'Accordion',
  'AccordionItem',
] as const
const official = Object.fromEntries(
  officialNames.map((name) => {
    const component = openuiLibrary.components[name]
    if (!component) throw new Error(`Missing fixed OpenUI component: ${name}`)
    return [name, component]
  }),
)
const gridSize = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
// Rebound below after the first library extension so its recursive content slot
// points at the final subset rather than the original full OpenUI library.
const DashboardGridItemBase = defineComponent({
  name: 'DashboardGridItem',
  description: 'Dashboard grid item; span is the number of columns in the wide layout.',
  props: z.object({ content: z.array(z.any()), span: gridSize.optional() }),
  component: ({ props, renderNode }) => (
    <GridItem span={props.span}>{renderChildren(props.content, renderNode)}</GridItem>
  ),
})
const DashboardGrid = defineComponent({
  name: 'DashboardGrid',
  description: 'Responsive dashboard grid with 1–4 columns and explicit item spans.',
  props: z.object({
    items: z.array(DashboardGridItemBase.ref),
    columns: gridSize.optional(),
    gap: z.enum(['s', 'm', 'l']).optional(),
  }),
  component: ({ props, renderNode }) => (
    <Grid columns={props.columns} gap={props.gap}>
      {renderChildren(props.items, renderNode)}
    </Grid>
  ),
})
const content = z.union([
  ...officialNames
    .filter((name) => name !== 'TabItem' && name !== 'AccordionItem')
    .map((name) => official[name]!.ref),
  AnalysisFrameView.ref,
  DatasetView.ref,
  SnapshotFilter.ref,
  DashboardGrid.ref,
])

// Path segments distinguish repeated named nodes under the same or different
// parents, while keeping unaffected siblings stable through edits and moves.
const ReadingPath = createContext('root')
function ReadingPathSegment({ segment, children }: { segment: string; children: ReactNode }) {
  const parent = useContext(ReadingPath)
  return (
    <ReadingPath.Provider value={`${parent}/${encodeURIComponent(segment)}`}>
      {children}
    </ReadingPath.Provider>
  )
}

/** Give named siblings stable React identity before delegating each node to OpenUI. */
function renderChildren(children: unknown, renderNode: (node: unknown) => ReactNode): ReactNode {
  if (!Array.isArray(children)) return renderNode(children)
  const occurrences = new Map<string, number>()
  return children.map((child, index) => {
    const name =
      child?.type === 'element' && typeof child.statementId === 'string'
        ? child.statementId
        : undefined
    const occurrence = name ? (occurrences.get(name) ?? 0) : 0
    if (name) occurrences.set(name, occurrence + 1)
    const segment = JSON.stringify(name ? ['named', name, occurrence] : ['inline', index])
    return (
      <ReadingPathSegment key={segment} segment={segment}>
        {renderNode(child)}
      </ReadingPathSegment>
    )
  })
}

// Reuse the fixed public schema and identity; only the private renderer changes.
const stack = official.Stack!
const StackLayout = defineComponent({
  ...stack,
  props: stack.props.extend({ children: z.array(content) }),
  component: ({ props, renderNode }) => (
    <Stack {...props}>{renderChildren(props.children, renderNode)}</Stack>
  ),
})

// Let the official extension rebind every parent slot and remove unsupported
// definitions. Its root/id are not configurable by extend in 1.0.1.
const subsetBase = openuiLibrary.extend({
  components: {
    add: [AnalysisFrameView, DatasetView, SnapshotFilter, DashboardGrid, DashboardGridItemBase],
    remove: Object.keys(openuiLibrary.components).filter(
      (name) => !officialNames.some((item) => item === name),
    ),
    override: [
      StackLayout,
      defineComponent({
        ...official.Card!,
        props: official.Card!.props.extend({ children: z.array(content) }),
        component: ({ props, renderNode }) => (
          <Card {...props}>{renderChildren(props.children, renderNode)}</Card>
        ),
      }),
      defineComponent({
        ...official.TabItem!,
        props: official.TabItem!.props.extend({ content: z.array(content) }),
      }),
      defineComponent({
        ...official.AccordionItem!,
        props: official.AccordionItem!.props.extend({ content: z.array(content) }),
      }),
      defineComponent({
        ...official.TextCallout!,
        component: ({ props }) => <DashboardTextCallout {...props} />,
      }),
      defineComponent({
        ...official.Accordion!,
        component: function AnalysisAccordion({ props, renderNode, statementId }) {
          const path = useContext(ReadingPath)
          const values = new Set<string>()
          const candidates: unknown[] = Array.isArray(props.items) ? props.items : []
          const items = candidates.filter((item): item is AnalysisTabItem => {
            if (!isAnalysisItem(item, 'AccordionItem') || values.has(item.props.value)) return false
            values.add(item.props.value)
            return true
          })
          return (
            <DashboardAccordion
              statementId={JSON.stringify([path, statementId ?? null])}
              items={items.map((item) => ({
                value: item.props.value,
                trigger: item.props.trigger,
                content: (
                  <ReadingPathSegment
                    segment={JSON.stringify(['accordion-item', item.props.value])}
                  >
                    {renderChildren(item.props.content, renderNode)}
                  </ReadingPathSegment>
                ),
              }))}
            />
          )
        },
      }),
      defineComponent({
        ...official.Image!,
        description: 'Saved image; src is an admitted resource name, never a URL.',
        component: ({ props, statementId }) => (
          <ResourceImage src={props.src} alt={props.alt} statementId={statementId} />
        ),
      }),
      defineComponent({
        ...official.TextContent!,
        component: function AnalysisText({ props }) {
          const { candidate } = useAnalysisResources()
          return (
            <div className="au-text" data-size={props.size}>
              <Markdown text={props.text ?? ''} links={!candidate} />
            </div>
          )
        },
      }),
      defineComponent({
        ...official.Tabs!,
        component: function AnalysisTabs({ props, renderNode, statementId }) {
          const t = useCopy()
          const reading = useReportReading()
          const key = statementId ?? 'tabs'
          const values = new Set<string>()
          const candidates: unknown[] = Array.isArray(props.items) ? props.items : []
          const items = candidates.filter((item): item is AnalysisTabItem => {
            if (!isAnalysisItem(item, 'TabItem') || values.has(item.props.value)) return false
            values.add(item.props.value)
            return true
          })
          return (
            <Tabs
              label={t('marivo.presentation.ui-report-sections')}
              initialValue={reading?.tabs.get(key)}
              onValueChange={(value) => reading?.tabs.set(key, value)}
              items={items.map((item) => ({
                value: item.props.value,
                trigger: item.props.trigger,
                content: (
                  <ReadingPathSegment segment={JSON.stringify(['tab-item', item.props.value])}>
                    {renderChildren(item.props.content, renderNode)}
                  </ReadingPathSegment>
                ),
              }))}
            />
          )
        },
      }),
    ],
  },
})
const DashboardGridItem = defineComponent({
  ...DashboardGridItemBase,
  props: DashboardGridItemBase.props.extend({
    content: z.array(
      z.union(
        Object.values(subsetBase.components)
          .filter(
            (component) =>
              !['TabItem', 'AccordionItem', 'DashboardGridItem'].includes(component.name),
          )
          .map((component) => component.ref),
      ),
    ),
  }),
})
const subset = subsetBase.extend({ components: { override: [DashboardGridItem] } })
// A domain component may be the root; keep the plugin identity and omit the
// official Stack-only root and full-library prompt groups.
export const analysisLibrary = createLibrary({
  id: analysisCatalogId,
  components: Object.values(subset.components),
})
export const analysisRootComponents = Object.keys(analysisLibrary.components).filter(
  (name) => !['TabItem', 'AccordionItem', 'DashboardGridItem'].includes(name),
)
