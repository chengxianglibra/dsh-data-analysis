import { useEffect, useRef } from 'react'
import {
  CHART_LABELS,
  CHART_TYPES,
  type ChartOptions,
  type ChartType,
  type ChartView,
  chartTransition,
} from '../../presentation/contracts/charts.ts'
import type { DatasetColumn, TypedDataset } from '../../presentation/contracts/types.ts'
import {
  type ChartExploration,
  changeChartView,
  chartViewError,
  initialChartExploration,
  savedChartView,
  withChartSeries,
  withChartSeriesStyle,
  withChartX,
} from './chart-view.ts'
import { CloseIcon } from './icons.tsx'
import { type ChartBlock, columnLabel } from './model.ts'

const numeric = (column: DatasetColumn) => ['float64', 'int64', 'decimal'].includes(column.type)
const trendTypes = new Set<ChartType>(['line', 'area', 'stackedArea', 'sparkline'])
const barTypes = new Set<ChartType>([
  'bar',
  'horizontalBar',
  'stackedBar',
  'stackedBar100',
  'horizontalStackedBar',
  'horizontalStackedBar100',
])
const requirements: Partial<Record<ChartType, string>> = {
  sparkline: '需要单一数值系列',
  stackedArea: '需要同单位数值系列',
  stackedBar: '需要同单位数值系列',
  horizontalStackedBar: '需要同单位数值系列',
  stackedBar100: '需要预计算比例列与分母',
  horizontalStackedBar100: '需要预计算比例列与分母',
  histogram: '需要预计算区间边界与频数',
  boxPlot: '需要预计算五数摘要',
  scatter: '需要数值 X 与单一 Y 系列',
  heatmap: '需要同单位数值矩阵',
  pie: '需要预计算数值与占比',
  funnel: '需要预计算阶段数值与占比',
  waterfall: '需要预计算起止值、变化量与步骤角色',
  leaderboard: '需要预计算排名与数值',
}

/** Native fields keep this page-local editor keyboard accessible without hiding the live chart. */
export function ChartExplorer({
  block,
  data,
  state,
  onChange,
  onClose,
  restoreFocusTo,
}: {
  block: ChartBlock
  data: TypedDataset
  state: ChartExploration
  onChange: (state: ChartExploration) => void
  onClose: () => void
  restoreFocusTo?: HTMLElement
}) {
  const close = useRef<HTMLButtonElement>(null)
  const view = state.view
  const transitions = CHART_TYPES.map((type) => ({ type, next: chartTransition(view, type, data) }))
  const update = (next: ChartView) => {
    if (!chartViewError(next, data)) onChange(changeChartView(state, next))
  }
  const changeType = (type: ChartType) => {
    const next = chartTransition(view, type, data)
    if (next) update(next)
  }
  const dismiss = () => {
    onClose()
    restoreFocusTo?.focus()
  }
  useEffect(() => {
    close.current?.focus()
  }, [])
  const currentBarMode = view.chart.endsWith('100')
    ? 'percent'
    : view.chart.toLowerCase().includes('stacked')
      ? 'stacked'
      : 'grouped'
  const horizontal = view.chart.startsWith('horizontal')
  const barType = (isHorizontal: boolean, mode: string): ChartType =>
    mode === 'percent'
      ? isHorizontal
        ? 'horizontalStackedBar100'
        : 'stackedBar100'
      : mode === 'stacked'
        ? isHorizontal
          ? 'horizontalStackedBar'
          : 'stackedBar'
        : isHorizontal
          ? 'horizontalBar'
          : 'bar'
  return (
    <section
      className="pr-chart-explorer pr-interactive"
      aria-label="探索图表"
      data-chart-explorer={block.id}
    >
      <header className="pr-explorer-header">
        <div>
          <h3>探索图表</h3>
          <p className="pr-muted">
            仅当前页面生效；导出当前视图可保留，重新打开完整报告仍为原图。统计值与占比分母由作者提供。
          </p>
        </div>
        <button
          ref={close}
          type="button"
          className="pr-icon-button"
          aria-label="关闭探索图表"
          onClick={dismiss}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="pr-explorer-grid">
        {!!block.preparedViews?.length && (
          <label>
            已准备视图
            <select
              value={state.preparedViewId ?? ''}
              onChange={(event) => {
                const prepared = block.preparedViews?.find((item) => item.id === event.target.value)
                onChange({
                  view: prepared
                    ? savedChartView({ ...prepared, kind: 'chart' })
                    : savedChartView(block),
                  hidden: [],
                  preparedViewId: prepared?.id,
                })
              }}
            >
              <option value="">作者原图</option>
              {block.preparedViews?.map((prepared) => (
                <option key={prepared.id} value={prepared.id}>
                  {prepared.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          图形类型
          <select
            value={view.chart}
            onChange={(event) => changeType(event.target.value as ChartType)}
          >
            {transitions.map(({ type, next }) => (
              <option key={type} value={type} disabled={!next}>
                {CHART_LABELS[type]} ({type})
                {next ? '' : ` — ${requirements[type] ?? '需要适用的数值字段'}；可切换已准备视图`}
              </option>
            ))}
          </select>
        </label>
        <label>
          X 字段
          <select value={view.x} onChange={(event) => update(withChartX(view, event.target.value))}>
            {data.columns.map((column) => {
              const reason = chartViewError(withChartX(view, column.id), data)
              return (
                <option key={column.id} value={column.id} disabled={!!reason} title={reason}>
                  {columnLabel(column)}
                  {reason ? ' — 不适用' : ''}
                </option>
              )
            })}
          </select>
        </label>
        {barTypes.has(view.chart) && (
          <>
            <label>
              方向
              <select
                value={horizontal ? 'horizontal' : 'vertical'}
                onChange={(event) =>
                  changeType(barType(event.target.value === 'horizontal', currentBarMode))
                }
              >
                <option value="vertical">纵向</option>
                <option value="horizontal">横向</option>
              </select>
            </label>
            <label>
              柱形模式
              <select
                value={currentBarMode}
                onChange={(event) => changeType(barType(horizontal, event.target.value))}
              >
                {(
                  [
                    ['grouped', '并列'],
                    ['stacked', '堆叠'],
                    ['percent', '100% 堆叠'],
                  ] as const
                ).map(([mode, label]) => (
                  <option
                    key={mode}
                    value={mode}
                    disabled={!chartTransition(view, barType(horizontal, mode), data)}
                  >
                    {label}
                    {chartTransition(view, barType(horizontal, mode), data)
                      ? ''
                      : ` — ${requirements[barType(horizontal, mode)] ?? '需要适用的数值字段'}`}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {trendTypes.has(view.chart) && (
          <label>
            数据点
            <select
              value={view.options?.showPoints ?? 'auto'}
              onChange={(event) =>
                update({
                  ...view,
                  options: {
                    ...view.options,
                    showPoints: event.target.value as 'auto' | 'always' | 'never',
                  },
                })
              }
            >
              <option value="auto">自动</option>
              <option value="always">显示</option>
              <option value="never">隐藏</option>
            </select>
          </label>
        )}
      </div>
      <fieldset className="pr-explorer-fields">
        <legend>数值系列</legend>
        {data.columns.filter(numeric).map((column) => {
          const selected = view.y.includes(column.id)
          const single = [
            'sparkline',
            'scatter',
            'histogram',
            'boxPlot',
            'pie',
            'funnel',
            'waterfall',
            'leaderboard',
          ].includes(view.chart)
          const y = selected
            ? view.y.filter((field) => field !== column.id)
            : single
              ? [column.id]
              : [...view.y, column.id]
          const next = withChartSeries(view, y)
          const reason = chartViewError(next, data)
          return (
            <div key={column.id} className="pr-explorer-series">
              <label title={reason}>
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!!reason}
                  onChange={() => update(next)}
                />
                {columnLabel(column)}
              </label>
              {selected && (
                <label className="pr-explorer-visible">
                  <input
                    type="checkbox"
                    checked={!state.hidden.includes(column.id)}
                    onChange={(event) =>
                      onChange({
                        ...state,
                        hidden: event.target.checked
                          ? state.hidden.filter((field) => field !== column.id)
                          : [...state.hidden, column.id],
                      })
                    }
                  />
                  显示 {column.label}
                </label>
              )}
              {selected && trendTypes.has(view.chart) && (
                <>
                  <select
                    aria-label={`${column.label} 线型`}
                    value={view.options?.series?.[column.id]?.lineStyle ?? ''}
                    onChange={(event) =>
                      update(
                        withChartSeriesStyle(
                          view,
                          column.id,
                          'lineStyle',
                          (event.target.value || undefined) as NonNullable<
                            ChartOptions['series']
                          >[string]['lineStyle'],
                        ),
                      )
                    }
                  >
                    <option value="">默认／按角色</option>
                    <option value="solid">实线</option>
                    <option value="dashed">虚线</option>
                    <option value="dotted">点线</option>
                  </select>
                  <select
                    aria-label={`${column.label} 角色`}
                    value={view.options?.series?.[column.id]?.role ?? ''}
                    onChange={(event) =>
                      update(
                        withChartSeriesStyle(
                          view,
                          column.id,
                          'role',
                          (event.target.value || undefined) as NonNullable<
                            ChartOptions['series']
                          >[string]['role'],
                        ),
                      )
                    }
                  >
                    <option value="">未声明角色</option>
                    <option value="actual">实际 actual</option>
                    <option value="baseline">基线 baseline</option>
                    <option value="target">目标 target</option>
                    <option value="forecast">预测 forecast</option>
                    <option value="plan">计划 plan</option>
                    <option value="comparison">比较 comparison</option>
                  </select>
                </>
              )}
            </div>
          )
        })}
      </fieldset>
      {view.chart === 'scatter' && (
        <fieldset className="pr-explorer-fields">
          <legend>散点字段</legend>
          <div className="pr-explorer-grid">
            {(
              [
                ['size', '点大小'],
                ['color', '分类颜色'],
                ['label', '点标签'],
              ] as const
            ).map(([field, label]) => (
              <label key={field}>
                {label}
                <select
                  value={view.bindings?.[field] ?? ''}
                  onChange={(event) => {
                    const bindings = { ...view.bindings }
                    if (event.target.value) bindings[field] = event.target.value
                    else delete bindings[field]
                    update({ ...view, bindings })
                  }}
                >
                  <option value="">未选择</option>
                  {data.columns
                    .filter((column) => field !== 'size' || numeric(column))
                    .map((column) => {
                      const reason = chartViewError(
                        { ...view, bindings: { ...view.bindings, [field]: column.id } },
                        data,
                      )
                      return (
                        <option key={column.id} value={column.id} disabled={!!reason}>
                          {columnLabel(column)}
                          {reason ? ' — 不适用' : ''}
                        </option>
                      )
                    })}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <footer className="pr-explorer-footer">
        <button
          type="button"
          onClick={() => {
            onChange(initialChartExploration(block))
          }}
        >
          恢复原图
        </button>
      </footer>
    </section>
  )
}
