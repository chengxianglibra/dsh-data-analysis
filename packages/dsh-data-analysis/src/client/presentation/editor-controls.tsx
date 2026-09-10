import type { PresentationEdits } from '../../presentation/contracts/editing.ts'
import { blockRegion } from '../../presentation/contracts/interaction.ts'
import type { PresentationBlock, PresentationDocument } from '../../presentation/contracts/types.ts'
import { useActionCopy } from './../i18n/context.tsx'

export interface ReaderEditing {
  edits: PresentationEdits
  onChange: (edits: PresentationEdits) => void
  disabled?: boolean
}

export function CellEditor({
  block,
  document,
  editing,
}: {
  block: PresentationBlock
  document: PresentationDocument
  editing: ReaderEditing
}) {
  const t = useActionCopy()

  const index = editing.edits.blocks.findIndex((entry) => entry.id === block.id)
  const replace = (next: PresentationBlock) =>
    editing.onChange({
      ...editing.edits,
      blocks: editing.edits.blocks.map((entry) => (entry.id === block.id ? next : entry)),
    })
  const canMove = (offset: number) => {
    const other = editing.edits.blocks[index + offset]
    return !!other && blockRegion(document, block.id) === blockRegion(document, other.id)
  }
  const move = (offset: number) => {
    const blocks = [...editing.edits.blocks]
    const other = index + offset
    if (!canMove(offset)) return
    ;[blocks[index], blocks[other]] = [blocks[other]!, blocks[index]!]
    editing.onChange({ ...editing.edits, blocks })
  }
  const tableColumns =
    block.kind === 'table'
      ? document.datasets.find((entry) => entry.id === block.datasetId)!.data.columns
      : []
  const selected =
    block.kind === 'table' ? (block.columns ?? tableColumns.map((column) => column.id)) : []
  return (
    <fieldset
      className="pr-cell-editor pr-interactive"
      disabled={editing.disabled}
      aria-label={t('marivo.presentation.edit-cell-value', { p0: block.id })}
    >
      <legend>{t('marivo.presentation.edit-cell')}</legend>
      <div className="pr-editor-actions">
        <button type="button" disabled={!canMove(-1)} onClick={() => move(-1)}>
          {t('marivo.presentation.move-up')}
        </button>
        <button type="button" disabled={!canMove(1)} onClick={() => move(1)}>
          {t('marivo.presentation.move-down')}
        </button>
        <button
          type="button"
          onClick={() =>
            editing.onChange({
              ...editing.edits,
              blocks: editing.edits.blocks.filter((entry) => entry.id !== block.id),
            })
          }
        >
          {t('marivo.presentation.delete-cell')}
        </button>
      </div>
      {block.kind === 'markdown' && (
        <label>
          {t('marivo.presentation.content')}
          <textarea
            aria-label={t('marivo.presentation.content-value', { p0: block.id })}
            value={block.text}
            onChange={(event) => replace({ ...block, text: event.target.value })}
          />
        </label>
      )}
      {block.kind === 'metric' && (
        <label>
          {t('marivo.presentation.metric-label')}
          <input
            value={t(block.label)}
            onChange={(event) => replace({ ...block, label: event.target.value })}
          />
        </label>
      )}
      {block.kind === 'chart' && (
        <p className="pr-muted">
          {t('marivo.presentation.use-chart-exploration-in-the-cell-menu-to-change')}
        </p>
      )}
      {block.kind === 'table' && (
        <div>
          <p>{t('marivo.presentation.visible-columns-at-least-one')}</p>
          {tableColumns.map((column) => (
            <label className="pr-editor-column" key={column.id}>
              <input
                type="checkbox"
                checked={selected.includes(column.id)}
                disabled={selected.length === 1 && selected[0] === column.id}
                onChange={(event) =>
                  replace({
                    ...block,
                    columns: event.target.checked
                      ? [...selected, column.id]
                      : selected.filter((id) => id !== column.id),
                  })
                }
              />
              {t(column.label)}
            </label>
          ))}
          <ol>
            {selected.map((id, order) => (
              <li key={id}>
                {tableColumns.find((column) => column.id === id)!.label}
                <button
                  type="button"
                  disabled={order === 0}
                  aria-label={t('marivo.presentation.move-column-value-left', { p0: id })}
                  onClick={() => {
                    const columns = [...selected]
                    ;[columns[order - 1], columns[order]] = [columns[order]!, columns[order - 1]!]
                    replace({ ...block, columns })
                  }}
                >
                  {t('marivo.presentation.move-earlier')}
                </button>
                <button
                  type="button"
                  disabled={order === selected.length - 1}
                  aria-label={t('marivo.presentation.move-column-value-right', { p0: id })}
                  onClick={() => {
                    const columns = [...selected]
                    ;[columns[order], columns[order + 1]] = [columns[order + 1]!, columns[order]!]
                    replace({ ...block, columns })
                  }}
                >
                  {t('marivo.presentation.move-later')}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </fieldset>
  )
}
