import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertCompatibleVersion, checkPluginDependencies } from './dependency-policy.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageRoot = path.join(root, 'packages/dsh-data-analysis')
const packageJsonPath = path.join(packageRoot, 'package.json')
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const presentationKitWheelPath =
  'python/presentation-kit/dist/dsh_data_analysis_presentation_kit-1.1.0-py3-none-any.whl'
const presentationKitVerifier = path.join(
  packageRoot,
  'python',
  'presentation-kit',
  'scripts',
  'verify_wheel.py',
)

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  throw new Error(message)
}

/** @param {string} filename */
function readJson(filename) {
  return JSON.parse(readFileSync(filename, 'utf8'))
}

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {Omit<import('node:child_process').SpawnSyncOptionsWithStringEncoding, 'encoding'>} [options]
 */
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    ...options,
    encoding: 'utf8',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

/** @param {string} packageName */
function installedVersion(packageName) {
  const manifest = readJson(
    path.join(root, 'node_modules', ...packageName.split('/'), 'package.json'),
  )
  if (typeof manifest.version !== 'string') fail(`${packageName} has no installed version`)
  return manifest.version
}

/**
 * @param {string} nodeModules
 * @param {string} packageName
 */
function linkDependency(nodeModules, packageName) {
  const source = path.join(root, 'node_modules', ...packageName.split('/'))
  const target = path.join(nodeModules, ...packageName.split('/'))
  mkdirSync(path.dirname(target), { recursive: true })
  symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir')
}

const sourceManifest = readJson(packageJsonPath)
checkPluginDependencies(root)
const pluginVersion = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(sourceManifest.version)
if (pluginVersion === null) fail('plugin version must be valid SemVer without build metadata')
const compatibility = sourceManifest.dshDataAnalysisCompatibility
const compatibilityMajor = /\/v(\d+)$/.exec(compatibility?.schema ?? '')
if (compatibilityMajor === null) fail('package compatibility schema must end with a vN identity')
if (compatibility.dsh?.distribution !== '@deepseek-ai/dsh') {
  fail('package compatibility must identify the @deepseek-ai/dsh distribution')
}
const dshPeerRange = compatibility.dsh.peerRange
if (typeof dshPeerRange !== 'string' || dshPeerRange === '' || dshPeerRange.includes('*')) {
  fail('package compatibility must declare one bounded DSH peer range')
}
const peerDependencies = sourceManifest.peerDependencies ?? {}
const dshPeers = Object.entries(peerDependencies).filter(([name]) =>
  name.startsWith('@deepseek-ai/dsh-'),
)
if (dshPeers.length === 0) fail('package must declare required DSH peers')
for (const [name, range] of dshPeers) {
  if (range !== dshPeerRange) {
    fail(`${name} peer range ${range} does not match the declared DSH range ${dshPeerRange}`)
  }
  const actual = installedVersion(name)
  assertCompatibleVersion(name, actual, range)
}
for (const name of Object.keys(sourceManifest.peerDependenciesMeta ?? {})) {
  if (name.startsWith('@deepseek-ai/dsh-')) fail(`${name} must not be an optional DSH peer`)
}
const distributionVersion = installedVersion(compatibility.dsh.distribution)
assertCompatibleVersion(compatibility.dsh.distribution, distributionVersion, dshPeerRange)
if (
  compatibility.marivo?.packageSpec !==
  `marivo[duckdb,trino,clickhouse]==${compatibility.marivo?.version}`
) {
  fail('Marivo packageSpec and supported version must identify the same exact release')
}
for (const [name, version] of Object.entries(compatibility.contracts ?? {})) {
  const contractMajor = typeof version === 'string' ? /v(\d+)$/.exec(version) : null
  if (contractMajor === null) fail(`project-owned contract ${name} must end with a vN identity`)
}

for (const peer of [
  '@deepseek-ai/dsh-client-ui-input-trigger',
  '@deepseek-ai/dsh-storage-domain',
]) {
  if (peerDependencies[peer] !== dshPeerRange) fail(`semantic reference peer missing: ${peer}`)
}
if (!sourceManifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-input-trigger'))
  fail('semantic reference client injection missing')
if (!sourceManifest.dependencies.zod) fail('storage schema requires direct zod dependency')
for (const peer of [
  '@deepseek-ai/dsh-workspace',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-sidebar-right',
]) {
  if (peerDependencies[peer] !== dshPeerRange) fail(`semantic browser peer missing: ${peer}`)
  if (peer !== '@deepseek-ai/dsh-workspace' && !sourceManifest.dsh.client.inject.includes(peer))
    fail(`semantic browser client injection missing: ${peer}`)
}

const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'dsh-data-analysis-package-'))
try {
  run(npmExecutable, ['run', 'prepack', '--workspace', '@chengxianglibra/dsh-data-analysis'])
  const packOutput = run(
    npmExecutable,
    [
      'pack',
      '--workspace',
      '@chengxianglibra/dsh-data-analysis',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temporaryRoot,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  )
  /**
   * @type {Array<{
   *   id: string,
   *   filename: string,
   *   entryCount: number,
   *   unpackedSize: number,
   *   files: Array<{ path: string, mode: number }>
   * }>}
   */
  const manifests = JSON.parse(packOutput)
  const manifest = manifests[0]
  if (manifest === undefined) fail('npm pack returned no manifest')
  const paths = new Set(manifest.files.map((file) => file.path))
  const files = new Map(manifest.files.map((file) => [file.path, file]))
  const unreachableBuildOutputs = [
    'lib/environment/types.js',
    'lib/client/semantic-reference-source.js',
    'lib/types/client/semantic-reference-source.d.ts',
    'lib/types/bin/environment.d.ts',
    'lib/types/bin/presentation-lint.d.ts',
    'lib/types/datasource/bridge-programs.d.ts',
    'lib/types/datasource/credentials.d.ts',
    'lib/types/disclosure/bridge-program.d.ts',
    'lib/types/environment/summary.d.ts',
  ]
  const required = [
    'lib/datasource/service.js',
    'lib/datasource/python.js',
    'lib/datasource/resolver-program.js',
    'lib/datasource/rpc.js',
    'lib/semantic-browser/service.js',
    'lib/semantic-browser/program.js',
    'lib/semantic-browser/contracts.js',
    'README.md',
    'cordis.patch.yml',
    'lib/index.js',
    'lib/client.js',
    'lib/types/client.d.ts',
    'lib/types/index.d.ts',
    'lib/compatibility.js',
    'lib/types/compatibility.d.ts',
    'lib/presentation/index.js',
    'lib/presentation/tool.js',
    'lib/presentation/rpc.js',
    'lib/presentation/receipt.js',
    'lib/semantic-reference/rpc.js',
    'lib/semantic-reference/bridge.js',
    'lib/semantic-reference/contracts.js',
    'lib/semantic-reference/usage.js',
    'lib/types/presentation/index.d.ts',
    'lib/bin/environment.js',
    'lib/bin/presentation-lint.js',
    presentationKitWheelPath,
    'lib/presentation/contracts/index.js',
    'lib/presentation/contracts/types.js',
    'lib/presentation/projection/index.js',
    'lib/presentation/build/index.js',
    'lib/presentation/assets/portable.js',
    'lib/presentation/assets/static.js',
    'lib/types/client/presentation/host-entry.d.ts',
    'skills/dsh-data-analysis-presentation/SKILL.md',
    'skills/dsh-data-analysis-files/SKILL.md',
    'skills/dsh-data-analysis-files/references/examples.md',
  ]
  for (const filename of required) {
    if (!paths.has(filename)) fail(`packed plugin is missing ${filename}`)
  }
  for (const filename of paths) {
    if (filename.startsWith('lib/evidence/') || filename.startsWith('lib/types/evidence/'))
      fail('packed plugin contains removed Evidence protocol ' + filename)
    if (
      (filename.startsWith('skills/') &&
        !filename.startsWith('skills/dsh-data-analysis-presentation/') &&
        !filename.startsWith('skills/dsh-data-analysis-files/')) ||
      filename.startsWith('python/report-kit/')
    )
      fail(`packed plugin contains an unexpected Skill or removed helper ${filename}`)
    if (filename.startsWith('python/') && filename !== presentationKitWheelPath)
      fail(`packed plugin contains an unexpected Python asset ${filename}`)

    if (filename === 'lib/datasource/access.js' || filename === 'lib/types/datasource/access.d.ts')
      fail(`packed plugin contains removed datasource access Tool ${filename}`)
    if (
      filename.startsWith('lib/client/semantic-browser/') ||
      filename.startsWith('lib/client/presentation/') ||
      filename.startsWith('lib/types/client/semantic-browser/')
    )
      fail(`packed plugin contains unreachable browser output ${filename}`)
    if (filename.endsWith('.js.map')) {
      fail(`packed plugin contains source map ${filename}`)
    }
    if (unreachableBuildOutputs.includes(filename)) {
      fail(`packed plugin contains unreachable build output ${filename}`)
    }
    if (/^(?:src|tests|scripts)\//.test(filename) || filename.endsWith('tsconfig.build.json')) {
      fail(`packed plugin contains development-only file ${filename}`)
    }
    if (filename.startsWith('lib/report/') || filename.startsWith('lib/types/report/')) {
      fail(`packed plugin contains removed report surface ${filename}`)
    }
    if (
      filename.startsWith('lib/report-check/') ||
      filename.startsWith('lib/types/report-check/')
    ) {
      fail(`packed plugin contains removed report Checker surface ${filename}`)
    }
    if (filename.startsWith('report-contracts/')) {
      fail(`packed plugin contains development-only report contract ${filename}`)
    }
  }
  const lintBin = files.get('lib/bin/presentation-lint.js')
  if (lintBin === undefined || (lintBin.mode & 0o111) === 0) {
    fail('packed presentation lint CLI is not executable')
  }
  const environmentBin = files.get('lib/bin/environment.js')
  if (environmentBin === undefined || (environmentBin.mode & 0o111) === 0) {
    fail('packed environment CLI is not executable')
  }
  const tarball = path.join(temporaryRoot, manifest.filename)
  const extracted = path.join(temporaryRoot, 'extracted')
  mkdirSync(extracted)
  run('tar', ['-xzf', tarball, '-C', extracted])
  const consumer = path.join(temporaryRoot, 'consumer')
  const nodeModules = path.join(consumer, 'node_modules')
  const installedPlugin = path.join(nodeModules, '@chengxianglibra/dsh-data-analysis')
  mkdirSync(path.dirname(installedPlugin), { recursive: true })
  renameSync(path.join(extracted, 'package'), installedPlugin)
  const lintHelp = run(process.execPath, [
    path.join(installedPlugin, 'lib/bin/presentation-lint.js'),
    '--help',
  ])
  if (!lintHelp.includes('dsh-data-analysis-presentation-lint'))
    fail('packed presentation lint CLI cannot start')
  run(
    'uv',
    [
      'run',
      '--project',
      path.join(packageRoot, 'python', 'presentation-kit'),
      '--frozen',
      'python',
      presentationKitVerifier,
      path.join(installedPlugin, presentationKitWheelPath),
    ],
    { cwd: packageRoot },
  )
  const packedManifest = readJson(path.join(installedPlugin, 'package.json'))
  if (
    JSON.stringify(packedManifest.dshDataAnalysisCompatibility) !== JSON.stringify(compatibility)
  ) {
    fail('packed compatibility manifest differs from the source package contract')
  }
  if (
    packedManifest.bin?.['dsh-data-analysis-env'] !== './lib/bin/environment.js' ||
    packedManifest.bin?.['dsh-data-analysis-presentation-lint'] !==
      './lib/bin/presentation-lint.js' ||
    Object.hasOwn(packedManifest.bin ?? {}, 'dsh-data-analysis-report-check')
  ) {
    fail('packed CLI manifest must expose the supported environment and presentation lint binaries')
  }
  const linkedDependencies = new Set([
    ...Object.keys(peerDependencies),
    ...Object.keys(sourceManifest.dependencies ?? {}),
    // Host registry used by this verification fixture, not a new production dependency.
    '@deepseek-ai/dsh-skill',
  ])
  for (const packageName of linkedDependencies) linkDependency(nodeModules, packageName)
  const smokeProgram = `
    const assert = (await import('node:assert/strict')).default
    const { readFile, stat } = await import('node:fs/promises')
    const path = (await import('node:path')).default
    const { Context } = await import('@deepseek-ai/cordis')
    const { default: SkillRuntime } = await import('@deepseek-ai/dsh-skill')
    const skillFilesystem = await import('@deepseek-ai/dsh-skill-filesystem')
    const skillContext = new Context()
    await skillContext.plugin(SkillRuntime)
    const skillProvider = await skillContext.plugin(skillFilesystem, {
      providerName: 'packed-presentation', includeDefaultRoots: false, watch: false,
      customSkillDirs: [${JSON.stringify(path.join(installedPlugin, 'skills'))}],
    })
    const catalog = await skillContext.skills.snapshot()
    assert.equal(catalog.complete, true)
    assert.deepEqual(catalog.skills.map(skill => skill.name).sort(), ['dsh-data-analysis-files', 'dsh-data-analysis-presentation'])
    const visited = new Set()
    async function checkReferences(filename, basePath) {
      if (visited.has(filename)) return
      visited.add(filename)
      const markdown = await readFile(filename, 'utf8')
      for (const match of markdown.matchAll(/\\[[^\\]]*\\]\\(([^)]+)\\)/g)) {
        if (/^(?:https?:|#)/.test(match[1])) continue
        const target = path.resolve(path.dirname(filename), match[1].split('#')[0])
        assert.ok(target.startsWith(basePath + path.sep), 'Skill reference must remain inside its installed bundle')
        assert.ok((await stat(target)).isFile())
        if (target.endsWith('.md')) await checkReferences(target, basePath)
      }
    }
    for (const name of ['dsh-data-analysis-files', 'dsh-data-analysis-presentation']) {
      const skill = await skillContext.skills.get(name)
      assert.ok(skill?.invocation.modelInvocable)
      assert.equal(skill.resourceBase.kind, 'directory')
      assert.equal(skill.resourceBase.path, path.join(${JSON.stringify(path.join(installedPlugin, 'skills'))}, name))
      await checkReferences(skill.path, skill.resourceBase.path)
    }
    await skillProvider.dispose()
    assert.deepEqual((await skillContext.skills.snapshot()).skills, [])
    const root = await import('@chengxianglibra/dsh-data-analysis')
    const compatibility = await import('@chengxianglibra/dsh-data-analysis/compatibility')
    const environment = await import('@chengxianglibra/dsh-data-analysis/environment')
    const datasource = await import('@chengxianglibra/dsh-data-analysis/datasource')
    const { buildPresentation } = await import(${JSON.stringify(pathToFileURL(path.join(installedPlugin, 'lib/presentation/build/index.js')).href)})
    const presentation = await buildPresentation({
      schemaVersion: 2, workspaceId: 'package-verification', reportId: 'package-verification', buildId: 'package-verification',
      title: '离线展示包检查', generatedAt: '2026-09-07T00:00:00Z',
      datasets: [], sources: [], diagnostics: [],
      blocks: [{ id: 'body', kind: 'markdown', text: '已安装包中的 **共享 reader**。' }],
    })
    if (!Buffer.isBuffer(presentation.htmlBytes) || !Buffer.isBuffer(presentation.documentBytes)) throw new Error('packed presentation builder must return bytes')
    if (!presentation.htmlBytes.toString('utf8').includes('presentation-data')) throw new Error('packed presentation omitted its saved document')
    if (!presentation.htmlBytes.toString('utf8').includes('共享 reader')) throw new Error('packed presentation omitted semantic fallback')
    if (JSON.parse(presentation.documentBytes.toString('utf8')).buildId !== 'package-verification') throw new Error('packed builder changed document identity')
    if (compatibility.PLUGIN_VERSION !== ${JSON.stringify(sourceManifest.version)}) throw new Error('packed plugin semver mismatch')
    if (compatibility.DSH_PEER_RANGE !== ${JSON.stringify(dshPeerRange)}) throw new Error('packed DSH range mismatch')
    if (compatibility.MARIVO_VERSION !== '0.5.5') throw new Error('packed Marivo version mismatch')
    if (compatibility.MARIVO_PACKAGE_SPEC !== 'marivo[duckdb,trino,clickhouse]==0.5.5') throw new Error('packed Marivo package spec mismatch')
    if (environment.SUBPROCESS_POLICY_ID !== 'direct-argv-inherited-env-snapshot-overlay-v2') throw new Error('packed subprocess policy mismatch')
    if (typeof root.apply !== 'function') throw new Error('packed root entry is not loadable')
    for (const removed of ['MARIVO_DATASOURCE_ACCESS_TOOL_NAME', 'createMarivoDatasourceAccessTool', 'registerMarivoDatasourceAccessTool']) {
      if (Object.hasOwn(root, removed) || Object.hasOwn(datasource, removed)) throw new Error('packed plugin still exports removed datasource access surface ' + removed)
    }
    if (typeof datasource.MarivoCredentialService.prototype.prepareExecution !== 'function' || typeof datasource.MarivoCredentialService.prototype.claim === 'function') throw new Error('packed credential service must use execution admission without claim')
    for (const removed of ['REPORT_DOCUMENT_VERSION', 'MARIVO_REPORT_RENDER_TOOL_NAME', 'createMarivoReportRenderTool', 'MARIVO_REPORT_PROMPT', 'MARIVO_EVIDENCE_SOURCES_TOOL_NAME', 'registerMarivoEvidenceSourcesTool', 'MARIVO_EVIDENCE_SOURCES_PROMPT']) {
      if (Object.hasOwn(root, removed)) throw new Error('packed root still exports removed report surface ' + removed)
    }
  `
  run(process.execPath, ['--input-type=module', '--eval', smokeProgram], { cwd: consumer })

  process.stdout.write(
    `verified ${manifest.id}: ${manifest.entryCount} files, ${manifest.unpackedSize} unpacked bytes; ${dshPeers.length} DSH peers at ${dshPeerRange}; Marivo ${compatibility.marivo.version}; packed presentation kit, contracts and offline builder passed\n`,
  )
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
