import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { translator } from './../../src/client/i18n/copy.ts'
import type { SemanticRef } from '../../src/semantic-reference/contracts.ts'

let directory: string
let render: (
  value: string,
  refs: SemanticRef[],
  available?: SemanticRef[],
  structured?: boolean,
  field?: string,
  kind?: string,
) => string
let renderComputation: (
  expression: string,
  facts: unknown[],
  dependencies?: SemanticRef[],
  available?: SemanticRef[],
  locale?: 'zh-CN' | 'en-US',
  related?: { ref: SemanticRef; dependencies: SemanticRef[] }[],
  extraDependency?: boolean,
) => string
let renderRelated: () => string
const ref: SemanticRef = {
  schema: 'marivo.semantic_ref/v1',
  kind: 'entity',
  path: 'sales.orders',
}
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-semantic-field-'))
  const outfile = path.join(directory, 'render.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { CopyProvider } from './src/client/i18n/context.tsx';
import { translator as fixtureTranslator } from './src/client/i18n/copy.ts';
const renderToStaticMarkup = (node, locale = 'zh-CN') => renderMarkup(createElement(CopyProvider, { t: fixtureTranslator(locale) }, node));
import { FieldValue } from './src/client/semantic-browser/reference-link.tsx';
import { ComputationCard } from './src/client/semantic-browser/computation.tsx';
import { refKey } from './src/semantic-reference/contracts.ts';
export function render(value, refs, available = refs, structured = false, field = 'participants', kind = 'metric') {
  return renderToStaticMarkup(createElement(FieldValue, {
    field: { name: field, value, structured },
    object: { ref: { kind }, relations: refs.map(ref => ({ field, ref })) },
    objects: new Map(available.map(ref => [refKey(ref), { ref }])), navigate() {},
  }));
}
export function renderComputation(expression, facts, dependencies = [], available = dependencies, locale = 'zh-CN', related = [], extraDependency = false) {
  const ref = { schema: 'marivo.semantic_ref/v1', kind: 'metric', path: 'sales.revenue' };
  const fields = dependencies.length ? [{ name: 'dependencies', value: JSON.stringify([...dependencies.map(refKey), ...(extraDependency ? ['unresolved'] : [])]), structured: true }] : [];
  const relations = dependencies.map(ref => ({ field: 'dependencies', ref }));
  const object = { ref, computation: { expression, facts }, fields, relations, guardrails: [] };
  const objects = new Map(available.map(ref => [refKey(ref), { ref, name: ref.path.split('.').at(-1) }]));
  for (const item of related) objects.set(refKey(item.ref), { ref: item.ref, relations: item.dependencies.map(ref => ({ field: 'dependencies', ref })) });
  return renderToStaticMarkup(createElement(ComputationCard, { object, objects, navigate() {} }), locale);
}
export function renderRelated() {
  const ref = { schema: 'marivo.semantic_ref/v1', kind: 'metric', path: 'sales.revenue' };
  const childRef = { schema: 'marivo.semantic_ref/v1', kind: 'measure', path: 'sales.orders.amount' };
  const child = { ref: childRef, name:'amount', computation: { expression: 'column(amount)', facts: [] }, relations: [], guardrails: [], definition: 'Amount' };
  const object = { ref, computation: { expression: 'sum(amount)', facts: [] }, fields: [], relations: [{ field:'dependencies', ref:childRef }], guardrails: [] };
  return renderToStaticMarkup(createElement(ComputationCard, { object, objects: new Map([[refKey(childRef), child]]), navigate() {} }));
}`,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  })
  ;({ render, renderComputation, renderRelated } = await import(pathToFileURL(outfile).href))
})

test('calendar level pairs retain order, repeated names, and declared reference links', () => {
  const pairs = JSON.stringify([
    ['week', 'entity:sales.orders'],
    ['week', 'entity:sales.orders'],
  ])
  const html = render(pairs, [ref], [ref], true, 'levels')
  assert.match(html, /^<dl class="sb-value-map">/)
  assert.equal((html.match(/<dt class="sb-value-key">week<\/dt><dd><button/g) ?? []).length, 2)
  assert.doesNotMatch(html, /<ul/)
  const mixed = JSON.stringify([['week', 'entity:sales.orders'], ['month']])
  assert.match(render(mixed, [ref], [ref], true, 'levels'), /^<ul/)
  assert.match(render(pairs, [ref], [ref], true), /^<ul/)
})

test('known boolean fields use localized labels without changing ordinary strings', () => {
  assert.equal(render('true', [], [], false, 'is_default_time'), '是')
  assert.equal(render('false', [], [], false, 'default'), '否')
  assert.equal(render('false', [], [], false, 'participants'), 'false')
  assert.equal(render('unknown', [], [], false, 'default'), 'unknown')
})

test('structured values show nested lists and mappings without losing repeated references or scalar values', () => {
  const value = JSON.stringify({
    buyer: [ref.kind + ':' + ref.path, ref.kind + ':' + ref.path],
    flags: [false, 0, ''],
  })
  const html = render(value, [ref], [ref], true)
  assert.equal((html.match(/<button/g) ?? []).length, 2)
  assert.match(html, /<dl class="sb-value-map">/)
  assert.match(html, /<ul class="sb-value-list">/)
  assert.match(html, /false/)
  assert.match(html, />0</)
  assert.doesNotMatch(html, /&quot;buyer&quot;/)
  assert.equal(render('["entity:sales.orders"]', []), '[&quot;entity:sales.orders&quot;]')
})

test('long declared lists expose remaining entries on demand', () => {
  const html = render(
    JSON.stringify(Array.from({ length: 12 }, (_, index) => `field_${index}`)),
    [],
    [],
    true,
  )
  assert.match(html, /显示其余 4 项/)
  assert.match(html, /<details>/)
  assert.match(html, /field_11/)
})

test('calculation hides empty expression and renders structured facts', () => {
  assert.equal(renderComputation('', []), '')
  const html = renderComputation('', [
    { name: 'null_rules', value: '["ignore", "zero"]', structured: true },
  ])
  assert.match(html, /ignore/)
  assert.match(html, /zero/)
  assert.doesNotMatch(html, /sb-expression-code/)
  const pairs = renderComputation('', [
    { name: 'facts', value: '[["column", "week"], ["column", "month"]]', structured: true },
  ])
  assert.match(pairs, /<dt class="sb-value-key">来源列<\/dt><dd>week<\/dd>/)
  assert.match(pairs, /<dt class="sb-value-key">来源列<\/dt><dd>month<\/dd>/)
})

test('dependencies move to relationships only when the grouped links preserve every value', () => {
  const measure: SemanticRef = {
    schema: 'marivo.semantic_ref/v1',
    kind: 'measure',
    path: 'sales.orders.amount',
  }
  const html = renderComputation('', [], [ref, measure])
  assert.equal(html, '')
  const partial = renderComputation('', [], [ref, measure], [ref, measure], 'zh-CN', [], true)
  assert.match(partial, /声明依赖/)
  assert.match(partial, /title="entity:sales.orders"/)
  assert.match(partial, /title="measure:sales.orders.amount"/)
  assert.match(partial, /unresolved/)
  assert.doesNotMatch(partial, /sb-expression-code/)
})

test('referenced object title is a single direct navigation control', () => {
  const html = renderRelated()
  assert.match(html, /class="lucide lucide-ruler sb-related-icon"/)
  assert.doesNotMatch(html, /lucide-chart-column/)
  assert.match(
    html,
    /<li class="sb-definition-entry">[\s\S]*<button[^>]*class="[^"]*sb-related-name[^>]*title="measure:sales.orders.amount"/,
  )
  assert.equal((html.match(/title="measure:sales.orders.amount"/g) ?? []).length, 1)
  assert.doesNotMatch(html, /<details class="sb-definition-entry"|column\(amount\)|>Amount</)
})

test('formula references use short names while retaining exact identities and unknown text', () => {
  const first: SemanticRef = {
    schema: 'marivo.semantic_ref/v1',
    kind: 'metric',
    path: 'sales.a.total',
  }
  const second: SemanticRef = {
    schema: 'marivo.semantic_ref/v1',
    kind: 'metric',
    path: 'sales.b.total',
  }
  const expression = 'metric:sales.a.total + metric:sales.b.total + metric:sales.a.total_extra'
  const html = renderComputation(expression, [], [first, second], [first])
  assert.match(html, /title="metric:sales.a.total"[^>]*>a.total<\/button>/)
  assert.match(html, /disabled=""[^>]*title="metric:sales.b.total"[^>]*>b.total/)
  assert.match(html, /aria-description="metric:sales.a.total"/)
  assert.match(html, /aria-description="metric:sales.b.total"/)
  assert.match(html, /metric:sales.a.total_extra/)
})

test('source aggregation is hidden only when its single value exactly repeats the formula', () => {
  const reduction = (values: string[]) => [
    { name: 'reductions', value: JSON.stringify(values), structured: true },
  ]
  const single = renderComputation('sum(a)', reduction(['sum(a)']))
  assert.doesNotMatch(single, /源聚合/)
  assert.match(single, /<code>sum\(a\)<\/code>/)
  assert.match(renderComputation('sum(a)', reduction(['sum(b)'])), /源聚合/)
  assert.match(renderComputation('sum(a)', reduction(['sum(a)', 'sum(b)'])), /源聚合/)
})

test('condition and source aggregation link only declared references', () => {
  const measure: SemanticRef = {
    schema: 'marivo.semantic_ref/v1',
    kind: 'measure',
    path: 'sales.orders.amount',
  }
  const html = renderComputation(
    'metric:sales.revenue',
    [
      {
        name: 'conditions',
        value: JSON.stringify(['measure:sales.orders.amount > 0']),
        structured: true,
      },
      {
        name: 'reductions',
        value: JSON.stringify(['sum(measure:sales.orders.amount)']),
        structured: true,
      },
    ],
    [measure],
  )
  assert.match(html, /定义条件/)
  assert.match(html, /源聚合/)
  assert.equal((html.match(/title="measure:sales.orders.amount"/g) ?? []).length, 2)
  assert.match(html, />amount<\/button> &gt; 0/)
  assert.match(html, /sum\(<button[^>]*title="measure:sales.orders.amount"[^>]*>amount<\/button>\)/)
})

test('calculation facts link transitive dependencies without guessing unrelated catalog references', () => {
  const metric: SemanticRef = { ...ref, kind: 'metric', path: 'sales.filtered_revenue' }
  const measure: SemanticRef = { ...ref, kind: 'measure', path: 'sales.orders.amount' }
  const missing: SemanticRef = { ...ref, kind: 'dimension', path: 'sales.orders.valid' }
  const unrelated: SemanticRef = { ...ref, kind: 'measure', path: 'sales.other.amount' }
  const reduction = 'sum(measure:sales.orders.amount)'
  const html = renderComputation(
    'metric:sales.filtered_revenue / count(entity:sales.orders)',
    [
      { name: 'reductions', structured: true, value: JSON.stringify([reduction]) },
      {
        name: 'null_rules',
        structured: true,
        value: JSON.stringify([
          `${reduction}: nulls=ignore: ignore NULL contributions; empty input returns typed zero; nonempty all-NULL input returns NULL`,
          'count(entity:sales.orders): count counts source rows; empty input returns zero',
        ]),
      },
      {
        name: 'conditions',
        structured: true,
        value: JSON.stringify([
          'dimension:sales.orders.valid == True',
          'measure:sales.other.amount > measure:sales.orders.amount_extra',
        ]),
      },
    ],
    [metric, ref],
    [metric, ref, measure, unrelated],
    'zh-CN',
    [
      { ref: metric, dependencies: [measure] },
      { ref: measure, dependencies: [missing, metric] },
    ],
  )
  assert.equal((html.match(/title="measure:sales.orders.amount"/g) ?? []).length, 2)
  assert.match(html, /sum\(<button[^>]*>orders.amount<\/button>\): 计算时忽略 NULL/)
  assert.match(html, /disabled=""[^>]*title="dimension:sales.orders.valid"/)
  assert.match(html, /valid（当前目录未包含）/)
  assert.match(html, /measure:sales.other.amount &gt; measure:sales.orders.amount_extra/)
  assert.doesNotMatch(html, /title="measure:sales.other.amount"/)
})

test('definition conditions remove exact duplicates while preserving distinct text and first-seen order', () => {
  const conditions = ['valid == True', 'amount > 0', 'valid == True', 'amount >= 0', 'amount > 0']
  const html = renderComputation('', [
    { name: 'conditions', structured: true, value: JSON.stringify(conditions) },
  ])
  assert.match(
    html,
    /<ul class="sb-value-list"><li>valid == True<\/li><li>amount &gt; 0<\/li><li>amount &gt;= 0<\/li><\/ul>/,
  )
})

test('time bindings show each distinct effective time dimension once', () => {
  const facts = [
    {
      name: 'time_bindings',
      structured: true,
      value: JSON.stringify([
        { branch: 'sum(a)', field: 'time_dimension:sales.at', source: 'explicit', path: [] },
        { branch: 'sum(a)', field: 'time_dimension:sales.at', source: 'explicit', path: [] },
        { branch: 'sum(b)', field: 'time_dimension:sales.other', source: 'explicit', path: [] },
      ]),
    },
  ]
  const html = renderComputation('sum(a) + sum(b)', facts)
  const summary = html.split('<details>')[0]!
  assert.equal((summary.match(/time_dimension:sales.at/g) ?? []).length, 1)
  assert.match(summary, /time_dimension:sales.other/)
  assert.doesNotMatch(summary, /显式指定/)
  assert.match(html, /显式指定/)
})

test('parameter and absent contribution time bindings remain visible', () => {
  const html = renderComputation('sum(a) + sum(b)', [
    {
      name: 'time_bindings',
      structured: true,
      value: JSON.stringify([
        { branch: 'sum(a)', parameter: 'event', source: 'parameter' },
        { branch: 'sum(b)', source: 'none' },
      ]),
    },
  ])
  assert.match(html, /event/)
  assert.match(html, /时间参数/)
  assert.match(html, /未指定/)
})

test('report-independent time bindings preserve root and reason alongside timed branches', () => {
  const html = renderComputation('sum(a) + sum(b)', [
    {
      name: 'time_bindings',
      structured: true,
      value: JSON.stringify([
        {
          branch: 'sum(a)',
          field: 'time_dimension:sales.at',
          path: [],
          source: 'explicit',
          anchor: null,
        },
        { branch: 'sum(b)', root: 'entity:sales.orders', reason: 'explicit_none', source: 'none' },
      ]),
    },
  ])
  assert.match(html, /time_dimension:sales.at/)
  assert.match(html, /entity:sales.orders/)
  assert.match(html, /explicit_none/)
  assert.match(html, /未指定/)
})

test('different or unknown null rules retain their branches', () => {
  const html = renderComputation('sum(a)', [
    {
      name: 'null_rules',
      structured: true,
      value: JSON.stringify(['sum(a): ignore NULL', 'sum(b): unchanged']),
    },
  ])
  assert.match(html, />sum\(a\): ignore NULL</)
  assert.match(html, />sum\(b\): unchanged</)
  assert.doesNotMatch(html, /查看原始记录/)
})

test('distinct time dimensions retain exact identities and missing dimensions remain disabled', () => {
  const pickup: SemanticRef = {
    schema: 'marivo.semantic_ref/v1',
    kind: 'time_dimension',
    path: 'sales.orders.pickup',
  }
  const delivery: SemanticRef = {
    schema: 'marivo.semantic_ref/v1',
    kind: 'time_dimension',
    path: 'sales.orders.delivery',
  }
  const html = renderComputation(
    'sum(a) + sum(b)',
    [
      {
        name: 'time_bindings',
        structured: true,
        value: JSON.stringify([
          { branch: 'sum(a)', field: 'time_dimension:sales.orders.pickup', path: [] },
          { branch: 'sum(b)', field: 'time_dimension:sales.orders.delivery', path: [] },
        ]),
      },
    ],
    [pickup, delivery],
    [pickup],
  )
  assert.match(html, /title="time_dimension:sales.orders.pickup"[^>]*>pickup<\/button>/)
  assert.match(html, /disabled=""[^>]*title="time_dimension:sales.orders.delivery"/)
  assert.match(html, /delivery（当前目录未包含）/)
})

test('unknown null rules stay readable instead of becoming a guessed policy', () => {
  const html = renderComputation('sum(a)', [
    {
      name: 'null_rules',
      structured: true,
      value: JSON.stringify(['vendor-specific null policy']),
    },
  ])
  assert.match(html, /vendor-specific null policy/)
})

test('different recognized null policies retain the branch associated with each policy', () => {
  const html = renderComputation('sum(a) + sum(b)', [
    { name: 'reductions', structured: true, value: JSON.stringify(['sum(a)', 'sum(b)']) },
    {
      name: 'null_rules',
      structured: true,
      value: JSON.stringify([
        'sum(a): nulls=ignore: ignore NULL contributions; empty input returns typed zero; nonempty all-NULL input returns NULL',
        'sum(b): nulls=error: assert non-NULL demanded contributions; a demanded NULL raises an error; empty input returns NULL',
      ]),
    },
  ])
  const summary = html.split('<details class="sb-null-rule-branches">')[0]!
  assert.doesNotMatch(summary, /sum\(a\):|sum\(b\):/)
  // Two distinct policies produce two summary entries and two branch entries.
  assert.equal((summary.match(/<li>/g) ?? []).length, 2)
  const branches = html.split('<details class="sb-null-rule-branches">')[1] ?? ''
  assert.equal((branches.match(/<div>/g) ?? []).length, 2)
  assert.match(branches, /sum\(a\)/)
})

test('known null-rule suffixes remain concise when a reduction branch is absent', () => {
  const html = renderComputation('metric:sales.average', [
    {
      name: 'null_rules',
      structured: true,
      value: JSON.stringify([
        'sum(measure:sales.amount): nulls=ignore: ignore NULL contributions; empty input returns typed zero; nonempty all-NULL input returns NULL',
        'count(entity:sales.orders): count counts source rows; empty input returns zero',
      ]),
    },
  ])
  const summary = html.split('<details class="sb-null-rule-branches">')[0]!
  assert.match(summary, /计算时忽略 NULL/)
  assert.match(summary, /按源记录计数/)
  assert.doesNotMatch(summary, /sum\(measure:|count\(entity:/)
  assert.match(html, /sum\(measure:sales.amount\): 计算时忽略 NULL/)
  assert.match(html, /count\(entity:sales.orders\): 按源记录计数/)
})

test('identical recognized null rules have one concise explanation', () => {
  const html = renderComputation('sum(a) + sum(b)', [
    { name: 'reductions', structured: true, value: JSON.stringify(['sum(a)', 'sum(b)']) },
    {
      name: 'null_rules',
      structured: true,
      value: JSON.stringify([
        'sum(a): nulls=ignore: ignore NULL contributions; empty input returns typed zero; nonempty all-NULL input returns NULL',
        'sum(b): nulls=ignore: ignore NULL contributions; empty input returns typed zero; nonempty all-NULL input returns NULL',
      ]),
    },
  ])
  assert.match(
    html,
    /计算时忽略 NULL；没有符合条件的记录时返回 0；有记录但参与计算的值全部为 NULL 时返回 NULL/,
  )
  assert.equal((html.match(/计算时忽略 NULL/g) ?? []).length, 1)
  assert.doesNotMatch(html, /查看原始记录|sum\(a\): nulls=ignore/)
})

test('distinct NULL policies render distinct explanations in both locales', () => {
  const show = (rule: string, locale: 'zh-CN' | 'en-US' = 'zh-CN') =>
    renderComputation(
      'aggregate',
      [{ name: 'null_rules', structured: true, value: JSON.stringify([`aggregate: ${rule}`]) }],
      [],
      [],
      locale,
    )
  const rules = [
    'nulls=ignore: ignore NULL contributions; empty input returns typed zero; nonempty all-NULL input returns NULL',
    'nulls=ignore: ignore NULL contributions; empty input returns zero; all-NULL input returns zero',
    'count counts source rows; empty input returns zero',
    'nulls=ignore: ignore NULL contributions; no valid pairs or zero paired weight sum returns NULL',
    'nulls=error: assert non-NULL demanded contributions; a demanded NULL raises an error; empty input returns NULL',
  ]
  for (const locale of ['zh-CN', 'en-US'] as const) {
    const rendered = rules.map((rule) => show(rule, locale))
    // Recognized policies are translated, not echoed verbatim.
    for (const html of rendered) assert.doesNotMatch(html, /nulls=(?:ignore|error):/)
    // Every recognized policy keeps its own explanation; none collapses into another.
    assert.equal(new Set(rendered).size, rules.length)
  }
})

test('calculation summary displays declared time and null rules before expanding details', () => {
  const html = renderComputation('sum(a)', [
    {
      name: 'time_bindings',
      structured: true,
      value: JSON.stringify([
        { branch: 'sum(a)', field: 'time_dimension:sales.picked_up_at', source: 'entity_default' },
      ]),
    },
    { name: 'null_rules', structured: true, value: JSON.stringify(['sum(a): ignore NULL']) },
  ])
  assert.match(html, /<span>time_dimension:sales.picked_up_at<\/span>/)
  assert.match(html, /查看时间绑定详情/)
  assert.match(html, /实体默认时间/)
  assert.match(html, /sum\(a\): ignore NULL/)
  assert.doesNotMatch(html, /<details class="sb-fact" open/)
})

test('relationship key pairs retain direction without guessing object links', () => {
  const html = render(
    '[["orders.customer_id","customers.id"]]',
    [],
    [],
    true,
    'keys',
    'relationship',
  )
  assert.match(html, /起始字段<\/dt><dd>orders.customer_id<\/dd>/)
  assert.match(html, /目标字段<\/dt><dd>customers.id<\/dd>/)
  assert.doesNotMatch(html, /<button/)
  assert.equal(render('many_to_one', [], [], false, 'cardinality', 'relationship'), '多对一')
  assert.equal(render('unknown', [], [], false, 'cardinality', 'relationship'), 'unknown')
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('field references preserve mapping labels, repeated refs and exact identities', () => {
  const html = render(
    'buyer: entity:sales.orders\nseller: entity:sales.orders\nentity:sales.orders_archive\nentity:sales.orders.id',
    [ref],
  )
  assert.equal((html.match(/<button/g) ?? []).length, 2)
  assert.match(html, /buyer: <button/)
  assert.match(html, /seller: <button/)
  assert.match(html, /entity:sales.orders_archive\nentity:sales.orders.id$/)
})

test('unavailable references are disabled and untyped text stays text', () => {
  assert.match(render('entity:sales.orders', [ref], []), /disabled=""/)
  assert.match(translator('zh-CN')(render('entity:sales.orders', [ref], [])), /当前目录未包含/)
  assert.equal(render('entity:sales.orders', []), 'entity:sales.orders')
  assert.equal(
    render('<script>entity:sales.orders</script>', []),
    '&lt;script&gt;entity:sales.orders&lt;/script&gt;',
  )
})
