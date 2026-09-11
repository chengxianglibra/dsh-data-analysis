/** Plugin-owned copy; keys are stable identifiers, never business labels. */
export const zh = {
  'marivo.credentials.username': '用户名',
  'marivo.credentials.password': '密码',
  'marivo.credentials.access-token': '访问令牌',
  'marivo.credentials.header-credential-value': 'Header 凭证值',
  'marivo.credentials.this-runtime-cannot-fully-edit-this-datasource':
    '当前 Runtime 无法完整编辑该数据源。',
  'marivo.credentials.check-the-format-of-number-boolean-and-json-fields':
    '请检查数字、布尔值或 JSON 字段的格式。',
  'marivo.credentials.value-credential-inputs-have-been-cleared-enter-them-again':
    '{p0} 本次凭证输入已清空，请重新填写后提交。',
  'marivo.credentials.edit-datasource': '编辑数据源',
  'marivo.credentials.add-datasource': '新增数据源',
  'marivo.credentials.loading-datasource-configuration-fields': '正在读取数据源配置字段…',
  'marivo.credentials.engine': '引擎',
  'marivo.credentials.default': '默认',
  'marivo.credentials.connection-credentials': '连接凭证',
  'marivo.credentials.enter-credential-values-directly-for-harness-to-save-references':
    '直接填写凭证值，由 Harness 保存。引用名自动生成，可展开确认或修改。',
  'marivo.credentials.leave-blank-to-keep-the-current-value-a-new':
    '留空沿用；填写新值默认使用新的引用。',
  'marivo.credentials.header-name': 'Header 名称',
  'marivo.credentials.a-reference-is-configured-leave-blank-to-keep-it': '已设置引用，留空沿用。',
  'marivo.credentials.enter-the-value-directly-no-need-to-create-a': '可直接填写，无需先创建凭证。',
  'marivo.credentials.leave-blank-to-keep-enter-a-new-value-to': '留空沿用，填写新值以替换',
  'marivo.credentials.enter-credential-value': '填写凭证值',
  'marivo.credentials.credential-reference-review-or-change': '凭证引用名 · 确认或修改',
  'marivo.credentials.generated-after-entering-a-credential-value': '填写凭证值后自动生成',
  'marivo.credentials.to-reuse-a-saved-credential-enter-its-reference-and':
    '可填写已有引用并将凭证值留空，以复用已保存的凭证。已有凭证的值不会被自动覆盖。',
  'marivo.credentials.restore-automatic-reference': '恢复自动引用名',
  'marivo.credentials.remove-header': '移除 Header',
  'marivo.credentials.add-header-credential': '添加 Header 凭证',
  'marivo.credentials.save-configuration-and-credentials-then-test-the-connection-the':
    '保存配置和凭证后测试连接，成功后助手继续分析。测试失败可修正重试，已保存的内容不会回滚。',
  'marivo.credentials.test-the-connection-again-after-saving-name-and-engine':
    '保存后需要重新测试连接。名称和引擎保持不变。',
  'marivo.credentials.saving-or-validating': '正在保存或验证…',
  'marivo.credentials.save-and-test-then-continue': '保存并测试，成功后继续',
  'marivo.credentials.save-configuration': '保存配置',
  'marivo.credentials.confirm-new-datasource': '确认新增数据源',
  'marivo.credentials.cancel': '取消',
  'marivo.credentials.credential-references-may-contain-only-letters-numbers-and-underscores':
    '凭证引用名只允许字母、数字和下划线，不能以数字开头或使用保留名称。',
  'marivo.credentials.enter-the-header-name-for-this-credential': '请填写凭证对应的 Header 名称。',
  'marivo.credentials.header-names-must-be-unique': 'Header 名称不能重复。',
  'marivo.credentials.the-same-credential-reference-cannot-have-different-values':
    '同一凭证引用不能填写不同的值。',
  'marivo.credentials.global-datasource-name-use-only-letters-numbers-underscores-and':
    '数据源的全局名称，仅允许字母、数字、下划线和连字符。',
  'marivo.credentials.additional-connection-parameters-for-ibis-options-not-listed-in':
    '其他连接参数，适用于表单未列出的 Ibis 选项，使用 JSON 格式填写。',
  'marivo.credentials.duckdb-database-file-path-defaults-to-an-in-memory':
    'DuckDB 数据库文件路径，默认使用内存数据库。',
  'marivo.credentials.sqlite-database-file-path-defaults-to-an-in-memory':
    'SQLite 数据库文件路径，默认使用内存数据库。',
  'marivo.credentials.open-the-duckdb-database-in-read-only-mode': '以只读模式打开 DuckDB 数据库。',
  'marivo.credentials.open-the-sqlite-database-in-query-only-mode':
    '以仅允许查询的模式打开 SQLite 数据库。',
  'marivo.credentials.optional-mapping-from-sqlite-declared-type-names-to-ibis':
    '可选，将 SQLite 声明的类型名称映射为 Ibis 类型字符串。',
  'marivo.credentials.optional-http-s-url-prefix-where-remote-json-requests':
    '可选，指定远程 JSON 请求使用身份认证的 HTTP(S) 地址前缀。',
  'marivo.credentials.credential-reference-for-the-http-bearer-token-within-the':
    '指定地址范围内 HTTP Bearer Token 的凭证引用名。',
  'marivo.credentials.optional-mapping-from-custom-http-header-names-to-credential':
    '可选，将自定义 HTTP Header 名称映射到对应的凭证引用名。',
  'marivo.credentials.trino-coordinator-host-address': 'Trino 协调节点的主机地址。',
  'marivo.credentials.trino-catalog-name-mapped-to-the-ibis-database-parameter':
    'Trino 的 Catalog 名称，连接时映射为 Ibis 的 database 参数。',
  'marivo.credentials.required-credential-reference-for-the-trino-username':
    'Trino 用户名的凭证引用名，必填。',
  'marivo.credentials.trino-port-ibis-defaults-to-8080': 'Trino 连接端口，Ibis 默认使用 8080。',
  'marivo.credentials.optional-default-schema-name': '可选，默认使用的 Schema 名称。',
  'marivo.credentials.optional-client-application-or-request-source-identifier':
    '可选，标识客户端应用或请求来源。',
  'marivo.credentials.optional-database-session-timezone': '可选，数据库会话使用的时区。',
  'marivo.credentials.enter-https-to-enable-tls-encryption': '填写 https 以启用 TLS 加密连接。',
  'marivo.credentials.optional-trino-client-tags-as-a-json-array':
    '可选，Trino 客户端标签，使用 JSON 数组填写。',
  'marivo.credentials.optional-trino-session-properties-as-a-json-object':
    '可选，Trino 会话属性，使用 JSON 对象填写。',
  'marivo.credentials.credential-reference-for-the-trino-token-or-password':
    'Trino 认证令牌或密码的凭证引用名。',
  'marivo.credentials.mysql-server-host-address': 'MySQL 服务器的主机地址。',
  'marivo.credentials.mysql-database-name': 'MySQL 数据库名称。',
  'marivo.credentials.mysql-port-ibis-defaults-to-3306': 'MySQL 连接端口，Ibis 默认使用 3306。',
  'marivo.credentials.optional-setting-for-automatic-transaction-commits':
    '可选，指定是否自动提交事务。',
  'marivo.credentials.credential-reference-for-the-mysql-username': 'MySQL 用户名的凭证引用名。',
  'marivo.credentials.credential-reference-for-the-mysql-password': 'MySQL 密码的凭证引用名。',
  'marivo.credentials.postgresql-server-host-address': 'PostgreSQL 服务器的主机地址。',
  'marivo.credentials.postgresql-database-name': 'PostgreSQL 数据库名称。',
  'marivo.credentials.postgresql-port-ibis-defaults-to-5432':
    'PostgreSQL 连接端口，Ibis 默认使用 5432。',
  'marivo.credentials.credential-reference-for-the-postgresql-username':
    'PostgreSQL 用户名的凭证引用名。',
  'marivo.credentials.credential-reference-for-the-postgresql-password':
    'PostgreSQL 密码的凭证引用名。',
  'marivo.credentials.clickhouse-server-host-address': 'ClickHouse 服务器的主机地址。',
  'marivo.credentials.clickhouse-port-native-connections-default-to-9000-secure-connections':
    'ClickHouse 连接端口，原生连接默认 9000，安全连接默认 9440。',
  'marivo.credentials.clickhouse-database-name-ibis-defaults-to-default':
    'ClickHouse 数据库名称，Ibis 默认使用 default。',
  'marivo.credentials.enable-tls-encryption-for-clickhouse': '为 ClickHouse 启用 TLS 加密连接。',
  'marivo.credentials.optional-clickhouse-settings-as-a-json-object':
    '可选，ClickHouse 设置，使用 JSON 对象填写。',
  'marivo.credentials.credential-reference-for-the-clickhouse-username':
    'ClickHouse 用户名的凭证引用名。',
  'marivo.credentials.credential-reference-for-the-clickhouse-password':
    'ClickHouse 密码的凭证引用名。',
  'marivo.credentials.awaiting-input': '等待填写',
  'marivo.credentials.saving-or-validating-77': '正在保存或验证',
  'marivo.credentials.connection-validation-failed-action-needed': '连接验证失败，等待处理',
  'marivo.credentials.validated-original-call-continues': '验证完成，原调用继续',
  'marivo.credentials.handed-to-the-assistant-for-investigation': '已交给助手排查',
  'marivo.credentials.original-call-ended': '原调用已结束',
  'marivo.credentials.configuration-request-cancelled': '已取消配置请求',
  'marivo.credentials.context-changed': '上下文已变化',
  'marivo.credentials.configuration-changed-test-again': '配置已变化，请重新测试',
  'marivo.credentials.connection-test-succeeded': '连接测试成功',
  'marivo.credentials.connection-test-failed': '连接测试失败',
  'marivo.credentials.show-error-code': '查看错误代码',
  'marivo.credentials.datasource-value-was-deleted': '已删除数据源 {p0}。',
  'marivo.credentials.deletion-of-datasource-value-is-unconfirmed-refresh-the-list':
    '数据源 {p0} 的删除未确认，请刷新列表检查。',
  'marivo.credentials.associated-saved-credentials-were-retained': '对应的已保存凭证已保留。',
  'marivo.credentials.deleted-credentials': '已删除凭证：',
  'marivo.credentials.credentials-that-could-not-be-deleted': '未能删除的凭证：',
  'marivo.credentials.operation-cancelled-completed-deletions-remain-other-credentials-may-still':
    '操作已取消；已完成的删除不会撤销，其余凭证可能仍保留。',
  'marivo.credentials.this-operation-was-cancelled': '本次操作已取消。',
  'marivo.credentials.saved-value-deleted-configuration-status-updated':
    '已删除保存值，当前配置状态已更新。',
  'marivo.credentials.operation-incomplete-please-retry': '操作未完成，请重试。',
  'marivo.credentials.saved': '已保存：',
  'marivo.credentials.datasource-properties': '数据源属性',
  'marivo.credentials.not-provided': '未提供',
  'marivo.credentials.value-configuration-value': '{p0} 配置值',
  'marivo.credentials.value-credential-configuration': '{p0} 凭证配置',
  'marivo.credentials.datasource-configuration': '数据源配置',
  'marivo.credentials.no-credentials-required': '无需凭证',
  'marivo.credentials.all-credentials-configured': '凭证已配齐',
  'marivo.credentials.value-value-configured': '{p0} / {p1} 项已配置',
  'marivo.credentials.edit-configuration': '编辑配置',
  'marivo.credentials.delete-datasource': '删除数据源',
  'marivo.credentials.confirm-datasource-deletion': '确认删除数据源',
  'marivo.credentials.this-removes-the-datasource-definition-from-this-workspace-not':
    '？这会移除当前 Workspace 的数据源定义，不会删除数据库中的数据；引用它的语义层定义需另行处理。',
  'marivo.credentials.also-delete-associated-saved-credentials': '同时删除对应的已保存凭证',
  'marivo.credentials.credential-references': '凭证引用：',
  'marivo.credentials.other-datasources-or-workspaces-may-share-these-credentials-and':
    '。这些凭证可能被其他数据源或 Workspace 共用，删除后也会影响它们。只读来源的凭证需在原来源处理。',
  'marivo.credentials.continue-the-current-task-after-successful-validation':
    '验证成功后继续当前任务。',
  'marivo.credentials.start-the-task-again': '请重新发起任务。',
  'marivo.credentials.credentials': '凭证',
  'marivo.credentials.this-datasource-has-no-credential-references-you-can-test':
    '该数据源没有凭证引用，可直接测试连接。',
  'marivo.credentials.field': '字段：',
  'marivo.credentials.source': '· 来源：',
  'marivo.credentials.none': '无',
  'marivo.credentials.read-only-source': ' · 来源只读',
  'marivo.credentials.configured': '已配置',
  'marivo.credentials.not-configured': '未配置',
  'marivo.credentials.replace': '更换',
  'marivo.credentials.cancel-replacement': '取消更换',
  'marivo.credentials.delete-saved-value': '删除已保存值',
  'marivo.credentials.new-value': '新值',
  'marivo.credentials.enter-credential-value-127': '输入凭证值',
  'marivo.credentials.confirm-replacement': '确认更换',
  'marivo.credentials.add-credential': '新增凭证',
  'marivo.credentials.and': '与',
  'marivo.credentials.share-this-reference': '共享此引用',
  'marivo.credentials.confirm-deletion-of': '确认删除',
  'marivo.credentials.the-saved-value': '的已保存值？',
  'marivo.credentials.confirm-saved-value-deletion': '确认删除已保存值',
  'marivo.credentials.keep': '保留',
  'marivo.credentials.connection-status': '连接状态',
  'marivo.credentials.last-test': '上次测试：',
  'marivo.credentials.test-connection': '测试连接',
  'marivo.credentials.connection-has-not-been-tested': '尚未测试连接。',
  'marivo.credentials.submit-credentials-and-continue': '提交凭证并继续',
  'marivo.credentials.validate-existing-configuration-and-continue': '使用已有配置验证并继续',
  'marivo.credentials.ask-the-assistant-to-investigate': '交给助手排查',
  'marivo.credentials.cancel-this-round': '取消本轮',
  'marivo.credentials.cancel-operation': '取消操作',
  'marivo.credentials.back-to-datasource-management': '返回数据源管理',
  'marivo.credentials.datasources-and-credentials': '数据源与凭证',
  'marivo.credentials.refresh-datasources': '刷新数据源',
  'marivo.credentials.requests-in-this-session': '本会话待办',
  'marivo.credentials.configuration-result': '配置结果',
  'marivo.credentials.datasource-management': '数据源管理',
  'marivo.credentials.datasource-navigation': '数据源导航',
  'marivo.credentials.requested-datasource': '请求的数据源',
  'marivo.credentials.datasource-value': '数据源 · {p0}',
  'marivo.credentials.select-datasource-value': '选择数据源 {p0}',
  'marivo.credentials.processing': '正在处理…',
  'marivo.credentials.dismiss-deletion-result': '关闭删除结果',
  'marivo.credentials.loading-datasources-and-credential-status': '正在读取数据源与凭证状态…',
  'marivo.credentials.this-session-is-not-bound-to-a-workspace': '当前会话未绑定 Workspace',
  'marivo.credentials.no-datasources': '暂无数据源',
  'marivo.credentials.select-a-datasource': '选择一个数据源',
  'marivo.credentials.return-to-the-session-and-retry': '请返回会话后重试。',
  'marivo.credentials.this-workspace-has-no-defined-datasources':
    '该 Workspace 没有已定义的数据源。',
  'marivo.credentials.view-credential-configuration-and-the-latest-connection-test':
    '查看凭证配置与最近一次连接测试。',
  'marivo.credentials.configuration-request': '配置请求',
  'marivo.credentials.configure-a-datasource-to-continue': '配置数据源以继续',
  'marivo.credentials.cancel-configuration-request': '取消配置请求',
  'marivo.credentials.show-assistant-request-details': '查看助手请求说明',
  'marivo.credentials.configuration-method': '配置方式',
  'marivo.credentials.use-an-existing-datasource': '使用已有数据源',
  'marivo.credentials.if-an-existing-connection-can-access-the-target-table':
    '如果已有连接可以访问目标表，选择它并验证即可继续，无需重复创建。',
  'marivo.credentials.select-an-existing-datasource': '选择已有数据源',
  'marivo.credentials.please-select': '请选择',
  'marivo.credentials.no-reusable-datasource-is-available-switch-to-add-datasource':
    '当前没有可复用的数据源，请切换到“新增数据源”。',
  'marivo.credentials.open-configuration-form': '打开配置表单',
  'marivo.credentials.credential-operations-in-progress': '进行中的凭证操作',
  'marivo.credentials.in-progress': '进行中 ·',
  'marivo.credentials.processing-177': '· 处理中',
  'marivo.credentials.deleting': '正在删除',
  'marivo.credentials.saving': '正在保存',
  'marivo.credentials.validating-connection': '正在验证连接',
  'marivo.credentials.cancel-this-operation': '取消此操作',
  'marivo.credentials.awaiting-datasource-configuration': '等待配置数据源',
  'marivo.credentials.awaiting-credentials': '等待配置凭证',
  'marivo.credentials.configuration-needed': '待配置',
  'marivo.credentials.this-runtime-does-not-support-datasource-deletion':
    '当前 Runtime 不支持删除数据源。',
  'marivo.credentials.this-datasource-is-not-a-removable-project-local-definition':
    '该数据源不属于可删除的项目本地定义。',
  'marivo.credentials.datasource-deletion-is-unconfirmed-refresh-the-list-to-check':
    '未能确认数据源删除结果，请刷新列表检查；对应凭证尚未删除。',
  'marivo.credentials.datasource-deleted-but-some-credentials-could-not-be-deleted':
    '数据源已删除，但部分凭证删除失败；请在 Harness 凭证管理中处理保留项。',
  'marivo.credentials.configuration-changed-reopen-the-editor-before-saving':
    '配置已被修改，请重新打开编辑页面后再保存。',
  'marivo.credentials.datasource-name-and-engine-cannot-be-changed': '数据源名称和引擎不能修改。',
  'marivo.credentials.workspace-or-datasource-definition-changed-reload-before-continuing':
    'Workspace 或数据源定义已变化，请重新读取后操作。',
  'marivo.credentials.credential-configuration-changed-reload-before-validating':
    '凭证配置已变化，请重新读取后验证。',
  'marivo.credentials.the-original-call-ended-saved-values-remain-start-the':
    '原调用已结束，已保存的值仍保留；请重新发起任务。',
  'marivo.credentials.some-credentials-are-missing-complete-them-before-validating':
    '凭证尚未配齐，请补填后验证。',
  'marivo.credentials.some-credentials-could-not-be-saved-successfully-saved-entries':
    '部分凭证保存失败；已成功保存的项目保留。',
  'marivo.credentials.this-operation-is-in-progress-wait-for-its-result':
    '该操作正在进行，请等待结果。',
  'marivo.credentials.credential-status-is-temporarily-unavailable-retry-later':
    '暂时无法读取凭证状态，请稍后重试。',
  'marivo.credentials.the-operation-limit-has-been-reached-retry-later':
    '当前操作数量达到上限，请稍后重试。',
  'marivo.credentials.this-datasource-already-exists-choose-another-name':
    '该数据源已存在，请使用其他名称。',
  'marivo.credentials.invalid-datasource-definition-check-the-name-field-types-and':
    '数据源定义无效，请检查名称、字段类型和凭证引用。',
  'marivo.credentials.invalid-credential-reference-in-env-fields-enter-a-reference':
    '凭证引用名称无效。*_env 字段填写引用名（如 MY_DB_PASSWORD），仅可使用字母、数字和下划线，且不能以数字开头；不能使用 MARIVO_、DSH_DATA_ANALYSIS_ 前缀或 Host 保留名称。实际用户名和密码请在创建后的“新增凭证”中填写。',
  'marivo.credentials.this-runtime-does-not-support-datasource-creation':
    '当前 Runtime 不支持新增数据源。',
  'marivo.credentials.invalid-datasourcedefaults-format-use-a-json-mapping-from-engines':
    'datasourceDefaults 配置格式无效，请使用引擎到字段默认值的 JSON 映射。',
  'marivo.credentials.datasourcedefaults-contains-an-engine-unsupported-by-the-current-runtime':
    'datasourceDefaults 包含当前 Runtime 不支持的引擎。',
  'marivo.credentials.datasourcedefaults-contains-a-field-unsupported-by-the-current-runtime':
    'datasourceDefaults 包含当前 Runtime 不支持的字段。',
  'marivo.credentials.datasourcedefaults-field-types-do-not-match-the-current-runtime':
    'datasourceDefaults 中的字段值类型与当前 Runtime 不匹配。',
  'marivo.credentials.datasourcedefaults-does-not-support-credential-reference-fields-use-the':
    'datasourceDefaults 不支持凭据引用字段，请通过现有凭据流程配置。',
  'marivo.credentials.credential-operation-failed-check-the-configuration-and-retry':
    '凭证操作失败，请检查配置后重试。',
  'marivo.credentials.value-if-submission-is-unconfirmed-refresh-the-list-to':
    '{p0} 如提交结果未确认，请刷新列表核对后再操作。',
  'marivo.credentials.value-if-saving-is-unconfirmed-reload-the-configuration-to':
    '{p0} 如保存结果未确认，请重新读取配置核对后再操作；不会自动重发。',
  'marivo.credentials.configuration-saved-but-the-reference-already-exists-existing-credentials':
    '配置已保存，但引用名已存在。未覆盖已有凭证；请在凭证页确认更新，或编辑配置使用新的引用名。',
  'marivo.credentials.cannot-read-credential-status': '无法读取凭证状态。',
  'marivo.credentials.credential-request-connection-interrupted-reconnecting-host-waits-remain-subject':
    '凭证待办连接中断，正在重连；Host 中的等待仍受原调用期限限制。',
  'marivo.credentials.credential-request-notifications-are-unavailable-check-the-host-connection':
    '凭证待办通知不可用，请检查 Host 连接后重新打开会话。',
  'marivo.credentials.submission-response-unconfirmed-checking-operation-status-without-resending-secret':
    '提交响应未确认，正在查询操作状态；不会重新发送秘密值。',
  'marivo.credentials.deletion-status-cannot-be-recovered-some-deletion-may-have':
    '删除状态不可恢复，部分删除可能已发生，请刷新数据源并核对 Harness 凭证状态。',
  'marivo.credentials.operation-status-cannot-be-recovered-saving-may-have-occurred':
    '操作状态不可恢复。保存可能已经发生，请重新读取实际配置后决定下一步。',
  'marivo.credentials.recovering-operation-results-submitted-saves-will-not-be-resent':
    '正在恢复操作结果；已提交的保存不会自动重发。',
  'marivo.credentials.the-call-has-ended': '调用已结束。',
  'marivo.credentials.cancellation-is-unconfirmed-continue-checking-status':
    '无法确认取消结果，请继续查询。',
  'marivo.credentials.cannot-read-report-publishing-credential-status-reopen-the-page':
    '无法读取报告发布凭证状态，请重新打开页面重试。',
  'marivo.credentials.saved-value-deleted-status-refreshed': '已删除保存值，当前状态已刷新。',
  'marivo.credentials.saved-the-next-publication-will-use-the-new-credential':
    '已保存，下次发布使用新凭证。',
  'marivo.credentials.publishing-configuration-changed-refresh-credential-status-and-enter-values':
    '发布配置已变化，请刷新凭证状态后重新填写。',
  'marivo.credentials.credential-operation-unconfirmed-refresh-status-before-retrying-credentials-from':
    '凭证操作未确认，请刷新状态后重试；启动环境提供的凭证需在启动环境中修改。',
  'marivo.credentials.report-publishing-credentials': '报告发布凭证',
  'marivo.credentials.report-publishing-credentials-228': '报告发布凭证 ·',
  'marivo.credentials.credentials-are-shared-by-the-current-harness-across-all':
    '。凭证由当前 Harness 共享，适用于使用此发布目标的所有 Workspace。',
  'marivo.credentials.required': '（必填）',
  'marivo.credentials.status-refreshed': '状态已刷新。',
  'marivo.credentials.refresh-failed-please-retry': '刷新失败，请重试。',
  'marivo.credentials.refresh-credential-status': '刷新凭证状态',
  'marivo.credentials.create-failed': '新增数据源失败。',
  'marivo.credentials.save-failed': '保存配置失败。',
} as const
export const en = {
  'marivo.credentials.username': 'Username',
  'marivo.credentials.password': 'Password',
  'marivo.credentials.access-token': 'Access token',
  'marivo.credentials.header-credential-value': 'Header credential value',
  'marivo.credentials.this-runtime-cannot-fully-edit-this-datasource':
    'This Runtime cannot fully edit this datasource.',
  'marivo.credentials.check-the-format-of-number-boolean-and-json-fields':
    'Check the format of number, boolean and JSON fields.',
  'marivo.credentials.value-credential-inputs-have-been-cleared-enter-them-again':
    '{p0} Credential inputs have been cleared. Enter them again before submitting.',
  'marivo.credentials.edit-datasource': 'Edit datasource',
  'marivo.credentials.add-datasource': 'Add datasource',
  'marivo.credentials.loading-datasource-configuration-fields':
    'Loading datasource configuration fields…',
  'marivo.credentials.engine': 'Engine',
  'marivo.credentials.default': 'Default',
  'marivo.credentials.connection-credentials': 'Connection credentials',
  'marivo.credentials.enter-credential-values-directly-for-harness-to-save-references':
    'Enter credential values directly for Harness to save. References are generated automatically; expand to review or change them.',
  'marivo.credentials.leave-blank-to-keep-the-current-value-a-new':
    'Leave blank to keep the current value. A new value uses a new reference by default.',
  'marivo.credentials.header-name': 'Header name',
  'marivo.credentials.a-reference-is-configured-leave-blank-to-keep-it':
    'A reference is configured. Leave blank to keep it.',
  'marivo.credentials.enter-the-value-directly-no-need-to-create-a':
    'Enter the value directly; no need to create a credential first.',
  'marivo.credentials.leave-blank-to-keep-enter-a-new-value-to':
    'Leave blank to keep; enter a new value to replace',
  'marivo.credentials.enter-credential-value': 'Enter credential value',
  'marivo.credentials.credential-reference-review-or-change':
    'Credential reference · review or change',
  'marivo.credentials.generated-after-entering-a-credential-value':
    'Generated after entering a credential value',
  'marivo.credentials.to-reuse-a-saved-credential-enter-its-reference-and':
    'To reuse a saved credential, enter its reference and leave the value blank. Existing values are never overwritten automatically.',
  'marivo.credentials.restore-automatic-reference': 'Restore automatic reference',
  'marivo.credentials.remove-header': 'Remove Header',
  'marivo.credentials.add-header-credential': 'Add Header credential',
  'marivo.credentials.save-configuration-and-credentials-then-test-the-connection-the':
    'Save configuration and credentials, then test the connection. The assistant continues on success. On failure, correct and retry; saved changes are retained.',
  'marivo.credentials.test-the-connection-again-after-saving-name-and-engine':
    'Test the connection again after saving. Name and engine stay fixed.',
  'marivo.credentials.saving-or-validating': 'Saving or validating…',
  'marivo.credentials.save-and-test-then-continue': 'Save and test, then continue',
  'marivo.credentials.save-configuration': 'Save configuration',
  'marivo.credentials.confirm-new-datasource': 'Confirm new datasource',
  'marivo.credentials.cancel': 'Cancel',
  'marivo.credentials.credential-references-may-contain-only-letters-numbers-and-underscores':
    'Credential references may contain only letters, numbers and underscores, cannot start with a number, and cannot use reserved names.',
  'marivo.credentials.enter-the-header-name-for-this-credential':
    'Enter the Header name for this credential.',
  'marivo.credentials.header-names-must-be-unique': 'Header names must be unique.',
  'marivo.credentials.the-same-credential-reference-cannot-have-different-values':
    'The same credential reference cannot have different values.',
  'marivo.credentials.global-datasource-name-use-only-letters-numbers-underscores-and':
    'Global datasource name. Use only letters, numbers, underscores and hyphens.',
  'marivo.credentials.additional-connection-parameters-for-ibis-options-not-listed-in':
    'Additional connection parameters for Ibis options not listed in the form, as JSON.',
  'marivo.credentials.duckdb-database-file-path-defaults-to-an-in-memory':
    'DuckDB database file path. Defaults to an in-memory database.',
  'marivo.credentials.sqlite-database-file-path-defaults-to-an-in-memory':
    'SQLite database file path. Defaults to an in-memory database.',
  'marivo.credentials.open-the-duckdb-database-in-read-only-mode':
    'Open the DuckDB database in read-only mode.',
  'marivo.credentials.open-the-sqlite-database-in-query-only-mode':
    'Open the SQLite database in query-only mode.',
  'marivo.credentials.optional-mapping-from-sqlite-declared-type-names-to-ibis':
    'Optional mapping from SQLite declared type names to Ibis type strings.',
  'marivo.credentials.optional-http-s-url-prefix-where-remote-json-requests':
    'Optional HTTP(S) URL prefix where remote JSON requests require authentication.',
  'marivo.credentials.credential-reference-for-the-http-bearer-token-within-the':
    'Credential reference for the HTTP Bearer Token within the specified URL scope.',
  'marivo.credentials.optional-mapping-from-custom-http-header-names-to-credential':
    'Optional mapping from custom HTTP Header names to credential references.',
  'marivo.credentials.trino-coordinator-host-address': 'Trino coordinator host address.',
  'marivo.credentials.trino-catalog-name-mapped-to-the-ibis-database-parameter':
    'Trino Catalog name, mapped to the Ibis database parameter.',
  'marivo.credentials.required-credential-reference-for-the-trino-username':
    'Required credential reference for the Trino username.',
  'marivo.credentials.trino-port-ibis-defaults-to-8080': 'Trino port. Ibis defaults to 8080.',
  'marivo.credentials.optional-default-schema-name': 'Optional default Schema name.',
  'marivo.credentials.optional-client-application-or-request-source-identifier':
    'Optional client application or request source identifier.',
  'marivo.credentials.optional-database-session-timezone': 'Optional database session timezone.',
  'marivo.credentials.enter-https-to-enable-tls-encryption':
    'Enter https to enable TLS encryption.',
  'marivo.credentials.optional-trino-client-tags-as-a-json-array':
    'Optional Trino client tags, as a JSON array.',
  'marivo.credentials.optional-trino-session-properties-as-a-json-object':
    'Optional Trino session properties, as a JSON object.',
  'marivo.credentials.credential-reference-for-the-trino-token-or-password':
    'Credential reference for the Trino token or password.',
  'marivo.credentials.mysql-server-host-address': 'MySQL server host address.',
  'marivo.credentials.mysql-database-name': 'MySQL database name.',
  'marivo.credentials.mysql-port-ibis-defaults-to-3306': 'MySQL port. Ibis defaults to 3306.',
  'marivo.credentials.optional-setting-for-automatic-transaction-commits':
    'Optional setting for automatic transaction commits.',
  'marivo.credentials.credential-reference-for-the-mysql-username':
    'Credential reference for the MySQL username.',
  'marivo.credentials.credential-reference-for-the-mysql-password':
    'Credential reference for the MySQL password.',
  'marivo.credentials.postgresql-server-host-address': 'PostgreSQL server host address.',
  'marivo.credentials.postgresql-database-name': 'PostgreSQL database name.',
  'marivo.credentials.postgresql-port-ibis-defaults-to-5432':
    'PostgreSQL port. Ibis defaults to 5432.',
  'marivo.credentials.credential-reference-for-the-postgresql-username':
    'Credential reference for the PostgreSQL username.',
  'marivo.credentials.credential-reference-for-the-postgresql-password':
    'Credential reference for the PostgreSQL password.',
  'marivo.credentials.clickhouse-server-host-address': 'ClickHouse server host address.',
  'marivo.credentials.clickhouse-port-native-connections-default-to-9000-secure-connections':
    'ClickHouse port. Native connections default to 9000; secure connections to 9440.',
  'marivo.credentials.clickhouse-database-name-ibis-defaults-to-default':
    'ClickHouse database name. Ibis defaults to default.',
  'marivo.credentials.enable-tls-encryption-for-clickhouse':
    'Enable TLS encryption for ClickHouse.',
  'marivo.credentials.optional-clickhouse-settings-as-a-json-object':
    'Optional ClickHouse settings, as a JSON object.',
  'marivo.credentials.credential-reference-for-the-clickhouse-username':
    'Credential reference for the ClickHouse username.',
  'marivo.credentials.credential-reference-for-the-clickhouse-password':
    'Credential reference for the ClickHouse password.',
  'marivo.credentials.awaiting-input': 'Awaiting input',
  'marivo.credentials.saving-or-validating-77': 'Saving or validating',
  'marivo.credentials.connection-validation-failed-action-needed':
    'Connection validation failed; action needed',
  'marivo.credentials.validated-original-call-continues': 'Validated; original call continues',
  'marivo.credentials.handed-to-the-assistant-for-investigation':
    'Handed to the assistant for investigation',
  'marivo.credentials.original-call-ended': 'Original call ended',
  'marivo.credentials.configuration-request-cancelled': 'Configuration request cancelled',
  'marivo.credentials.context-changed': 'Context changed',
  'marivo.credentials.configuration-changed-test-again': 'Configuration changed. Test again.',
  'marivo.credentials.connection-test-succeeded': 'Connection test succeeded',
  'marivo.credentials.connection-test-failed': 'Connection test failed',
  'marivo.credentials.show-error-code': 'Show error code',
  'marivo.credentials.datasource-value-was-deleted': 'Datasource {p0} was deleted.',
  'marivo.credentials.deletion-of-datasource-value-is-unconfirmed-refresh-the-list':
    'Deletion of datasource {p0} is unconfirmed. Refresh the list to check.',
  'marivo.credentials.associated-saved-credentials-were-retained':
    'Associated saved credentials were retained.',
  'marivo.credentials.deleted-credentials': 'Deleted credentials:',
  'marivo.credentials.credentials-that-could-not-be-deleted':
    'Credentials that could not be deleted:',
  'marivo.credentials.operation-cancelled-completed-deletions-remain-other-credentials-may-still':
    'Operation cancelled. Completed deletions remain; other credentials may still be saved.',
  'marivo.credentials.this-operation-was-cancelled': 'This operation was cancelled.',
  'marivo.credentials.saved-value-deleted-configuration-status-updated':
    'Saved value deleted; configuration status updated.',
  'marivo.credentials.operation-incomplete-please-retry': 'Operation incomplete. Please retry.',
  'marivo.credentials.saved': 'Saved:',
  'marivo.credentials.datasource-properties': 'Datasource properties',
  'marivo.credentials.not-provided': 'Not provided',
  'marivo.credentials.value-configuration-value': '{p0} configuration value',
  'marivo.credentials.value-credential-configuration': '{p0} credential configuration',
  'marivo.credentials.datasource-configuration': 'Datasource configuration',
  'marivo.credentials.no-credentials-required': 'No credentials required',
  'marivo.credentials.all-credentials-configured': 'All credentials configured',
  'marivo.credentials.value-value-configured': '{p0} / {p1} configured',
  'marivo.credentials.edit-configuration': 'Edit configuration',
  'marivo.credentials.delete-datasource': 'Delete datasource',
  'marivo.credentials.confirm-datasource-deletion': 'Confirm datasource deletion',
  'marivo.credentials.this-removes-the-datasource-definition-from-this-workspace-not':
    '? This removes the datasource definition from this Workspace, not database data. Update any semantic definitions that reference it separately.',
  'marivo.credentials.also-delete-associated-saved-credentials':
    'Also delete associated saved credentials',
  'marivo.credentials.credential-references': 'Credential references:',
  'marivo.credentials.other-datasources-or-workspaces-may-share-these-credentials-and':
    '. Other datasources or Workspaces may share these credentials and will also be affected. Manage read-only credentials at their original source.',
  'marivo.credentials.continue-the-current-task-after-successful-validation':
    'Continue the current task after successful validation.',
  'marivo.credentials.start-the-task-again': 'Start the task again.',
  'marivo.credentials.credentials': 'Credentials',
  'marivo.credentials.this-datasource-has-no-credential-references-you-can-test':
    'This datasource has no credential references. You can test the connection directly.',
  'marivo.credentials.field': 'Field:',
  'marivo.credentials.source': '· Source:',
  'marivo.credentials.none': 'None',
  'marivo.credentials.read-only-source': ' · Read-only source',
  'marivo.credentials.configured': 'Configured',
  'marivo.credentials.not-configured': 'Not configured',
  'marivo.credentials.replace': 'Replace',
  'marivo.credentials.cancel-replacement': 'Cancel replacement',
  'marivo.credentials.delete-saved-value': 'Delete saved value',
  'marivo.credentials.new-value': 'New value',
  'marivo.credentials.enter-credential-value-127': 'Enter credential value',
  'marivo.credentials.confirm-replacement': 'Confirm replacement',
  'marivo.credentials.add-credential': 'Add credential',
  'marivo.credentials.and': 'and',
  'marivo.credentials.share-this-reference': 'share this reference',
  'marivo.credentials.confirm-deletion-of': 'Confirm deletion of',
  'marivo.credentials.the-saved-value': 'the saved value?',
  'marivo.credentials.confirm-saved-value-deletion': 'Confirm saved value deletion',
  'marivo.credentials.keep': 'Keep',
  'marivo.credentials.connection-status': 'Connection status',
  'marivo.credentials.last-test': 'Last test:',
  'marivo.credentials.test-connection': 'Test connection',
  'marivo.credentials.connection-has-not-been-tested': 'Connection has not been tested.',
  'marivo.credentials.submit-credentials-and-continue': 'Submit credentials and continue',
  'marivo.credentials.validate-existing-configuration-and-continue':
    'Validate existing configuration and continue',
  'marivo.credentials.ask-the-assistant-to-investigate': 'Ask the assistant to investigate',
  'marivo.credentials.cancel-this-round': 'Cancel this round',
  'marivo.credentials.cancel-operation': 'Cancel operation',
  'marivo.credentials.back-to-datasource-management': 'Back to datasource management',
  'marivo.credentials.datasources-and-credentials': 'Datasources and credentials',
  'marivo.credentials.refresh-datasources': 'Refresh datasources',
  'marivo.credentials.requests-in-this-session': 'Requests in this session',
  'marivo.credentials.configuration-result': 'Configuration result',
  'marivo.credentials.datasource-management': 'Datasource management',
  'marivo.credentials.datasource-navigation': 'Datasource navigation',
  'marivo.credentials.requested-datasource': 'Requested datasource',
  'marivo.credentials.datasource-value': 'Datasource · {p0}',
  'marivo.credentials.select-datasource-value': 'Select datasource {p0}',
  'marivo.credentials.processing': 'Processing…',
  'marivo.credentials.dismiss-deletion-result': 'Dismiss deletion result',
  'marivo.credentials.loading-datasources-and-credential-status':
    'Loading datasources and credential status…',
  'marivo.credentials.this-session-is-not-bound-to-a-workspace':
    'This session is not bound to a Workspace',
  'marivo.credentials.no-datasources': 'No datasources',
  'marivo.credentials.select-a-datasource': 'Select a datasource',
  'marivo.credentials.return-to-the-session-and-retry': 'Return to the session and retry.',
  'marivo.credentials.this-workspace-has-no-defined-datasources':
    'This Workspace has no defined datasources.',
  'marivo.credentials.view-credential-configuration-and-the-latest-connection-test':
    'View credential configuration and the latest connection test.',
  'marivo.credentials.configuration-request': 'Configuration request',
  'marivo.credentials.configure-a-datasource-to-continue': 'Configure a datasource to continue',
  'marivo.credentials.cancel-configuration-request': 'Cancel configuration request',
  'marivo.credentials.show-assistant-request-details': 'Show assistant request details',
  'marivo.credentials.configuration-method': 'Configuration method',
  'marivo.credentials.use-an-existing-datasource': 'Use an existing datasource',
  'marivo.credentials.if-an-existing-connection-can-access-the-target-table':
    'If an existing connection can access the target table, select and validate it to continue without creating another.',
  'marivo.credentials.select-an-existing-datasource': 'Select an existing datasource',
  'marivo.credentials.please-select': 'Please select',
  'marivo.credentials.no-reusable-datasource-is-available-switch-to-add-datasource':
    'No reusable datasource is available. Switch to Add datasource.',
  'marivo.credentials.open-configuration-form': 'Open configuration form',
  'marivo.credentials.credential-operations-in-progress': 'Credential operations in progress',
  'marivo.credentials.in-progress': 'In progress ·',
  'marivo.credentials.processing-177': '· Processing',
  'marivo.credentials.deleting': 'Deleting',
  'marivo.credentials.saving': 'Saving',
  'marivo.credentials.validating-connection': 'Validating connection',
  'marivo.credentials.cancel-this-operation': 'Cancel this operation',
  'marivo.credentials.awaiting-datasource-configuration': 'Awaiting datasource configuration',
  'marivo.credentials.awaiting-credentials': 'Awaiting credentials',
  'marivo.credentials.configuration-needed': 'Configuration needed',
  'marivo.credentials.this-runtime-does-not-support-datasource-deletion':
    'This Runtime does not support datasource deletion.',
  'marivo.credentials.this-datasource-is-not-a-removable-project-local-definition':
    'This datasource is not a removable project-local definition.',
  'marivo.credentials.datasource-deletion-is-unconfirmed-refresh-the-list-to-check':
    'Datasource deletion is unconfirmed. Refresh the list to check; associated credentials have not been deleted.',
  'marivo.credentials.datasource-deleted-but-some-credentials-could-not-be-deleted':
    'Datasource deleted, but some credentials could not be deleted. Manage retained entries in Harness credentials.',
  'marivo.credentials.configuration-changed-reopen-the-editor-before-saving':
    'Configuration changed. Reopen the editor before saving.',
  'marivo.credentials.datasource-name-and-engine-cannot-be-changed':
    'Datasource name and engine cannot be changed.',
  'marivo.credentials.workspace-or-datasource-definition-changed-reload-before-continuing':
    'Workspace or datasource definition changed. Reload before continuing.',
  'marivo.credentials.credential-configuration-changed-reload-before-validating':
    'Credential configuration changed. Reload before validating.',
  'marivo.credentials.the-original-call-ended-saved-values-remain-start-the':
    'The original call ended. Saved values remain; start the task again.',
  'marivo.credentials.some-credentials-are-missing-complete-them-before-validating':
    'Some credentials are missing. Complete them before validating.',
  'marivo.credentials.some-credentials-could-not-be-saved-successfully-saved-entries':
    'Some credentials could not be saved. Successfully saved entries remain.',
  'marivo.credentials.this-operation-is-in-progress-wait-for-its-result':
    'This operation is in progress. Wait for its result.',
  'marivo.credentials.credential-status-is-temporarily-unavailable-retry-later':
    'Credential status is temporarily unavailable. Retry later.',
  'marivo.credentials.the-operation-limit-has-been-reached-retry-later':
    'The operation limit has been reached. Retry later.',
  'marivo.credentials.this-datasource-already-exists-choose-another-name':
    'This datasource already exists. Choose another name.',
  'marivo.credentials.invalid-datasource-definition-check-the-name-field-types-and':
    'Invalid datasource definition. Check the name, field types and credential references.',
  'marivo.credentials.invalid-credential-reference-in-env-fields-enter-a-reference':
    'Invalid credential reference. In *_env fields, enter a reference such as MY_DB_PASSWORD using letters, numbers and underscores, without a leading number, MARIVO_ or DSH_DATA_ANALYSIS_ prefix, or Host reserved name. Enter actual usernames and passwords through Add credential after creation.',
  'marivo.credentials.this-runtime-does-not-support-datasource-creation':
    'This Runtime does not support datasource creation.',
  'marivo.credentials.invalid-datasourcedefaults-format-use-a-json-mapping-from-engines':
    'Invalid datasourceDefaults format. Use a JSON mapping from engines to field defaults.',
  'marivo.credentials.datasourcedefaults-contains-an-engine-unsupported-by-the-current-runtime':
    'datasourceDefaults contains an engine unsupported by the current Runtime.',
  'marivo.credentials.datasourcedefaults-contains-a-field-unsupported-by-the-current-runtime':
    'datasourceDefaults contains a field unsupported by the current Runtime.',
  'marivo.credentials.datasourcedefaults-field-types-do-not-match-the-current-runtime':
    'datasourceDefaults field types do not match the current Runtime.',
  'marivo.credentials.datasourcedefaults-does-not-support-credential-reference-fields-use-the':
    'datasourceDefaults does not support credential reference fields. Use the credential workflow.',
  'marivo.credentials.credential-operation-failed-check-the-configuration-and-retry':
    'Credential operation failed. Check the configuration and retry.',
  'marivo.credentials.value-if-submission-is-unconfirmed-refresh-the-list-to':
    '{p0} If submission is unconfirmed, refresh the list to verify before continuing.',
  'marivo.credentials.value-if-saving-is-unconfirmed-reload-the-configuration-to':
    '{p0} If saving is unconfirmed, reload the configuration to verify before continuing. It will not be resent automatically.',
  'marivo.credentials.configuration-saved-but-the-reference-already-exists-existing-credentials':
    'Configuration saved, but the reference already exists. Existing credentials were retained. Confirm replacement on the credentials page or use a new reference.',
  'marivo.credentials.cannot-read-credential-status': 'Cannot read credential status.',
  'marivo.credentials.credential-request-connection-interrupted-reconnecting-host-waits-remain-subject':
    'Credential request connection interrupted; reconnecting. Host waits remain subject to the original call deadline.',
  'marivo.credentials.credential-request-notifications-are-unavailable-check-the-host-connection':
    'Credential request notifications are unavailable. Check the Host connection and reopen the session.',
  'marivo.credentials.submission-response-unconfirmed-checking-operation-status-without-resending-secret':
    'Submission response unconfirmed. Checking operation status without resending secret values.',
  'marivo.credentials.deletion-status-cannot-be-recovered-some-deletion-may-have':
    'Deletion status cannot be recovered. Some deletion may have occurred. Refresh datasources and check Harness credential status.',
  'marivo.credentials.operation-status-cannot-be-recovered-saving-may-have-occurred':
    'Operation status cannot be recovered. Saving may have occurred. Reload the actual configuration before choosing the next step.',
  'marivo.credentials.recovering-operation-results-submitted-saves-will-not-be-resent':
    'Recovering operation results. Submitted saves will not be resent automatically.',
  'marivo.credentials.the-call-has-ended': 'The call has ended.',
  'marivo.credentials.cancellation-is-unconfirmed-continue-checking-status':
    'Cancellation is unconfirmed. Continue checking status.',
  'marivo.credentials.cannot-read-report-publishing-credential-status-reopen-the-page':
    'Cannot read report publishing credential status. Reopen the page and retry.',
  'marivo.credentials.saved-value-deleted-status-refreshed':
    'Saved value deleted; status refreshed.',
  'marivo.credentials.saved-the-next-publication-will-use-the-new-credential':
    'Saved. The next publication will use the new credential.',
  'marivo.credentials.publishing-configuration-changed-refresh-credential-status-and-enter-values':
    'Publishing configuration changed. Refresh credential status and enter values again.',
  'marivo.credentials.credential-operation-unconfirmed-refresh-status-before-retrying-credentials-from':
    'Credential operation unconfirmed. Refresh status before retrying. Credentials from the launch environment must be changed there.',
  'marivo.credentials.report-publishing-credentials': 'Report publishing credentials',
  'marivo.credentials.report-publishing-credentials-228': 'Report publishing credentials ·',
  'marivo.credentials.credentials-are-shared-by-the-current-harness-across-all':
    '. Credentials are shared by the current Harness across all Workspaces using this publishing destination.',
  'marivo.credentials.required': '(required)',
  'marivo.credentials.status-refreshed': 'Status refreshed.',
  'marivo.credentials.refresh-failed-please-retry': 'Refresh failed. Please retry.',
  'marivo.credentials.refresh-credential-status': 'Refresh credential status',
  'marivo.credentials.create-failed': 'Datasource creation failed.',
  'marivo.credentials.save-failed': 'Configuration could not be saved.',
} satisfies Record<keyof typeof zh, string>
