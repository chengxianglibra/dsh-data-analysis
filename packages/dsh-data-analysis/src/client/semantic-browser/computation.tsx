// @ts-nocheck -- JSX is bundled by the plugin client build.
import { useState } from 'react'
import { refKey } from '../../semantic-reference/contracts.ts'

const units = {
  second: '秒',
  minute: '分钟',
  hour: '小时',
  day: '日',
  week: '周',
  month: '月',
  quarter: '季度',
  year: '年',
}
const reasons = {
  unsupported_syntax: '当前表达式语法尚不支持结构化展示',
  description_unavailable: '当前定义没有可用的表达式说明',
  limit_exceeded: '表达式超过描述大小上限',
}
const kinds = {
  aggregate: '聚合',
  weighted_mean: 'weighted_mean',
  ratio: '比率',
  linear: '线性组合',
  cumulative: '累计',
  expression: 'Ibis 表达式',
}
const field = (object, name) => object?.fields.find((x) => x.name === name)?.value
const op = (operation) =>
  `${operation?.kind ?? '未声明'}${operation?.q === undefined ? '' : `(q=${operation.q})`}`
function anchorText(anchor) {
  if (anchor?.kind === 'all_history') return '从全部历史起点累计'
  if (anchor?.kind === 'trailing')
    return `滚动累计 ${anchor.count} ${units[anchor.unit] ?? anchor.unit}`
  if (anchor?.kind === 'grain_to_date') {
    const grain = anchor.grain
    return grain.kind === 'semantic'
      ? `从 ${grain.calendar.path} 的 ${grain.level} 周期起点累计，每个周期重新开始`
      : `从当前${units[grain.unit] ?? grain.unit}起点累计，每个周期重新开始`
  }
  return '累计规则暂不支持展示'
}
function ExpressionCode({ node, objects, navigate }) {
  const [notice, setNotice] = useState('')
  const display = node.display
  if (display?.form !== 'normalized_ibis' || display.language !== 'python')
    return (
      <p className="sb-muted">
        {reasons[node.reason] ?? '当前 Runtime 未提供可展示的 Ibis 表达式文本。'}
      </p>
    )
  async function copy() {
    try {
      await navigator.clipboard.writeText(display.text)
      setNotice('表达式已复制')
    } catch {
      setNotice('复制失败，请手动选择代码复制。')
    }
  }
  return (
    <section className="sb-expression" aria-label="Ibis 表达式">
      <div className="sb-expression-code">
        <button
          type="button"
          className="sb-expression-copy"
          aria-label="复制 Ibis 表达式"
          title="复制 Ibis 表达式"
          onClick={copy}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
          </svg>
        </button>
        <pre>
          <code>{display.text}</code>
        </pre>
      </div>
      <div className="sb-expression-bindings">
        {display.bindings.map((binding) => (
          <div key={binding.alias}>
            <code>{binding.alias}</code>
            <span> → </span>
            <RefLink refValue={binding.ref} objects={objects} navigate={navigate} />
          </div>
        ))}
      </div>
      {display.redacted_literals && <p className="sb-muted">常量值已隐藏为 REDACTED 标记。</p>}
      <span role="status">{notice}</span>
    </section>
  )
}
function inputs(node) {
  switch (node.kind) {
    case 'aggregate':
      return [['聚合目标', node.target]]
    case 'weighted_mean':
      return [
        ['数值', node.value],
        ['权重', node.weight],
      ]
    case 'ratio':
      return [
        ['分子', node.numerator],
        ['分母', node.denominator],
      ]
    case 'linear':
      return node.terms.map((t, i) => [`第 ${i + 1} 项（${t.sign}）`, t.metric])
    case 'cumulative':
      return [['基础指标', node.base]]
    default:
      return []
  }
}
function RefLink({ refValue, objects, navigate }) {
  if (!refValue) return <span>未声明</span>
  const key = refKey(refValue),
    object = objects.get(key)
  return (
    <button
      type="button"
      className="sb-definition-link"
      disabled={!object}
      title={key}
      onClick={() => navigate(key)}
    >
      {refValue.path}
      {!object ? '（当前目录未包含）' : ''}
    </button>
  )
}
function referencedDefinitions(object, objects) {
  const seen = new Set([refKey(object.ref)])
  const queue = [object]
  const entries = []
  for (let index = 0; index < queue.length; index++) {
    for (const [, ref] of inputs(queue[index].computation.node)) {
      const key = refKey(ref)
      if (seen.has(key)) continue
      seen.add(key)
      const child = objects.get(key)
      if (!child?.computation) continue
      if (entries.length === 40) return { entries, limited: true }
      entries.push(child)
      queue.push(child)
    }
  }
  return { entries, limited: false }
}
function Formula({ node, objects, navigate }) {
  const link = (ref) => <RefLink refValue={ref} objects={objects} navigate={navigate} />
  switch (node.kind) {
    case 'aggregate':
      return (
        <>
          {op(node.operation)}({link(node.target)})
        </>
      )
    case 'ratio':
      return (
        <>
          {link(node.numerator)} ÷ {link(node.denominator)}
        </>
      )
    case 'linear':
      return node.terms.map((term, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Authored terms preserve repeated refs and order.
        <span className="sb-formula-term" key={index}>
          {term.sign} {link(term.metric)}{' '}
        </span>
      ))
    case 'weighted_mean':
      return (
        <>
          weighted_mean({link(node.value)}, {link(node.weight)})
        </>
      )
    case 'cumulative':
      return (
        <>
          {anchorText(node.anchor)}
          <br />
          基础指标：{link(node.base)}
        </>
      )
    default:
      return '当前计算类型暂不支持展示'
  }
}
function DefinitionNode({ object, objects, navigate }) {
  const definition = object.computation,
    node = definition?.node
  if (!node) return <p className="sb-muted">当前对象没有公开的计算定义。</p>
  const relationProps = { objects, navigate }
  return (
    <div className="sb-calculation-node">
      {node.kind === 'expression' ? (
        <ExpressionCode node={node} objects={objects} navigate={navigate} />
      ) : (
        <p className="sb-formula">
          <Formula node={node} objects={objects} navigate={navigate} />
        </p>
      )}
      {node.kind === 'cumulative' && (
        <dl className="sb-fields">
          <dt>累计时间轴</dt>
          <dd>
            {node.over.selection === 'explicit' ? (
              <RefLink refValue={node.over.ref} {...relationProps} />
            ) : (
              '使用默认时间轴，需观察上下文确定'
            )}
          </dd>
          {node.over.selection === 'explicit' && (
            <>
              <dt>时间粒度 / 时区</dt>
              <dd>
                {field(objects.get(refKey(node.over.ref)), 'granularity') ?? '未声明'} /{' '}
                {field(objects.get(refKey(node.over.ref)), 'timezone') ?? '未声明'}
              </dd>
            </>
          )}
          {node.anchor.kind === 'grain_to_date' && node.anchor.grain.kind === 'semantic' && (
            <>
              <dt>周期日历</dt>
              <dd>
                <RefLink refValue={node.anchor.grain.calendar} {...relationProps} />
              </dd>
              <dt>日历层级</dt>
              <dd>{node.anchor.grain.level}</dd>
              <dt>日历边界时区</dt>
              <dd>
                {field(objects.get(refKey(node.anchor.grain.calendar)), 'boundary_timezone') ??
                  '未声明'}
              </dd>
            </>
          )}
        </dl>
      )}
      {!!node.filter?.length && (
        <div>
          <h4>定义内过滤条件</h4>
          <ul>
            {node.filter.map((f) => (
              <li key={refKey(f.dimension)}>
                <RefLink refValue={f.dimension} {...relationProps} />{' '}
                {f.operator === 'in' ? '属于' : '等于'} {JSON.stringify(f.values ?? f.value)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
function TemporalRules({ temporal, objects, navigate }) {
  if (
    !temporal ||
    (temporal.declared.status === 'not_declared' &&
      temporal.override.status === 'not_declared' &&
      temporal.effective.status === 'not_applicable')
  )
    return null
  const row = (label, rule) => (
    <div>
      <strong>{label}：</strong>
      {rule.over ? (
        <>
          <RefLink refValue={rule.over} objects={objects} navigate={navigate} /> · {op(rule.fold)}
        </>
      ) : rule.fold ? (
        op(rule.fold)
      ) : rule.status === 'component_defined' ? (
        '由计算公式及组成对象确定'
      ) : rule.status === 'not_declared' ? (
        '未声明'
      ) : rule.status === 'not_applicable' ? (
        '不适用'
      ) : (
        `暂不支持的规则状态：${rule.status}`
      )}
    </div>
  )
  return (
    <section className="sb-temporal" aria-label="时间折叠规则">
      <h4>时间折叠规则</h4>
      {temporal.declared.status !== 'not_declared' && row('声明规则', temporal.declared)}
      {temporal.override.status !== 'not_declared' && row('指标覆盖', temporal.override)}
      {temporal.effective.status !== 'not_applicable' && row('有效规则', temporal.effective)}
    </section>
  )
}
export function ComputationCard({ object, objects, navigate }) {
  const node = object.computation?.node
  if (!node) return <p className="sb-muted">当前对象没有公开的计算定义。</p>
  const related = referencedDefinitions(object, objects)
  const entityRefs = object.relations
    .filter((r) => r.field === 'effective_entities' || r.field === 'entity')
    .map((r) => r.ref)
  const entityKeys = [...new Set(entityRefs.map(refKey))]
  return (
    <section className="sb-computation" aria-label="指标计算口径">
      <div className="sb-computation-heading">
        <h3>计算口径</h3>
        <span className="sb-badge">{kinds[node.kind] ?? node.kind}</span>
        {field(object, 'unit') && <span>{field(object, 'unit')}</span>}
      </div>
      <DefinitionNode
        key={refKey(object.ref)}
        object={object}
        objects={objects}
        navigate={navigate}
      />
      <TemporalRules temporal={object.computation.temporal} objects={objects} navigate={navigate} />
      {!!related.entries.length && (
        <section className="sb-referenced-definitions" aria-label="引用对象定义">
          <h3>引用对象定义</h3>
          {related.entries.map((child) => (
            <section
              className="sb-definition-entry"
              aria-label={refKey(child.ref)}
              key={refKey(child.ref)}
            >
              <div className="sb-definition-entry-heading">
                <h4>
                  <RefLink refValue={child.ref} objects={objects} navigate={navigate} />
                </h4>
                <span className="sb-badge">{kinds[child.computation.node.kind]}</span>
              </div>
              <DefinitionNode object={child} objects={objects} navigate={navigate} />
              {!!child.guardrails.length && (
                <ul className="sb-muted">
                  {[...new Set(child.guardrails)].map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
              <TemporalRules
                temporal={child.computation.temporal}
                objects={objects}
                navigate={navigate}
              />
            </section>
          ))}
          {related.limited && (
            <p className="sb-muted">当前展示前 40 个引用对象的定义，点击对象名称可继续查看。</p>
          )}
        </section>
      )}
      {!!entityKeys.length && (
        <section className="sb-definition-sources" aria-label="数据来源与粒度">
          <h3>数据来源与粒度</h3>
          {entityKeys.map((key) => {
            const entity = objects.get(key)
            return (
              <div key={key}>
                <RefLink
                  refValue={entity?.ref ?? entityRefs.find((r) => refKey(r) === key)}
                  objects={objects}
                  navigate={navigate}
                />
                {field(entity, 'primary_key') && (
                  <span className="sb-muted">主键：{field(entity, 'primary_key')}</span>
                )}
              </div>
            )
          })}
        </section>
      )}
    </section>
  )
}
