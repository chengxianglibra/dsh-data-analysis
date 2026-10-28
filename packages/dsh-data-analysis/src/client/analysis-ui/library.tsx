import { createLibrary, defineComponent } from '@openuidev/react-lang'
import { openuiLibrary } from '@openuidev/react-ui'
import { z } from 'zod/v4'

const viewSchema = z.union([
  z.object({ chart: z.literal('auto') }).strict(),
  z.object({ chart: z.literal('table'), columns: z.array(z.string()).optional() }).strict(),
  z
    .object({ chart: z.literal('metric'), encoding: z.object({ value: z.string() }).strict() })
    .strict(),
])
const displaySchema = z
  .object({ height: z.number().int().positive().max(1200).optional() })
  .strict()
const dataProps = z.object({
  ref: z.string().min(1),
  view: viewSchema.optional(),
  display: displaySchema.optional(),
})

// P0 placeholders deliberately perform no reads. P2 replaces only these renderers.
export const AnalysisFrameView = defineComponent({
  name: 'AnalysisFrameView',
  description: 'Persisted Frame resource. P0 placeholder; auto/table/metric only.',
  props: dataProps.clone(),
  component: ({ props }) => (
    <p data-analysis-placeholder="frame">Frame: {props.ref ?? '准备中'}（数据阅读器待接入）</p>
  ),
})
export const DatasetView = defineComponent({
  name: 'DatasetView',
  description: 'Captured SQL/file dataset resource. P0 placeholder; auto/table/metric only.',
  props: dataProps.clone(),
  component: ({ props }) => (
    <p data-analysis-placeholder="dataset">Dataset: {props.ref ?? '准备中'}（快照阅读器待接入）</p>
  ),
})

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

// Let the official extension rebind every parent slot and remove unsupported
// definitions. Its root/id are not configurable by extend in 1.0.1.
const subset = openuiLibrary.extend({
  components: {
    add: [AnalysisFrameView, DatasetView],
    remove: Object.keys(openuiLibrary.components).filter(
      (name) => !officialNames.some((item) => item === name),
    ),
    override: ['Stack', 'Card', 'TabItem'].map((name) => {
      const original = official[name]!
      return defineComponent({
        ...original,
        props: original.props.extend({
          [name === 'TabItem' ? 'content' : 'children']: z.array(content),
        }),
      })
    }),
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
