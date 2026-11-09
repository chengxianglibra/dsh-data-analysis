import { createContext, useContext } from 'react'
import type { ReportReadingState } from './report-views.ts'

export const ReportReading = createContext<ReportReadingState | undefined>(undefined)
export const ReadingComponent = createContext('report')
export const useReportReading = () => useContext(ReportReading)
export const useReadingComponent = () => useContext(ReadingComponent)
