import type { ElementNode } from '@openuidev/lang-core'
import { createLibrary, defineComponent } from '@openuidev/react-lang'
import { openuiLibrary } from '@openuidev/react-ui'
import { useState } from 'react'
import { z } from 'zod/v4'
import { frameDisplaySchema, frameViewSchema } from '../../presentation/contracts/frame-view.ts'
import { Markdown } from '../presentation/markdown.tsx'
import { useAnalysisResources } from './context.tsx'
import { AnalysisDataView } from './data-view.tsx'

const datasetView = z.union([
  z.object({ chart: z.literal('auto') }).strict(),
  z.object({ chart: z.literal('table'), columns: z.array(z.string()).optional() }).strict(),
  z
    .object({ chart: z.literal('metric'), encoding: z.object({ value: z.string() }).strict() })
    .strict(),
])
const datasetDisplay = z
  .object({ height: z.number().int().positive().max(1200).optional() })
  .strict()
const frameProps = z.object({
  ref: z.string().min(1),
  view: frameViewSchema.optional(),
  display: frameDisplaySchema.optional(),
})
const datasetProps = z.object({
  ref: z.string().min(1),
  view: datasetView.optional(),
  display: datasetDisplay.optional(),
})

export const AnalysisFrameView = defineComponent({
  name: 'AnalysisFrameView',
  description:
    'Persisted Frame snapshot; view auto/table/metric/line/area/bar/heatmap/comparison/decomposition, display height/density/dataTable.',
  props: frameProps,
  component: ({ props }) => (
    <AnalysisDataView
      kind="frame"
      resourceName={props.ref}
      view={props.view}
      display={props.display}
    />
  ),
})
export const DatasetView = defineComponent({
  name: 'DatasetView',
  description:
    'Captured DataFrame snapshot; auto/table/metric. SQL/file provenance is shown only when captured.',
  props: datasetProps,
  component: ({ props }) => (
    <AnalysisDataView
      kind="dataset"
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

// Let the official extension rebind every parent slot and remove unsupported
// definitions. Its root/id are not configurable by extend in 1.0.1.
const subset = openuiLibrary.extend({
  components: {
    add: [AnalysisFrameView, DatasetView],
    remove: Object.keys(openuiLibrary.components).filter(
      (name) => !officialNames.some((item) => item === name),
    ),
    override: [
      ...['Stack', 'Card', 'TabItem'].map((name) => {
        const original = official[name]!
        return defineComponent({
          ...original,
          props: original.props.extend({
            [name === 'TabItem' ? 'content' : 'children']: z.array(content),
          }),
        })
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
          const [active, setActive] = useState<string>()
          // Element identities and props were checked against the generated TabItem slot schema.
          const items = (props.items ?? []) as {
            props: { value: string; trigger: string; content: ElementNode[] }
          }[]
          const selected = items.some((item) => item.props.value === active)
            ? active
            : items[0]?.props.value
          return (
            <div className="au-tabs">
              <div role="tablist">
                {items.map((item) => (
                  <button
                    type="button"
                    role="tab"
                    key={item.props.value}
                    aria-selected={selected === item.props.value}
                    onClick={() => setActive(item.props.value)}
                  >
                    {item.props.trigger}
                  </button>
                ))}
              </div>
              {items.map((item) => (
                <div role="tabpanel" key={item.props.value} hidden={selected !== item.props.value}>
                  {renderNode(item.props.content)}
                </div>
              ))}
            </div>
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
