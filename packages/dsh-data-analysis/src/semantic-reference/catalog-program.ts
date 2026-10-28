/** Shared public Catalog traversal. Empty-query browsing never invokes semantic search models. */
export const CATALOG_READ_HELPERS = String.raw`
def pages(fetch):
    cursor, seen, count = None, set(), 0
    while True:
        page = fetch(cursor)
        for entry in page.items:
            count += 1
            if count > 100000:
                raise ValueError("catalog-too-large")
            yield entry
        cursor = page.next_cursor
        if cursor is None:
            break
        if cursor in seen:
            raise ValueError("catalog-cursor-repeated")
        seen.add(cursor)

def wire_ref(entry):
    return {"schema": "marivo.semantic_ref/v1", "kind": entry.kind, "path": entry.path}
`.trim()
