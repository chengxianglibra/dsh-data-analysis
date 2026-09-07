/** Business fixtures only. The real Agent must create every analysis Artifact and report. */
export type JourneyId = 'multiple-baselines' | 'semantic-gap-reuse' | 'incomplete-evidence'

export interface Journey {
  id: JourneyId
  title: string
  prompts: string[]
  reviewObligations: string[]
}

export const days = ['2026-08-30', '2026-09-05', '2026-09-06'] as const
export const regions = ['North', 'South', 'West'] as const
export const regionalValues = [
  [40, 20, 10],
  [100, 80, 20],
  [50, 50, 50],
] as const

export const journeys: Journey[] = [
  {
    id: 'multiple-baselines',
    title: '独立基线与正负贡献',
    prompts: [
      '请分析当前 Workspace 的 operations.request_count。以 2026-09-06 为当前日，分别与 2026-09-05、2026-08-30 比较，两个基线独立回答。完整覆盖 North、South、West，说明总变化、各区域变化、所有减少项合计和所有增加项抵消了多少；聚焦主要减少区域时也要交代其余区域合计，保留净变化的对账。用三个日期各区域各一条线展示已有日期的请求量，不要补出未提供日期。交付中文报告，包含两组可核对的比较表、正负贡献柱状图、三条区域折线和真实来源，并给出可打开与下载的 HTML。',
    ],
    reviewObligations: [
      '09-06 对 09-05：200 → 150，净变化 -50；North -50、South -30、West +30，减少 80、增加抵消 30。',
      '09-06 对 08-30：70 → 150，净变化 +80；North +10、South +30、West +40。两个基线不得串用。',
      '只展示已提供的三个日期，每条区域折线拥有三个准确的日期和值；不可把区间中未观测日期补为零。',
      '完整列出区域和正负贡献，聚焦子集仍保留其余项及净变化；业务原因只能作为未验证假设。',
    ],
  },
  {
    id: 'semantic-gap-reuse',
    title: '语义缺口交接与持久结果复用',
    prompts: [
      '请比较 2026-09-06 与 2026-09-05 的 operations.request_count，按提交请求的账号拆分，并完整对账到总变化。这里“账号”明确指 requests 物理表 actor 字段的原值，不推断真人、系统账号或实际负责人。如果缺少这个可复用维度，允许在当前隔离 Workspace 中补充最小语义定义并验证，再继续分析。保存可恢复的精确结果身份，先用文字简述结果，这一轮先不要生成报告。',
      '现在把上一轮已保存的按账号比较结果做成中文报告，包含可核对的完整账号表、正负变化柱状图、净变化和其余项对账、真实分析来源，并提供打开和下载 HTML 的入口。复用上一轮的精确 Artifact；这是展示交付，不需要再次观测或重新读取业务源。保留新增语义定义和证据限制的说明。',
    ],
    reviewObligations: [
      '先识别缺少 actor 语义维度，进入 marivo-semantic，元数据只建立物理编码事实，用户本轮定义建立账号含义。',
      'acct_a：170 → 100，-70；acct_b：30 → 50，+20；200 → 150，净 -50，减少 70、抵消 20。',
      '记录第二轮 source 是否来自第一轮精确 Session/Artifact，以及重复 observe 情况，作为复用效率观察项；不能将新结果或摘要冒充原 Artifact。',
      '不得从账号名称推断真人或自动化类型。新增模型应披露，但不能把静态 readiness 说成因果证据。',
    ],
  },
  {
    id: 'incomplete-evidence',
    title: '证据不足时交付有范围的结论',
    prompts: [
      '请判断 operations.request_count 在 2026-09-06 相比 2026-09-05 的变化是否由自动化任务或故障引起，并与 2026-08-30 做同星期比较。当前 Workspace 的数据说明和可用字段是证据边界：请先检查，完整交付现在能支持的区域比较、总变化和正负贡献；缺失的基线或不能成立的原因判断保留为未完成分支，明确还需要什么证据。做成中文报告，至少包含可核对区域表、正负变化柱状图、真实来源与打开/下载 HTML；不要因某个问题未完成而放弃已能回答的部分。',
    ],
    reviewObligations: [
      '09-06 对 09-05：200 → 150，净 -50；North -50、South -30、West +30，减少 80、抵消 30。',
      '08-30 完全未入库，不是业务零值。不能生成一个 baseline=0 的有效同星期增幅。',
      '源没有任务类型、故障记录或联合归因证据。自动化任务、故障均不能被证实或排除。',
      '结论正文也必须受证据约束，不能一面承认缺口、一面宣称“不是故障”或给出自动化根因。',
      '已有日比较继续交付，并说明完成同星期比较和原因判断分别需要的资料。',
    ],
  },
]

export function workspaceFiles(journey: Journey): Record<string, string> {
  const hasMissingDate = journey.id === 'incomplete-evidence'
  return {
    'marivo.toml': `[project]\nname = "${journey.id}"\n`,
    'README.md': [
      '# 请求量验证业务背景',
      '本 Workspace 为隔离的合成业务数据。requests 的每行代表一个请求，request_id 唯一。',
      '`request_day` 是 Asia/Shanghai 的完整业务日，`region` 为请求所属区域。',
      '`actor` 是提交请求账号的原始标识，不包含账号角色、真人身份或实际责任人含义。',
      hasMissingDate
        ? '仅 2026-09-05 和 2026-09-06 已完整入库；2026-08-30 数据未提供，缺失日期绝不表示请求量为零。'
        : '仅 2026-08-30、2026-09-05 和 2026-09-06 三个完整业务日已入库；其他日期未提供，缺失日期不表示零。',
      '源没有任务运行、错误、故障或账号角色资料，不能据此识别自动化任务或判断故障原因。',
      '本次分析、最小语义补充和报告写入均已授权，但只限这个隔离 Workspace。',
      '',
    ].join('\n'),
    'models/datasources/warehouse.py':
      'import marivo.datasource as md\nmd.duckdb(name="warehouse", path="warehouse.duckdb")\n',
    'models/semantic/operations/__init__.py': '',
    'models/semantic/operations/_domain.py':
      'import marivo.semantic as ms\nms.domain(name="operations", owner="isolated validation")\n',
    'models/semantic/operations/requests.py': [
      'import marivo.datasource as md',
      'import marivo.semantic as ms',
      'requests = ms.entity(name="requests", datasource=ms.ref.datasource("warehouse"), source=md.table("requests"), primary_key=["request_id"])',
      'region = ms.dimension_column(name="region", entity=requests, column="region")',
      'request_day = ms.time_dimension_column(name="request_day", entity=requests, column="request_day", granularity="day", is_default=True)',
      'request_count = ms.count(name="request_count", entity=requests)',
      '',
    ].join('\n'),
  }
}

export function seedProgram(journey: Journey): string {
  const counts = days.flatMap((day, dayIndex) =>
    regions.flatMap((region, regionIndex) => {
      if (journey.id === 'incomplete-evidence' && dayIndex === 0) return []
      const total = regionalValues[dayIndex]![regionIndex]!
      const accountA = dayIndex === 1 ? [90, 70, 10][regionIndex]! : Math.floor(total * 0.8)
      const actualA = dayIndex === 2 && regionIndex === 2 ? 20 : accountA
      return [
        [day, region, 'acct_a', actualA],
        [day, region, 'acct_b', total - actualA],
      ]
    }),
  )
  return [
    'import duckdb, json',
    'from datetime import date',
    `counts = json.loads(${JSON.stringify(JSON.stringify(counts))})`,
    'connection = duckdb.connect("warehouse.duckdb")',
    'try:',
    '    connection.execute("CREATE TABLE requests (request_id VARCHAR PRIMARY KEY, request_day DATE, region VARCHAR, actor VARCHAR)")',
    '    rows = []',
    '    for day, region, actor, count in counts:',
    '        rows.extend((f"{day}-{region}-{actor}-{i}", date.fromisoformat(day), region, actor) for i in range(count))',
    '    connection.executemany("INSERT INTO requests VALUES (?, ?, ?, ?)", rows)',
    'finally:',
    '    connection.close()',
    'import marivo.datasource as md, marivo.semantic as ms',
    'md.load()',
    'catalog = ms.load()',
    'entry = catalog.require(ms.ref.metric("operations.request_count"))',
    'report = catalog.readiness(refs=[entry])',
    'report.show()',
    'assert report.analysis_ready_inputs',
  ].join('\n')
}
