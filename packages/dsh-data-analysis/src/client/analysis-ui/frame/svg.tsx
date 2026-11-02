import type {
  FrameClassification,
  ResolvedFrameView,
} from '../../../presentation/contracts/frame-view.ts'
import type { Snapshot } from './model.ts'

export type { LegendItem, Scale } from '../charts/svg.tsx'
export {
  areaPaths,
  Bar,
  ChartFrame,
  color,
  Diamond,
  Dot,
  dotsOverlap,
  END_W,
  extent,
  LABEL_W,
  Legend,
  linear,
  linePath,
  NEUTRAL,
  summary,
  textWidth,
  truncate,
  W,
  XTicks,
} from '../charts/svg.tsx'
export type View<K extends ResolvedFrameView['chart']> = Extract<ResolvedFrameView, { chart: K }>
export interface MainViewProps<K extends ResolvedFrameView['chart']> {
  snapshot: Snapshot
  classification: FrameClassification
  view: View<K>
  height?: number
}
