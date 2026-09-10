// Presentation-only translations of public Runtime descriptions, not a field schema.
// Match the complete source text so changed or newly added descriptions retain their meaning.
const descriptions: Record<string, string> = {
  'Global datasource name; letters, digits, underscores, and hyphens only.':
    'marivo.credentials.global-datasource-name-use-only-letters-numbers-underscores-and',
  'Rare JSON-safe ibis keyword arguments not modeled by the typed class.':
    'marivo.credentials.additional-connection-parameters-for-ibis-options-not-listed-in',
  'DuckDB database path; defaults to in-memory.':
    'marivo.credentials.duckdb-database-file-path-defaults-to-an-in-memory',
  'SQLite database path; defaults to in-memory.':
    'marivo.credentials.sqlite-database-file-path-defaults-to-an-in-memory',
  'Open the DuckDB database in read-only mode.':
    'marivo.credentials.open-the-duckdb-database-in-read-only-mode',
  'Open the SQLite database in query-only mode.':
    'marivo.credentials.open-the-sqlite-database-in-query-only-mode',
  'Optional mapping from declared SQLite type names to Ibis type strings.':
    'marivo.credentials.optional-mapping-from-sqlite-declared-type-names-to-ibis',
  'Optional HTTP(S) URL prefix for scoped remote JSON auth.':
    'marivo.credentials.optional-http-s-url-prefix-where-remote-json-requests',
  'Environment variable for a scoped HTTP bearer token.':
    'marivo.credentials.credential-reference-for-the-http-bearer-token-within-the',
  'Optional custom HTTP header names mapped to secret environment variables.':
    'marivo.credentials.optional-mapping-from-custom-http-header-names-to-credential',
  'Trino coordinator host.': 'marivo.credentials.trino-coordinator-host-address',
  'Trino catalog; mapped to ibis database at connect time.':
    'marivo.credentials.trino-catalog-name-mapped-to-the-ibis-database-parameter',
  'Required environment variable for the Trino user.':
    'marivo.credentials.required-credential-reference-for-the-trino-username',
  'Trino port; ibis default is 8080.': 'marivo.credentials.trino-port-ibis-defaults-to-8080',
  'Optional default schema.': 'marivo.credentials.optional-default-schema-name',
  'Optional client application/source tag.':
    'marivo.credentials.optional-client-application-or-request-source-identifier',
  'Optional engine session timezone.': 'marivo.credentials.optional-database-session-timezone',
  "Set to 'https' for TLS.": 'marivo.credentials.enter-https-to-enable-tls-encryption',
  'Optional Trino client tags.': 'marivo.credentials.optional-trino-client-tags-as-a-json-array',
  'Optional Trino session properties.':
    'marivo.credentials.optional-trino-session-properties-as-a-json-object',
  'Environment variable for Trino auth token or password.':
    'marivo.credentials.credential-reference-for-the-trino-token-or-password',
  'MySQL host.': 'marivo.credentials.mysql-server-host-address',
  'MySQL database name.': 'marivo.credentials.mysql-database-name',
  'MySQL port; ibis default is 3306.': 'marivo.credentials.mysql-port-ibis-defaults-to-3306',
  'Optional autocommit override.':
    'marivo.credentials.optional-setting-for-automatic-transaction-commits',
  'Environment variable for MySQL user.':
    'marivo.credentials.credential-reference-for-the-mysql-username',
  'Environment variable for MySQL password.':
    'marivo.credentials.credential-reference-for-the-mysql-password',
  'Postgres host.': 'marivo.credentials.postgresql-server-host-address',
  'Postgres database name.': 'marivo.credentials.postgresql-database-name',
  'Postgres port; ibis default is 5432.':
    'marivo.credentials.postgresql-port-ibis-defaults-to-5432',
  'Environment variable for Postgres user.':
    'marivo.credentials.credential-reference-for-the-postgresql-username',
  'Environment variable for Postgres password.':
    'marivo.credentials.credential-reference-for-the-postgresql-password',
  'ClickHouse host.': 'marivo.credentials.clickhouse-server-host-address',
  'ClickHouse port; native default is 9000, secure default is 9440.':
    'marivo.credentials.clickhouse-port-native-connections-default-to-9000-secure-connections',
  "ClickHouse database; ibis default is 'default'.":
    'marivo.credentials.clickhouse-database-name-ibis-defaults-to-default',
  'Enable TLS for ClickHouse.': 'marivo.credentials.enable-tls-encryption-for-clickhouse',
  'Optional ClickHouse settings map.':
    'marivo.credentials.optional-clickhouse-settings-as-a-json-object',
  'Environment variable for ClickHouse user.':
    'marivo.credentials.credential-reference-for-the-clickhouse-username',
  'Environment variable for ClickHouse password.':
    'marivo.credentials.credential-reference-for-the-clickhouse-password',
}

export function datasourceDescription(description: string): string {
  return descriptions[description] ?? description
}
