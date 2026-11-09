import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SkillRuntime from '@deepseek-ai/dsh-skill'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { packagedSkillBuild } from '../../src/skill-build.generated.ts'
import {
  type PackagedSkillBuild,
  PackagedSkillBuildError,
  preparePackagedSkillSnapshot,
} from '../../src/skill-build.ts'
import { removeSkillBuildFixture } from './skill-build-fixture.ts'

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

async function buildFor(root: string): Promise<PackagedSkillBuild> {
  const files: { path: string; sha256: string }[] = []
  async function visit(relative: string): Promise<void> {
    const filename = path.join(root, relative)
    if ((await stat(filename)).isDirectory()) {
      for (const name of (await readdir(filename)).sort())
        await visit(relative ? `${relative}/${name}` : name)
    } else files.push({ path: relative, sha256: hash(await readFile(filename)) })
  }
  await visit('')
  return { schema: 'dsh-data-analysis-skills/v1', digest: hash(JSON.stringify(files)), files }
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-skill-build-'))
  const skillsRoot = path.join(root, 'distribution', 'skills')
  const snapshotsRoot = path.join(root, 'snapshots')
  const skill = path.join(skillsRoot, 'test-skill')
  await mkdir(path.join(skill, 'references'), { recursive: true })
  await mkdir(path.join(skill, 'scripts'))
  await writeFile(
    path.join(skill, 'SKILL.md'),
    '---\nname: test-skill\ndescription: Build fixture\n---\nBody A [reference](references/detail.md)\n',
  )
  await writeFile(path.join(skill, 'references/detail.md'), 'Reference A\n')
  await writeFile(path.join(skill, 'scripts/support.py'), 'print("support A")\n')
  t.after(() => removeSkillBuildFixture(root))
  const build = await buildFor(skillsRoot)
  return { root, skillsRoot, snapshotsRoot, skill, build }
}

test('the generated source build includes both Skills, references and every support file', async (t) => {
  const f = await fixture(t)
  const snapshot = await preparePackagedSkillSnapshot(f.snapshotsRoot)
  assert.equal(path.basename(snapshot), packagedSkillBuild.digest)
  assert.ok(
    packagedSkillBuild.files.some((file) => file.path.endsWith('/references/analysis-ui.md')),
  )
  assert.deepEqual(
    [...new Set(packagedSkillBuild.files.map((file) => file.path.split('/')[0]))],
    ['dsh-data-analysis-files', 'dsh-data-analysis-presentation'],
  )
  for (const file of packagedSkillBuild.files)
    assert.equal(hash(await readFile(path.join(snapshot, file.path))), file.sha256)
  if (process.platform !== 'win32') assert.equal((await stat(snapshot)).mode & 0o222, 0)
  assert.equal(
    await preparePackagedSkillSnapshot(f.snapshotsRoot),
    snapshot,
    'the same embedded build reuses the retained snapshot',
  )
})

for (const resource of ['SKILL.md', 'references/detail.md', 'scripts/support.py']) {
  test(`same-version changes to ${resource} fail against the embedded identity`, async (t) => {
    const f = await fixture(t)
    await preparePackagedSkillSnapshot(f.snapshotsRoot, f)
    await writeFile(path.join(f.skill, resource), 'Changed in the same package version\n')
    await assert.rejects(preparePackagedSkillSnapshot(f.snapshotsRoot, f), (error: unknown) => {
      assert.ok(error instanceof PackagedSkillBuildError)
      assert.equal(error.code, 'packaged-skill-build-mismatch')
      assert.match(error.message, new RegExp(resource.replaceAll('.', '\\.')))
      assert.ok(error.message.includes(f.build.digest))
      return true
    })
  })
}

test('a running filesystem provider keeps body and resourceBase on its original build after rebuild', async (t) => {
  const f = await fixture(t)
  const original = await preparePackagedSkillSnapshot(f.snapshotsRoot, f)
  const ctx = new Context()
  const runtime = await ctx.plugin(SkillRuntime)
  const provider = await ctx.plugin(skillFilesystem, {
    providerName: 'immutable-build',
    includeDefaultRoots: false,
    watch: false,
    customSkillDirs: [original],
  })
  t.after(() => runtime.dispose())
  await writeFile(
    path.join(f.skill, 'SKILL.md'),
    '---\nname: test-skill\ndescription: Build fixture\n---\nBody B\n',
  )
  await writeFile(path.join(f.skill, 'references/detail.md'), 'Reference B\n')
  const nextBuild = await buildFor(f.skillsRoot)
  const next = await preparePackagedSkillSnapshot(f.snapshotsRoot, { ...f, build: nextBuild })
  assert.notEqual(next, original)
  const active = await ctx.skills.get('test-skill')
  assert.ok(active)
  assert.ok(active.content.includes('Body A'))
  assert.equal(active.resourceBase?.kind, 'directory')
  if (active.resourceBase?.kind !== 'directory') assert.fail('Missing resourceBase')
  assert.equal(active.resourceBase.path, path.join(original, 'test-skill'))
  assert.equal(
    await readFile(path.join(active.resourceBase.path, 'references/detail.md'), 'utf8'),
    'Reference A\n',
  )
  assert.equal(
    await readFile(path.join(next, 'test-skill/references/detail.md'), 'utf8'),
    'Reference B\n',
  )
  await provider.dispose()
  assert.equal(
    await readFile(path.join(original, 'test-skill/references/detail.md'), 'utf8'),
    'Reference A\n',
  )
})

test('concurrent activations publish one complete snapshot and never replace it', async (t) => {
  const f = await fixture(t)
  const snapshots = await Promise.all([
    preparePackagedSkillSnapshot(f.snapshotsRoot, f),
    preparePackagedSkillSnapshot(f.snapshotsRoot, f),
  ])
  assert.equal(snapshots[0], snapshots[1])
  assert.deepEqual(await readdir(f.snapshotsRoot), [f.build.digest])
  const target = path.join(snapshots[0]!, 'test-skill/references/detail.md')
  await chmod(target, 0o644)
  if (process.platform !== 'win32')
    await assert.rejects(preparePackagedSkillSnapshot(f.snapshotsRoot, f), /is writable/)
  await writeFile(target, 'Corrupted snapshot\n')
  await chmod(target, 0o444)
  await assert.rejects(preparePackagedSkillSnapshot(f.snapshotsRoot, f), PackagedSkillBuildError)
  assert.equal(await readFile(target, 'utf8'), 'Corrupted snapshot\n')
})

test('added, missing and symlinked resources cannot bypass the build manifest', async (t) => {
  const f = await fixture(t)
  const options = { skillsRoot: f.skillsRoot, build: f.build }
  const reference = path.join(f.skill, 'references/detail.md')
  await writeFile(path.join(f.skill, 'extra.md'), 'undeclared support\n')
  await assert.rejects(preparePackagedSkillSnapshot(f.snapshotsRoot, options), /extra\.md/)
  await rm(path.join(f.skill, 'extra.md'))
  await rm(reference)
  await assert.rejects(preparePackagedSkillSnapshot(f.snapshotsRoot, options), /missing resources/)
  const external = path.join(f.root, 'external.md')
  await writeFile(external, 'Reference A\n')
  await symlink(external, reference)
  await assert.rejects(preparePackagedSkillSnapshot(f.snapshotsRoot, options), /not a regular file/)
})
