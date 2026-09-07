import type { PresentationEdits } from '../../presentation/contracts/editing.ts'
import type { PresentationBlock, PresentationDocument } from '../../presentation/contracts/types.ts'

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
  const index = editing.edits.blocks.findIndex((entry) => entry.id === block.id)
  const replace = (next: PresentationBlock) =>
    editing.onChange({
      ...editing.edits,
      blocks: editing.edits.blocks.map((entry) => (entry.id === block.id ? next : entry)),
    })
  const move = (offset: number) => {
    const blocks = [...editing.edits.blocks]
    const other = index + offset
    if (other < 0 || other >= blocks.length) return
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
      aria-label={`编辑 cell ${block.id}`}
    >
      <legend>编辑 cell</legend>
      <div className="pr-editor-actions">
        <button type="button" disabled={index === 0} onClick={() => move(-1)}>
          上移
        </button>
        <button
          type="button"
          disabled={index === editing.edits.blocks.length - 1}
          onClick={() => move(1)}
        >
          下移
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
          删除 cell
        </button>
      </div>
      {block.kind === 'markdown' && (
        <label>
          正文
          <textarea
            aria-label={`正文 ${block.id}`}
            value={block.text}
            onChange={(event) => replace({ ...block, text: event.target.value })}
          />
        </label>
      )}
      {block.kind === 'metric' && (
        <label>
          指标标签
          <input
            value={block.label}
            onChange={(event) => replace({ ...block, label: event.target.value })}
          />
        </label>
      )}
      {block.kind === 'chart' && (
        <p className="pr-muted">
          通过 cell
          菜单的图表探索修改图形、字段和样式；编辑模式下这些配置随报告保存，筛选和临时显隐仍不保存。
        </p>
      )}
      {block.kind === 'table' && (
        <div>
          <p>显示列（至少一列）</p>
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
              {column.label}
            </label>
          ))}
          <ol>
            {selected.map((id, order) => (
              <li key={id}>
                {tableColumns.find((column) => column.id === id)!.label}
                <button
                  type="button"
                  disabled={order === 0}
                  aria-label={`左移列 ${id}`}
                  onClick={() => {
                    const columns = [...selected]
                    ;[columns[order - 1], columns[order]] = [columns[order]!, columns[order - 1]!]
                    replace({ ...block, columns })
                  }}
                >
                  前移
                </button>
                <button
                  type="button"
                  disabled={order === selected.length - 1}
                  aria-label={`右移列 ${id}`}
                  onClick={() => {
                    const columns = [...selected]
                    ;[columns[order], columns[order + 1]] = [columns[order + 1]!, columns[order]!]
                    replace({ ...block, columns })
                  }}
                >
                  后移
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </fieldset>
  )
}
