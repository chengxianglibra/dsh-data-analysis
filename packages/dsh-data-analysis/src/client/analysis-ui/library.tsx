import type { ElementNode } from '@openuidev/lang-core'
import { createLibrary, defineComponent } from '@openuidev/react-lang'
import { openuiLibrary } from '@openuidev/react-ui'
import { z } from 'zod/v4'
import {
  datasetDisplaySchema,
  datasetViewSchema,
} from '../../presentation/contracts/dataset-view.ts'
import { frameDisplaySchema, frameViewSchema } from '../../presentation/contracts/frame-view.ts'
import { useCopy } from '../i18n/context.tsx'
import { Markdown } from '../presentation/markdown.tsx'
import { Tabs } from '../ui/tabs.tsx'
import { useAnalysisResources } from './context.tsx'
import { AnalysisDataView } from './data-view.tsx'
import { Card, Stack } from './layout.tsx'

const frameProps = z.object({
  ref: z.string().min(1),
  view: frameViewSchema.optional(),
  display: frameDisplaySchema.optional(),
})
const datasetProps = z.object({
  ref: z.string().min(1),
  view: datasetViewSchema.optional(),
  display: datasetDisplaySchema.optional(),
})

export const AnalysisFrameView = defineComponent({
  name: 'AnalysisFrameView',
  description:
    'Persisted Frame snapshot; view auto/table/metric/line/area/bar/pie/heatmap/comparison/decomposition, display height/density/dataTable.',
  props: frameProps,
  component: ({ props, statementId }) => (
    <AnalysisDataView
      kind="frame"
      component={{ kind: 'frame', statementId, view: props.view, display: props.display }}
      resourceName={props.ref}
      view={props.view}
      display={props.display}
    />
  ),
})
export const DatasetView = defineComponent({
  name: 'DatasetView',
  description:
    'Captured DataFrame snapshot; auto/table/metric/line/area/bar/heatmap. Chart encoding names saved columns; axis order follows saved rows. No aggregation or analysis semantics.',
  props: datasetProps,
  component: ({ props, statementId }) => (
    <AnalysisDataView
      kind="dataset"
      component={{ kind: 'dataset', statementId, view: props.view, display: props.display }}
      resourceName={props.ref}
      view={props.view}
      display={props.display}
    />
  ),
})
function ResourceImage({ src, alt }: { src?: string; alt?: string }) {
  const resource = useAnalysisResources().readResource(src ?? '')
  return resource?.kind === 'image' ? (
    <img className="au-image" src={resource.dataUrl} alt={alt ?? ''} />
  ) : null
}

export const analysisCatalogId = 'dsh-data-analysis/analysis-ui/v1'
const officialNames = ['Stack', 'TextContent', 'Card', 'Tabs', 'TabItem', 'Image'] as const
const official = Object.fromEntries(
  officialNames.map((name) => {
    const component = openuiLibrary.components[name]
    if (!component) throw new Error(`Missing fixed OpenUI component: ${name}`)
    return [name, component]
  }),
)
const content = z.union([
  ...officialNames.filter((name) => name !== 'TabItem').map((name) => official[name]!.ref),
  AnalysisFrameView.ref,
  DatasetView.ref,
])

// Reuse the fixed public schema and identity; only the private renderer changes.
const stack = official.Stack!
const StackLayout = defineComponent({
  ...stack,
  props: stack.props.extend({ children: z.array(content) }),
  component: ({ props, renderNode }) => <Stack {...props}>{renderNode(props.children)}</Stack>,
})

// Let the official extension rebind every parent slot and remove unsupported
// definitions. Its root/id are not configurable by extend in 1.0.1.
const subset = openuiLibrary.extend({
  components: {
    add: [AnalysisFrameView, DatasetView],
    remove: Object.keys(openuiLibrary.components).filter(
      (name) => !officialNames.some((item) => item === name),
    ),
    override: [
      StackLayout,
      defineComponent({
        ...official.Card!,
        props: official.Card!.props.extend({ children: z.array(content) }),
        component: ({ props, renderNode }) => <Card {...props}>{renderNode(props.children)}</Card>,
      }),
      defineComponent({
        ...official.TabItem!,
        props: official.TabItem!.props.extend({ content: z.array(content) }),
      }),
      defineComponent({
        ...official.Image!,
        description: 'Saved image; src is an admitted resource name, never a URL.',
        component: ({ props }) => <ResourceImage src={props.src} alt={props.alt} />,
      }),
      defineComponent({
        ...official.TextContent!,
        component: ({ props }) => (
          <div className="au-text" data-size={props.size}>
            <Markdown text={props.text ?? ''} />
          </div>
        ),
      }),
      defineComponent({
        ...official.Tabs!,
        component: function AnalysisTabs({ props, renderNode }) {
          const t = useCopy()
          // Element identities and props were checked against the generated TabItem slot schema.
          const items = (props.items ?? []) as {
            props: { value: string; trigger: string; content: ElementNode[] }
          }[]
          return (
            <Tabs
              label={t('marivo.presentation.ui-report-sections')}
              items={items.map((item) => ({
                value: item.props.value,
                trigger: item.props.trigger,
                content: renderNode(item.props.content),
              }))}
            />
          )
        },
      }),
    ],
  },
})
// A domain component may be the root; keep the plugin identity and omit the
// official Stack-only root and full-library prompt groups.
export const analysisLibrary = createLibrary({
  id: analysisCatalogId,
  components: Object.values(subset.components),
})
export const analysisRootComponents = Object.keys(analysisLibrary.components).filter(
  (name) => name !== 'TabItem',
)
