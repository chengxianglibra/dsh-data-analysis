import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertCompatibleVersion, checkPluginDependencies } from './dependency-policy.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageRoot = path.join(root, 'packages/dsh-data-analysis')
const packageJsonPath = path.join(packageRoot, 'package.json')
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const projectionAssets = [
  '__init__.py',
  '_dataset.py',
  '_frame.py',
  'errors.py',
  'read_result.py',
  'result_metadata.py',
].map((name) => `python/presentation/${name}`)
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
  fail('package compatibility must declare one valid DSH peer range')
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
    'lib/client-composition.js',
    'lib/integration.js',
    'lib/types/integration.d.ts',
    'lib/types/client.d.ts',
    'lib/types/index.d.ts',
    'lib/compatibility.js',
    'lib/skill-build.js',
    'lib/skill-build.generated.js',
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
    ...projectionAssets,
    'lib/presentation/contracts/index.js',
    'lib/presentation/contracts/types.js',
    'skills/dsh-data-analysis-presentation/SKILL.md',
    'skills/dsh-data-analysis-files/SKILL.md',
    'skills/dsh-data-analysis-files/references/examples.md',
    'skills/dsh-data-analysis-files/references/delivery.md',
  ]
  for (const filename of required) {
    if (!paths.has(filename)) fail(`packed plugin is missing ${filename}`)
  }
  for (const filename of paths) {
    if (
      filename.startsWith('lib/presentation/projection/') ||
      filename.startsWith('lib/types/presentation/projection/')
    )
      fail('packed plugin contains removed Frame projection ' + filename)
    if (filename.startsWith('lib/evidence/') || filename.startsWith('lib/types/evidence/'))
      fail('packed plugin contains removed Evidence protocol ' + filename)
    if (
      (filename.startsWith('skills/') &&
        !filename.startsWith('skills/dsh-data-analysis-presentation/') &&
        !filename.startsWith('skills/dsh-data-analysis-files/')) ||
      filename.startsWith('python/report-kit/')
    )
      fail(`packed plugin contains an unexpected Skill or removed helper ${filename}`)
    if (filename.startsWith('python/') && !projectionAssets.includes(filename))
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
    if (
      filename.startsWith('lib/report-publishing/') ||
      filename.startsWith('lib/types/report-publishing/') ||
      filename.startsWith('lib/presentation/build/') ||
      filename.startsWith('lib/presentation/assets/') ||
      /^lib\/types\/client\/presentation\/(?:reader|host-entry|portable-entry|chart-[a-z-]+)\.d\.ts$/.test(
        filename,
      ) ||
      filename.includes('presentation-lint') ||
      filename === 'lib/presentation/export-html.js' ||
      filename === 'lib/types/presentation/export-html.d.ts'
    ) {
      fail(`packed plugin contains removed legacy report surface ${filename}`)
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
  const packedManifest = readJson(path.join(installedPlugin, 'package.json'))
  if (
    JSON.stringify(packedManifest.dshDataAnalysisCompatibility) !== JSON.stringify(compatibility)
  ) {
    fail('packed compatibility manifest differs from the source package contract')
  }
  if (
    packedManifest.bin?.['dsh-data-analysis-env'] !== './lib/bin/environment.js' ||
    Object.keys(packedManifest.bin ?? {}).length !== 1
  ) {
    fail('packed CLI manifest must expose only the supported environment binary')
  }
  // A profile does not install Host peers locally. Exercise the packed CLI before
  // linking any dependencies, so this verifies its actual standalone boundary.
  const cli = path.join(installedPlugin, 'lib/bin/environment.js')
  /** @type {NodeJS.ProcessEnv} */
  const cliEnvironment = { ...process.env, DSH_HOME: path.join(temporaryRoot, 'cli-home') }
  for (const name of [
    'DSH_DATA_ANALYSIS_PROJECT_ROOT',
    'DSH_DATA_ANALYSIS_PYTHON',
    'DSH_DATA_ANALYSIS_RUNTIME_ROOT',
    'DSH_DATA_ANALYSIS_BOOTSTRAP_PYTHON',
    'DSH_CWD',
    'NODE_OPTIONS',
    'NODE_PATH',
  ])
    delete cliEnvironment[name]
  const cliHelp = spawnSync(process.execPath, [cli, '--help'], {
    cwd: temporaryRoot,
    env: cliEnvironment,
    encoding: 'utf8',
  })
  if (cliHelp.status !== 0 || !cliHelp.stdout?.includes('Usage: dsh-data-analysis-env')) {
    fail(`packed standalone CLI help failed: ${cliHelp.stderr || cliHelp.error?.message}`)
  }
  const cliError = spawnSync(process.execPath, [cli, '--runtime-root', 'relative'], {
    cwd: temporaryRoot,
    env: cliEnvironment,
    encoding: 'utf8',
  })
  if (
    cliError.status !== 1 ||
    cliError.stdout !== '' ||
    !cliError.stderr?.includes('dsh-data-analysis-env: shared-runtime-config-invalid:')
  ) {
    fail(`packed standalone CLI did not return its stable error: ${cliError.stderr}`)
  }
  // Reach the managed-install bootstrap. Node
  // is deliberately not a Python bootstrap and must produce the install error.
  const cliBootstrapError = spawnSync(
    process.execPath,
    [
      cli,
      '--runtime-root',
      path.join(temporaryRoot, 'cli-runtime'),
      '--bootstrap-python',
      process.execPath,
    ],
    { cwd: temporaryRoot, env: cliEnvironment, encoding: 'utf8' },
  )
  if (
    cliBootstrapError.status !== 1 ||
    !cliBootstrapError.stderr?.includes('dsh-data-analysis-env: shared-runtime-install-failed:')
  ) {
    fail(`packed standalone CLI did not reach Python bootstrap: ${cliBootstrapError.stderr}`)
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
    const { readFile, realpath, stat, writeFile } = await import('node:fs/promises')
    const path = (await import('node:path')).default
    const { Context } = await import('@deepseek-ai/cordis')
    const { default: SkillRuntime } = await import('@deepseek-ai/dsh-skill')
    const skillFilesystem = await import('@deepseek-ai/dsh-skill-filesystem')
    const { preparePackagedSkillSnapshot, PackagedSkillBuildError } = await import(${JSON.stringify(pathToFileURL(path.join(installedPlugin, 'lib/skill-build.js')).href)})
    const { packagedSkillBuild } = await import(${JSON.stringify(pathToFileURL(path.join(installedPlugin, 'lib/skill-build.generated.js')).href)})
    const snapshotsRoot = ${JSON.stringify(path.join(temporaryRoot, 'skill-snapshots'))}
    const snapshot = await preparePackagedSkillSnapshot(snapshotsRoot)
    assert.equal(path.basename(snapshot), packagedSkillBuild.digest)
    assert.deepEqual(packagedSkillBuild.files.map(file => 'skills/' + file.path).sort(), ${JSON.stringify([...paths].filter((filename) => filename.startsWith('skills/')).sort())})
    const skillContext = new Context()
    await skillContext.plugin(SkillRuntime)
    const skillProvider = await skillContext.plugin(skillFilesystem, {
      providerName: 'packed-presentation', includeDefaultRoots: false, watch: false,
      customSkillDirs: [snapshot],
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
        const target = await realpath(path.resolve(path.dirname(filename), match[1].split('#')[0]))
        const base = await realpath(basePath)
        assert.ok(target.startsWith(base + path.sep), 'Skill reference must remain inside its installed bundle')
        assert.ok((await stat(target)).isFile())
        if (target.endsWith('.md')) await checkReferences(target, basePath)
      }
    }
    for (const name of ['dsh-data-analysis-files', 'dsh-data-analysis-presentation']) {
      const skill = await skillContext.skills.get(name)
      assert.ok(skill?.invocation.modelInvocable)
      assert.equal(skill.resourceBase.kind, 'directory')
      assert.equal(skill.resourceBase.path, path.join(snapshot, name))
      await checkReferences(skill.path, skill.resourceBase.path)
    }
    const reference = 'dsh-data-analysis-presentation/references/analysis-ui.md'
    const originalReference = await readFile(path.join(snapshot, reference), 'utf8')
    await writeFile(path.join(${JSON.stringify(path.join(installedPlugin, 'skills'))}, reference), 'same-version changed reference')
    await assert.rejects(preparePackagedSkillSnapshot(snapshotsRoot), PackagedSkillBuildError)
    const retained = await skillContext.skills.get('dsh-data-analysis-presentation')
    assert.equal(await readFile(path.join(retained.resourceBase.path, 'references/analysis-ui.md'), 'utf8'), originalReference)
    await skillProvider.dispose()
    assert.equal(await readFile(path.join(snapshot, reference), 'utf8'), originalReference)
    assert.deepEqual((await skillContext.skills.snapshot()).skills, [])
    const root = await import('@chengxianglibra/dsh-data-analysis')
    assert.equal(Object.hasOwn(root, 'chartSeriesFields'), false, 'obsolete chart helper must not be exported')
    const compatibility = await import('@chengxianglibra/dsh-data-analysis/compatibility')
    const environment = await import('@chengxianglibra/dsh-data-analysis/environment')
    const datasource = await import('@chengxianglibra/dsh-data-analysis/datasource')
    const integration = await import('@chengxianglibra/dsh-data-analysis/integration')
    if (integration.INTEGRATION_CONTRACT_VERSION !== 'dsh-data-analysis-integration/v1' || typeof integration.applyWithIntegration !== 'function') throw new Error('packed integration contract invalid')
    if (typeof integration.withDatasourceDefaults !== 'function') throw new Error('packed live defaults validator unavailable')
    for (const removed of ['buildPresentation', 'parsePresentationDraft', 'parsePresentationDocument', 'lintPresentationDraft', 'registerMarivoExportHtmlTool', 'registerReportPublishTool', 'HostPresentationReader']) {
      if (Object.hasOwn(root, removed)) throw new Error('packed root still exports removed legacy report surface ' + removed)
    }
    if (compatibility.PLUGIN_VERSION !== ${JSON.stringify(sourceManifest.version)}) throw new Error('packed plugin semver mismatch')
    if (compatibility.DSH_PEER_RANGE !== ${JSON.stringify(dshPeerRange)}) throw new Error('packed DSH range mismatch')
    if (compatibility.MARIVO_VERSION !== ${JSON.stringify(compatibility.marivo.version)}) throw new Error('packed Marivo version mismatch')
    if (compatibility.MARIVO_PACKAGE_SPEC !== ${JSON.stringify(compatibility.marivo.packageSpec)}) throw new Error('packed Marivo package spec mismatch')
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
    `verified ${manifest.id}: ${manifest.entryCount} files, ${manifest.unpackedSize} unpacked bytes; ${dshPeers.length} DSH peers at ${dshPeerRange}; Marivo ${compatibility.marivo.version}; private projection and contracts passed\n`,
  )
} finally {
  /** @param {string} directory */
  function unlockFixture(directory) {
    chmodSync(directory, 0o755)
    for (const entry of readdirSync(directory, { withFileTypes: true }))
      if (entry.isDirectory()) unlockFixture(path.join(directory, entry.name))
  }
  // These snapshots belong only to the now-closed packed verification Host.
  unlockFixture(temporaryRoot)
  rmSync(temporaryRoot, { recursive: true, force: true })
}
