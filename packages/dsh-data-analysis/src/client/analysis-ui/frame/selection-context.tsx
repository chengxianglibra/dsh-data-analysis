import { createContext, useContext } from 'react'

/** A point is always identified by its row in the saved snapshot and its field id. */
export interface FrameSelection {
  select: (row: number, field: string) => void
}

export const FrameSelectionContext = createContext<FrameSelection | undefined>(undefined)
export const useFrameSelection = () => useContext(FrameSelectionContext)
