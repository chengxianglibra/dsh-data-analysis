/** Only persisted public producer records are read; this program never compiles or executes SQL. */
export const MARIVO_PRESENTATION_SQL_CODE_PROGRAM = String.raw`
def sql_code_snapshot(session, artifact):
    snippets, notices = [], []
    def notice(message):
        if message not in notices:
            notices.append(message)
    def valid_string(value, limit):
        return isinstance(value, str) and bool(value) and "\0" not in value and len(value.encode("utf-16-le")) // 2 <= limit

    try:
        succeeded_run = mv.SucceededRun
        get_run = session.get_run
    except Exception:
        return {"snippets": [], "notices": ["marivo.presentation.sql-capability-unavailable"]}

    pending = [(artifact.ref, artifact)]
    scheduled, runs, seen_queries = {artifact.ref}, {}, set()
    query_count = 0
    for expected_ref, known_artifact in pending:
        try:
            current = known_artifact if known_artifact is not None else session.artifact(expected_ref)
            meta, contract = current.meta, current.contract()
            if current.ref != expected_ref or contract.ref != expected_ref or meta.session_id != session.id or Path(meta.project_root).resolve() != Path.cwd().resolve():
                notice("marivo.presentation.sql-artifact-mismatch")
                continue
            producer = meta.produced_by_job
            if producer is None:
                notice("marivo.presentation.sql-producer-missing")
                continue
            if not valid_string(producer, 512):
                notice("marivo.presentation.sql-producer-invalid")
                continue
            run = runs.get(producer)
            if run is None:
                run = get_run(producer)
                runs[producer] = run
            if not isinstance(run, succeeded_run) or run.run_id != producer or run.output_mode != "produced" or run.output_artifact_ref != expected_ref:
                notice("marivo.presentation.sql-run-mismatch")
                continue
            for query in run.queries:
                if query_count >= 32:
                    notice("marivo.presentation.sql-query-limit")
                    break
                query_count += 1
                query_id = query.query_id
                if not valid_string(query_id, 512):
                    notice("marivo.presentation.sql-query-invalid")
                    continue
                query_key = (producer, query_id)
                if query_key in seen_queries:
                    continue
                seen_queries.add(query_key)
                sql = query.sql
                if not valid_string(sql, 32768) or not sql.strip():
                    notice("marivo.presentation.sql-sql-invalid")
                    continue
                snippets.append({"language": "sql", "text": sql, "provenance": "execution", "runId": producer, "queryId": query_id, "artifactRef": expected_ref})
            for input_index, input_ref in enumerate(run.input_artifact_refs):
                if input_index >= 65:
                    notice("marivo.presentation.sql-upstream-limit")
                    break
                if not valid_string(input_ref, 512):
                    notice("marivo.presentation.sql-upstream-invalid")
                    continue
                if input_ref in scheduled:
                    continue
                if len(scheduled) >= 65:
                    notice("marivo.presentation.sql-upstream-limit")
                    break
                scheduled.add(input_ref)
                pending.append((input_ref, None))
        except Exception:
            # A missing record or capability affects code only. Never return exception text.
            notice("marivo.presentation.sql-read-unavailable")
    if not snippets and not notices:
        notice("marivo.presentation.sql-not-saved")
    return {"snippets": snippets, "notices": notices}
`.trim()
