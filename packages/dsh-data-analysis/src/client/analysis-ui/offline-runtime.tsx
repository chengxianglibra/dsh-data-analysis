import { createRoot } from 'react-dom/client'
import { parseAnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import { AnalysisSurface } from './surface.tsx'

const container = document.getElementById('report')
const payload = document.getElementById('report-data')
if (!container || !payload?.textContent) throw new Error('offline-report-missing')
const report = parseAnalysisDocument(JSON.parse(payload.textContent))
createRoot(container).render(<AnalysisSurface document={report} offline />)
