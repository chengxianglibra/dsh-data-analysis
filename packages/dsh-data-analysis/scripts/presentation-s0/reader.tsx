import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { chartNumber, formatCell } from '../../src/presentation/contracts/index.ts'
import type { PresentationDocument } from '../../src/presentation/contracts/types.ts'

/** S0 rendering probe only; S3 owns the complete accessible reader. */
export function S0Reader({ document }: { document: PresentationDocument }) {
  return (
    <article className="presentation-s0" data-build-id={document.buildId}>
      <header>
        <small>S0 · 展示接缝验证样例</small>
        <h1>{document.title}</h1>
      </header>
      {document.blocks.map((block) => {
        if (block.kind === 'markdown') return <p key={block.id}>{block.text}</p>
        if (block.kind === 'source')
          return (
            <section key={block.id} aria-label="来源">
              <h2>声明来源</h2>
              {document.sources
                .filter((source) => block.sourceIds.includes(source.id))
                .map((source) => (
                  <details key={source.id} open>
                    <summary>{source.status === 'available' ? source.label : '来源不可用'}</summary>
                    <code>
                      {source.ref.sessionId} / {source.ref.artifactRef}
                      {source.ref.findingId ? ` / ${source.ref.findingId}` : ''}
                    </code>
                    {source.status === 'unavailable' ? (
                      <p>{source.reason}</p>
                    ) : (
                      source.facts.map((fact) => (
                        <p key={fact.label}>
                          {fact.label}：{fact.value}
                        </p>
                      ))
                    )}
                  </details>
                ))}
            </section>
          )
        const dataset = document.datasets.find((dataset) => dataset.id === block.datasetId)!
        const { data } = dataset
        if (block.kind === 'metric') {
          if (block.rowSelection === 'slice')
            throw new Error('S0 reference renderer supports fixed metrics only.')
          const index = data.columns.findIndex((column) => column.id === block.columnId)
          return (
            <section key={block.id}>
              <h2>{block.label}</h2>
              <strong>
                {formatCell(data.rows[block.rowIndex]![index]!, data.columns[index]!)}{' '}
                {data.columns[index]!.unit}
              </strong>
            </section>
          )
        }
        if (block.kind === 'table') {
          const columns = (block.columns ?? data.columns.map((column) => column.id)).map((id) =>
            data.columns.findIndex((column) => column.id === id),
          )
          return (
            <section key={block.id} aria-label="数据表">
              <table>
                <thead>
                  <tr>
                    {columns.map((index) => (
                      <th key={data.columns[index]!.id}>
                        {data.columns[index]!.label}
                        {data.columns[index]!.unit ? ` (${data.columns[index]!.unit})` : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, index) => (
                    <tr key={String(index)}>
                      {columns.map((column) => (
                        <td key={data.columns[column]!.id}>
                          {formatCell(row[column]!, data.columns[column]!)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                显示 {data.rows.length} / {data.rowCount} 行
                {data.truncated ? '（已截断；不能代表全量汇总）' : ''}
              </p>
            </section>
          )
        }
        const xIndex = data.columns.findIndex((column) => column.id === block.x)
        const rows = data.rows.map((row) =>
          Object.fromEntries([
            ['__x', formatCell(row[xIndex]!, data.columns[xIndex]!)],
            ...block.y.map((id, series) => {
              const index = data.columns.findIndex((column) => column.id === id)
              return [
                `series_${series}`,
                chartNumber(row[index]!, data.columns[index]!, block.numericMode),
              ]
            }),
          ]),
        )
        const Chart = block.chart === 'line' ? LineChart : BarChart
        return (
          <section key={block.id} aria-label={`${block.chart} 图形`}>
            <h2>{block.chart === 'line' ? '趋势' : '对比'}</h2>
            {block.numericMode === 'approximate' && <p>图形使用近似值；精确值见数据表。</p>}
            <ResponsiveContainer width="100%" height={260}>
              <Chart data={rows} margin={{ left: 16, right: 24, top: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="__x" />
                <YAxis />
                <Tooltip />
                {block.y.map((id, index) => {
                  const column = data.columns.find((column) => column.id === id)!
                  const props = {
                    dataKey: `series_${index}`,
                    name: column.label,
                    unit: column.unit,
                  }
                  return block.chart === 'line' ? (
                    <Line
                      key={id}
                      {...props}
                      stroke={index ? '#c06a38' : '#267b74'}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  ) : (
                    <Bar
                      key={id}
                      {...props}
                      fill={index ? '#c06a38' : '#267b74'}
                      isAnimationActive={false}
                    />
                  )
                })}
              </Chart>
            </ResponsiveContainer>
          </section>
        )
      })}
      {document.diagnostics.map((diagnostic) => (
        <p key={`${diagnostic.code}:${diagnostic.path}`}>{diagnostic.message}</p>
      ))}
    </article>
  )
}
