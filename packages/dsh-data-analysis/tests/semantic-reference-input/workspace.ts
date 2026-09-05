import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
/** Authored fixture only; adapter/selection must never create these files itself. */
export async function createSemanticWorkspace(
  root: string,
  domain = 'sales',
  count = 105,
): Promise<void> {
  await mkdir(path.join(root, 'models', 'datasources'), { recursive: true })
  await mkdir(path.join(root, 'models', 'semantic', domain), { recursive: true })
  await writeFile(
    path.join(root, 'models', 'datasources', 'warehouse.py'),
    'import marivo.datasource as md\nwarehouse = md.duckdb(name="warehouse", path="warehouse.duckdb")\n',
  )
  await writeFile(
    path.join(root, 'models', 'semantic', domain, '_domain.py'),
    `import marivo.semantic as ms\nms.domain(name="${domain}", owner="Fixture", default=True)\n`,
  )
  const metrics = Array.from(
    { length: count },
    (_, i) =>
      `@ms.metric(entities=[orders], additivity="additive", ai_context=ms.ai_context(business_definition="${i === 0 ? '收入 monthly revenue ' + '😀'.repeat(250) : 'Fixture measure'}"))\ndef ${i === 0 ? 'revenue' : `revenue_${i}`}(table):\n    return table.amount.sum()\n`,
  ).join('\n')
  await writeFile(
    path.join(root, 'models', 'semantic', domain, 'datasets.py'),
    `import marivo.datasource as md\nimport marivo.semantic as ms\norders = ms.entity(name="orders", datasource=ms.ref.datasource("warehouse"), source=md.table("orders"))\n@ms.dimension(entity=orders)\ndef region(table):\n    return table.region\n${metrics}`,
  )
}
