const exampleDataset = ReportData.get('dsh-starter-placeholder-dataset')
const exampleRows = ReportData.records('dsh-starter-placeholder-dataset')

mount(document.querySelector('#summary-kpis'), (container) =>
  ReportCharts.renderKpis(container, [
    {
      label: '示例末期收入',
      value: ReportCharts.formatNumber(exampleRows.at(-1).revenue),
      detail: '合成数据，仅演示组件',
      status: 'warning',
    },
  ]),
)

mount(document.querySelector('#revenue-chart'), (container) =>
  ReportCharts.renderLineChart(container, exampleDataset, {
    x: 'month',
    y: 'revenue',
    title: '合成月度收入趋势',
    xLabel: '月份',
    yLabel: '收入',
    fallback: {
      columns: ['month', 'revenue'],
      maxRows: 100,
      caption: '合成月度收入明细',
    },
  }),
)

mount(document.querySelector('#analysis-trace'), (container) =>
  ReportTrace.renderSessionGraph(container, ReportTrace.get('dsh-starter-placeholder-trace')),
)
