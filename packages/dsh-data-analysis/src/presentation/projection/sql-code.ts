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
        return {"snippets": [], "notices": ["当前 Marivo 未提供读取持久化 SQL 所需的公开 Run 能力。"]}

    pending = [(artifact.ref, artifact)]
    scheduled, runs, seen_queries = {artifact.ref}, {}, set()
    query_count = 0
    for expected_ref, known_artifact in pending:
        try:
            current = known_artifact if known_artifact is not None else session.artifact(expected_ref)
            meta, contract = current.meta, current.contract()
            if current.ref != expected_ref or contract.ref != expected_ref or meta.session_id != session.id or Path(meta.project_root).resolve() != Path.cwd().resolve():
                notice("部分上游 Artifact 的身份或 Workspace 不一致，已拒绝读取其 SQL。")
                continue
            producer = meta.produced_by_job
            if producer is None:
                notice("部分 Artifact 未保存生产 Run 标识，无法读取其生成 SQL。")
                continue
            if not valid_string(producer, 512):
                notice("部分 Artifact 的生产 Run 标识无效，已拒绝读取其 SQL。")
                continue
            run = runs.get(producer)
            if run is None:
                run = get_run(producer)
                runs[producer] = run
            if not isinstance(run, succeeded_run) or run.run_id != producer or run.output_mode != "produced" or run.output_artifact_ref != expected_ref:
                notice("部分生产 Run 的身份、完成状态或产出不匹配，已拒绝读取其 SQL。")
                continue
            for query in run.queries:
                if query_count >= 32:
                    notice("SQL 快照最多读取 32 条查询记录，其余记录未纳入。")
                    break
                query_count += 1
                query_id = query.query_id
                if not valid_string(query_id, 512):
                    notice("部分 SQL 记录的查询标识无效，未纳入代码快照。")
                    continue
                query_key = (producer, query_id)
                if query_key in seen_queries:
                    continue
                seen_queries.add(query_key)
                sql = query.sql
                if not valid_string(sql, 32768) or not sql.strip():
                    notice("部分 SQL 为空、包含不支持的字符或超过 32768 字符，未截断也未纳入快照。")
                    continue
                snippets.append({"language": "sql", "text": sql, "provenance": "execution", "runId": producer, "queryId": query_id, "artifactRef": expected_ref})
            for input_index, input_ref in enumerate(run.input_artifact_refs):
                if input_index >= 65:
                    notice("SQL 追溯最多读取 64 个上游 Artifact，其余来源未纳入。")
                    break
                if not valid_string(input_ref, 512):
                    notice("部分上游 Artifact 标识无效，已停止该分支的 SQL 追溯。")
                    continue
                if input_ref in scheduled:
                    continue
                if len(scheduled) >= 65:
                    notice("SQL 追溯最多读取 64 个上游 Artifact，其余来源未纳入。")
                    break
                scheduled.add(input_ref)
                pending.append((input_ref, None))
        except Exception:
            # A missing record or capability affects code only. Never return exception text.
            notice("部分持久化生产记录无法通过当前 Workspace 的公开 API 读取，SQL 快照可能不完整。")
    if not snippets and not notices:
        notice("该 Artifact 及已读取的上游生产记录未保存 SQL。")
    return {"snippets": snippets, "notices": notices}
`.trim()
