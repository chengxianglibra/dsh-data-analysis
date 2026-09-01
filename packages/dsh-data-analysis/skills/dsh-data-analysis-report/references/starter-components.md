# Starter components

Copy only the components used by the report. They are ordinary editable files and are not a report
DSL. The built-ins never aggregate, sort, rank, fill, interpolate, or infer analytical meaning.

Prefer the allowlisted copier from the Skill resource base:

```text
node scripts/copy-starter.mjs --target reports/monthly-revenue --basic --component report-data --component report-charts --snippet chart-with-table
```

Run it with the Workspace root as the current directory. Components land in `assets/`, snippets
land in `snippets/`, existing files are never overwritten, and stdout contains only the copied
Workspace-relative paths.

```javascript
const revenue = ReportData.get('monthly-revenue')

ReportCharts.renderLineChart(document.querySelector('#revenue-chart'), revenue, {
  x: 'month',
  y: 'revenue',
  series: 'region',
  title: '月度收入',
  xLabel: '月份',
  yLabel: '收入',
  fallback: {
    columns: ['month', 'region', 'revenue'],
    maxRows: 100,
    caption: '月度收入明细',
  },
})
```

`renderBarChart` accepts `category`, `value`, `orientation`, `title`, and the same required
`fallback`. Both built-in charts add one expandable bounded table and one dataset quality/details
entry. `renderTable` creates an independent table and is not a second chart fallback.

`renderKpis` accepts authored `{ label, value, detail?, status? }` items. The Agent must supply
verified KPI values; the component does not calculate them. Use `formatNumber`, `formatPercent`,
and `formatDate` only for presentation.

Custom DOM, SVG, Canvas, or library charts are allowed. Give their host a meaningful `aria-label`
or `data-chart-title`, then call `ReportCharts.attachDataDetails(host, dataset)` when one dataset
drives the chart. For multi-source charts, disclose each source separately instead of merging
quality states.

Use the `mount` helper from `starter/snippets/mount-error.js` for visible initialization failure.
It writes a non-sensitive component code, rethrows, and never substitutes an empty chart.
