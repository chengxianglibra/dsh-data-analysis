import type {
  FrameClassification,
  ResolvedFrameView,
} from '../../../presentation/contracts/frame-view.ts'
import type { Snapshot } from './model.ts'
export type View<K extends ResolvedFrameView['chart']> = Extract<ResolvedFrameView, { chart: K }>
export interface MainViewProps<K extends ResolvedFrameView['chart']> {
  snapshot: Snapshot
  classification: FrameClassification
  view: View<K>
  height?: number
  visibleRowIndices?: readonly number[]
}
