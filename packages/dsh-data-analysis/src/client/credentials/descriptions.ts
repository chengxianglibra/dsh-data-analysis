// Presentation-only translations of public Runtime descriptions, not a field schema.
// Match the complete source text so changed or newly added descriptions retain their meaning.
const descriptions: Record<string, string> = {
  'Global datasource name; letters, digits, underscores, and hyphens only.':
    '数据源的全局名称，仅允许字母、数字、下划线和连字符。',
  'Rare JSON-safe ibis keyword arguments not modeled by the typed class.':
    '其他连接参数，适用于表单未列出的 Ibis 选项，使用 JSON 格式填写。',
  'DuckDB database path; defaults to in-memory.': 'DuckDB 数据库文件路径，默认使用内存数据库。',
  'SQLite database path; defaults to in-memory.': 'SQLite 数据库文件路径，默认使用内存数据库。',
  'Open the DuckDB database in read-only mode.': '以只读模式打开 DuckDB 数据库。',
  'Open the SQLite database in query-only mode.': '以仅允许查询的模式打开 SQLite 数据库。',
  'Optional mapping from declared SQLite type names to Ibis type strings.':
    '可选，将 SQLite 声明的类型名称映射为 Ibis 类型字符串。',
  'Optional HTTP(S) URL prefix for scoped remote JSON auth.':
    '可选，指定远程 JSON 请求使用身份认证的 HTTP(S) 地址前缀。',
  'Environment variable for a scoped HTTP bearer token.':
    '指定地址范围内 HTTP Bearer Token 的凭证引用名。',
  'Optional custom HTTP header names mapped to secret environment variables.':
    '可选，将自定义 HTTP Header 名称映射到对应的凭证引用名。',
  'Trino coordinator host.': 'Trino 协调节点的主机地址。',
  'Trino catalog; mapped to ibis database at connect time.':
    'Trino 的 Catalog 名称，连接时映射为 Ibis 的 database 参数。',
  'Required environment variable for the Trino user.': 'Trino 用户名的凭证引用名，必填。',
  'Trino port; ibis default is 8080.': 'Trino 连接端口，Ibis 默认使用 8080。',
  'Optional default schema.': '可选，默认使用的 Schema 名称。',
  'Optional client application/source tag.': '可选，标识客户端应用或请求来源。',
  'Optional engine session timezone.': '可选，数据库会话使用的时区。',
  "Set to 'https' for TLS.": '填写 https 以启用 TLS 加密连接。',
  'Optional Trino client tags.': '可选，Trino 客户端标签，使用 JSON 数组填写。',
  'Optional Trino session properties.': '可选，Trino 会话属性，使用 JSON 对象填写。',
  'Environment variable for Trino auth token or password.': 'Trino 认证令牌或密码的凭证引用名。',
  'MySQL host.': 'MySQL 服务器的主机地址。',
  'MySQL database name.': 'MySQL 数据库名称。',
  'MySQL port; ibis default is 3306.': 'MySQL 连接端口，Ibis 默认使用 3306。',
  'Optional autocommit override.': '可选，指定是否自动提交事务。',
  'Environment variable for MySQL user.': 'MySQL 用户名的凭证引用名。',
  'Environment variable for MySQL password.': 'MySQL 密码的凭证引用名。',
  'Postgres host.': 'PostgreSQL 服务器的主机地址。',
  'Postgres database name.': 'PostgreSQL 数据库名称。',
  'Postgres port; ibis default is 5432.': 'PostgreSQL 连接端口，Ibis 默认使用 5432。',
  'Environment variable for Postgres user.': 'PostgreSQL 用户名的凭证引用名。',
  'Environment variable for Postgres password.': 'PostgreSQL 密码的凭证引用名。',
  'ClickHouse host.': 'ClickHouse 服务器的主机地址。',
  'ClickHouse port; native default is 9000, secure default is 9440.':
    'ClickHouse 连接端口，原生连接默认 9000，安全连接默认 9440。',
  "ClickHouse database; ibis default is 'default'.":
    'ClickHouse 数据库名称，Ibis 默认使用 default。',
  'Enable TLS for ClickHouse.': '为 ClickHouse 启用 TLS 加密连接。',
  'Optional ClickHouse settings map.': '可选，ClickHouse 设置，使用 JSON 对象填写。',
  'Environment variable for ClickHouse user.': 'ClickHouse 用户名的凭证引用名。',
  'Environment variable for ClickHouse password.': 'ClickHouse 密码的凭证引用名。',
}

export function datasourceDescription(description: string): string {
  return descriptions[description] ?? description
}
