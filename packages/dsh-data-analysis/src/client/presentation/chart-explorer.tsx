import { useEffect, useRef } from 'react'
import {
  CHART_TYPES,
  type ChartOptions,
  type ChartType,
  type ChartView,
  chartTransition,
} from '../../presentation/contracts/charts.ts'
import type { DatasetColumn, TypedDataset } from '../../presentation/contracts/types.ts'
import { useActionCopy } from './../i18n/context.tsx'
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
  sparkline: 'marivo.presentation.requires-one-numeric-series',
  stackedArea: 'marivo.presentation.requires-numeric-series-with-matching-units',
  stackedBar: 'marivo.presentation.requires-numeric-series-with-matching-units',
  horizontalStackedBar: 'marivo.presentation.requires-numeric-series-with-matching-units',
  stackedBar100: 'marivo.presentation.requires-prepared-proportions-and-denominators',
  horizontalStackedBar100: 'marivo.presentation.requires-prepared-proportions-and-denominators',
  histogram: 'marivo.presentation.requires-prepared-bin-boundaries-and-frequencies',
  boxPlot: 'marivo.presentation.requires-a-prepared-five-number-summary',
  scatter: 'marivo.presentation.requires-numeric-x-and-one-y-series',
  heatmap: 'marivo.presentation.requires-a-numeric-matrix-with-matching-units',
  pie: 'marivo.presentation.requires-prepared-values-and-proportions',
  funnel: 'marivo.presentation.requires-prepared-stage-values-and-proportions',
  waterfall: 'marivo.presentation.requires-prepared-start-end-values-changes-and-step-roles',
  leaderboard: 'marivo.presentation.requires-prepared-ranks-and-values',
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
  const t = useActionCopy()

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
      aria-label={t('marivo.presentation.explore-chart')}
      data-chart-explorer={block.id}
    >
      <header className="pr-explorer-header">
        <div>
          <h3>{t('marivo.presentation.explore-chart')}</h3>
          <p className="pr-muted">
            {t('marivo.presentation.changes-apply-to-this-view-export-the-current-view')}
          </p>
        </div>
        <button
          ref={close}
          type="button"
          className="pr-icon-button"
          aria-label={t('marivo.presentation.close-chart-explorer')}
          onClick={dismiss}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="pr-explorer-grid">
        {!!block.preparedViews?.length && (
          <label>
            {t('marivo.presentation.prepared-views')}
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
              <option value="">{t('marivo.presentation.original-chart')}</option>
              {block.preparedViews?.map((prepared) => (
                <option key={prepared.id} value={prepared.id}>
                  {t(prepared.label)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t('marivo.presentation.chart-type')}
          <select
            value={view.chart}
            onChange={(event) => changeType(event.target.value as ChartType)}
          >
            {transitions.map(({ type, next }) => (
              <option key={type} value={type} disabled={!next}>
                {t(`marivo.presentation.chart-type-${type}`)}
                {next
                  ? ''
                  : t('marivo.presentation.value-try-a-prepared-view', {
                      p0: requirements[type] ?? 'marivo.presentation.applicable-numeric-fields',
                    })}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('marivo.presentation.x-field')}
          <select value={view.x} onChange={(event) => update(withChartX(view, event.target.value))}>
            {data.columns.map((column) => {
              const reason = chartViewError(withChartX(view, column.id), data)
              return (
                <option key={column.id} value={column.id} disabled={!!reason} title={t(reason)}>
                  {columnLabel(column)}
                  {reason ? t('marivo.presentation.not-applicable') : ''}
                </option>
              )
            })}
          </select>
        </label>
        {barTypes.has(view.chart) && (
          <>
            <label>
              {t('marivo.presentation.orientation')}
              <select
                value={horizontal ? 'horizontal' : 'vertical'}
                onChange={(event) =>
                  changeType(barType(event.target.value === 'horizontal', currentBarMode))
                }
              >
                <option value="vertical">{t('marivo.presentation.vertical')}</option>
                <option value="horizontal">{t('marivo.presentation.horizontal')}</option>
              </select>
            </label>
            <label>
              {t('marivo.presentation.bar-mode')}
              <select
                value={currentBarMode}
                onChange={(event) => changeType(barType(horizontal, event.target.value))}
              >
                {(
                  [
                    ['grouped', t('marivo.presentation.grouped')],
                    ['stacked', t('marivo.presentation.stacked')],
                    ['percent', t('marivo.presentation.100-stacked')],
                  ] as const
                ).map(([mode, label]) => (
                  <option
                    key={mode}
                    value={mode}
                    disabled={!chartTransition(view, barType(horizontal, mode), data)}
                  >
                    {t(label)}
                    {chartTransition(view, barType(horizontal, mode), data)
                      ? ''
                      : ` — ${t(requirements[barType(horizontal, mode)] ?? 'marivo.presentation.applicable-numeric-fields')}`}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {trendTypes.has(view.chart) && (
          <label>
            {t('marivo.presentation.data-points')}
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
              <option value="auto">{t('marivo.presentation.auto')}</option>
              <option value="always">{t('marivo.presentation.show')}</option>
              <option value="never">{t('marivo.presentation.hide')}</option>
            </select>
          </label>
        )}
      </div>
      <fieldset className="pr-explorer-fields">
        <legend>{t('marivo.presentation.numeric-series')}</legend>
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
              <label title={t(reason)}>
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
                  {t('marivo.presentation.show')}
                  {t(column.label)}
                </label>
              )}
              {selected && trendTypes.has(view.chart) && (
                <>
                  <select
                    aria-label={t('marivo.presentation.value-line-style', { p0: column.label })}
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
                    <option value="">{t('marivo.presentation.default-by-role')}</option>
                    <option value="solid">{t('marivo.presentation.solid')}</option>
                    <option value="dashed">{t('marivo.presentation.dashed')}</option>
                    <option value="dotted">{t('marivo.presentation.dotted')}</option>
                  </select>
                  <select
                    aria-label={t('marivo.presentation.value-role', { p0: column.label })}
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
                    <option value="">{t('marivo.presentation.no-declared-role')}</option>
                    <option value="actual">{t('marivo.presentation.actual')}</option>
                    <option value="baseline">{t('marivo.presentation.baseline')}</option>
                    <option value="target">{t('marivo.presentation.target')}</option>
                    <option value="forecast">{t('marivo.presentation.forecast')}</option>
                    <option value="plan">{t('marivo.presentation.plan')}</option>
                    <option value="comparison">{t('marivo.presentation.comparison')}</option>
                  </select>
                </>
              )}
            </div>
          )
        })}
      </fieldset>
      {view.chart === 'scatter' && (
        <fieldset className="pr-explorer-fields">
          <legend>{t('marivo.presentation.scatter-fields')}</legend>
          <div className="pr-explorer-grid">
            {(
              [
                ['size', t('marivo.presentation.point-size')],
                ['color', t('marivo.presentation.category-colors')],
                ['label', t('marivo.presentation.point-label')],
              ] as const
            ).map(([field, label]) => (
              <label key={field}>
                {t(label)}
                <select
                  value={view.bindings?.[field] ?? ''}
                  onChange={(event) => {
                    const bindings = { ...view.bindings }
                    if (event.target.value) bindings[field] = event.target.value
                    else delete bindings[field]
                    update({ ...view, bindings })
                  }}
                >
                  <option value="">{t('marivo.presentation.not-selected')}</option>
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
                          {reason ? t('marivo.presentation.not-applicable') : ''}
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
          {t('marivo.presentation.restore-original-chart')}
        </button>
      </footer>
    </section>
  )
}
