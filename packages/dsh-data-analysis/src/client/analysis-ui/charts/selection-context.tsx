import { createContext, useContext } from 'react'

/** A point is always identified by its row in the saved snapshot and its field id. */
export interface ChartSelection {
  select: (row: number, field: string) => void
}

export const ChartSelectionContext = createContext<ChartSelection | undefined>(undefined)
export const useChartSelection = () => useContext(ChartSelectionContext)
