/** 0.6 has no public persisted execution-SQL reader. Never inspect private stores or logs. */
export const MARIVO_PRESENTATION_SQL_CODE_PROGRAM = String.raw`
def sql_code_snapshot():
    return {"snippets": [], "notices": ["marivo.presentation.sql-capability-unavailable"]}
`.trim()
