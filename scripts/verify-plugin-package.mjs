import { spawnSync } from 'node:child_process'
import {
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
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageRoot = path.join(root, 'packages/dsh-data-analysis')
const packageJsonPath = path.join(packageRoot, 'package.json')
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const reportKitWheelPath =
  'python/report-kit/dist/dsh_data_analysis_report_kit-3.0.0-py3-none-any.whl'
const reportKitVerifier = path.join(
  packageRoot,
  'python',
  'report-kit',
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

/** @param {string} directory */
function recursivePackageFiles(directory) {
  /** @type {string[]} */
  const result = []
  /** @param {string} current */
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile())
        result.push(path.relative(packageRoot, target).split(path.sep).join('/'))
    }
  }
  visit(directory)
  return result.sort()
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
const pluginVersion = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(sourceManifest.version)
if (pluginVersion === null) fail('plugin version must be valid SemVer without build metadata')
const pluginMajor = Number(pluginVersion[1])
const compatibility = sourceManifest.dshDataAnalysisCompatibility
const compatibilityMajor = /\/v(\d+)$/.exec(compatibility?.schema ?? '')
if (compatibilityMajor === null || Number(compatibilityMajor[1]) !== pluginMajor) {
  fail('package compatibility schema major must equal the plugin SemVer major')
}
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
  if (actual !== range) fail(`${name} installed at ${actual}; compatibility requires ${range}`)
}
for (const name of Object.keys(sourceManifest.peerDependenciesMeta ?? {})) {
  if (name.startsWith('@deepseek-ai/dsh-')) fail(`${name} must not be an optional DSH peer`)
}
const distributionVersion = installedVersion(compatibility.dsh.distribution)
if (distributionVersion !== dshPeerRange) {
  fail(
    `${compatibility.dsh.distribution} installed at ${distributionVersion}; compatibility requires ${dshPeerRange}`,
  )
}
if (
  compatibility.marivo?.packageSpec !==
  `marivo[duckdb,trino,clickhouse]==${compatibility.marivo?.version}`
) {
  fail('Marivo packageSpec and supported version must identify the same exact release')
}
for (const [name, version] of Object.entries(compatibility.contracts ?? {})) {
  const contractMajor = typeof version === 'string' ? /v(\d+)$/.exec(version) : null
  if (contractMajor === null || Number(contractMajor[1]) !== pluginMajor) {
    fail(`project-owned contract ${name} major must equal the plugin SemVer major`)
  }
}

const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'dsh-data-analysis-package-'))
try {
  run(npmExecutable, ['run', 'prepack', '--workspace', '@deepseek-ai/dsh-data-analysis'])
  const packOutput = run(
    npmExecutable,
    [
      'pack',
      '--workspace',
      '@deepseek-ai/dsh-data-analysis',
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
  const skillFiles = recursivePackageFiles(
    path.join(packageRoot, 'skills', 'dsh-data-analysis-report'),
  )
  const expectedSkillFiles = [
    'skills/dsh-data-analysis-report/SKILL.md',
    'skills/dsh-data-analysis-report/assets/marivo-artifact.js',
    'skills/dsh-data-analysis-report/assets/marivo-session-dag.js',
    'skills/dsh-data-analysis-report/assets/report-data.js',
  ]
  if (JSON.stringify(skillFiles) !== JSON.stringify(expectedSkillFiles)) {
    fail('report Skill must contain only its principles, data runtime, and Marivo components')
  }
  const contractFiles = readdirSync(path.join(packageRoot, 'report-contracts'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => `report-contracts/${entry.name}`)
    .sort()
  const expectedContractFiles = [
    'report-contracts/common-v1.schema.json',
    'report-contracts/dataset-v2.schema.json',
    'report-contracts/revalidation-v1.schema.json',
    'report-contracts/session-trace-v2.schema.json',
  ]
  if (JSON.stringify(contractFiles) !== JSON.stringify(expectedContractFiles)) {
    fail('report contracts must contain only the current v2 transport schemas and dependencies')
  }
  const required = [
    'README.md',
    'cordis.patch.yml',
    'lib/index.js',
    'lib/client.js',
    'lib/types/client.d.ts',
    'lib/types/index.d.ts',
    'lib/compatibility.js',
    'lib/types/compatibility.d.ts',
    'lib/evidence/index.js',
    'lib/types/evidence/index.d.ts',
    'lib/bin/environment.js',
    reportKitWheelPath,
    ...contractFiles,
    ...skillFiles,
  ]
  for (const filename of required) {
    if (!paths.has(filename)) fail(`packed plugin is missing ${filename}`)
  }
  for (const filename of paths) {
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
    if (filename.startsWith('report-contracts/fixtures/')) {
      fail(`packed plugin contains report contract fixture ${filename}`)
    }
  }
  const packedSkillFiles = [...paths]
    .filter((filename) => filename.startsWith('skills/dsh-data-analysis-report/'))
    .sort()
  if (JSON.stringify(packedSkillFiles) !== JSON.stringify(skillFiles)) {
    fail('packed report Skill resources differ from the source resource tree')
  }
  const packedContractFiles = [...paths]
    .filter((filename) => filename.startsWith('report-contracts/'))
    .sort()
  if (JSON.stringify(packedContractFiles) !== JSON.stringify(contractFiles)) {
    fail('packed report contracts differ from the required runtime contracts')
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
  const installedPlugin = path.join(nodeModules, '@deepseek-ai/dsh-data-analysis')
  mkdirSync(path.dirname(installedPlugin), { recursive: true })
  renameSync(path.join(extracted, 'package'), installedPlugin)
  run(
    'uv',
    [
      'run',
      '--project',
      path.join(packageRoot, 'python', 'report-kit'),
      '--frozen',
      'python',
      reportKitVerifier,
      path.join(installedPlugin, reportKitWheelPath),
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
    Object.hasOwn(packedManifest.bin ?? {}, 'dsh-data-analysis-report-check')
  ) {
    fail('packed CLI manifest must expose only the supported environment binary')
  }
  const linkedDependencies = new Set([
    ...Object.keys(peerDependencies),
    ...Object.keys(sourceManifest.dependencies ?? {}),
  ])
  for (const packageName of linkedDependencies) linkDependency(nodeModules, packageName)
  const smokeProgram = `
    const root = await import('@deepseek-ai/dsh-data-analysis')
    const compatibility = await import('@deepseek-ai/dsh-data-analysis/compatibility')
    const environment = await import('@deepseek-ai/dsh-data-analysis/environment')
    if (compatibility.PLUGIN_VERSION !== ${JSON.stringify(sourceManifest.version)}) throw new Error('packed plugin semver mismatch')
    if (compatibility.DSH_PEER_RANGE !== ${JSON.stringify(dshPeerRange)}) throw new Error('packed DSH range mismatch')
    if (compatibility.MARIVO_VERSION !== '0.5.3') throw new Error('packed Marivo version mismatch')
    if (compatibility.MARIVO_PACKAGE_SPEC !== 'marivo[duckdb,trino,clickhouse]==0.5.3') throw new Error('packed Marivo package spec mismatch')
    if (environment.SUBPROCESS_POLICY_ID !== 'direct-argv-inherited-env-snapshot-overlay-v2') throw new Error('packed subprocess policy mismatch')
    if (typeof root.apply !== 'function') throw new Error('packed root entry is not loadable')
    for (const removed of ['REPORT_DOCUMENT_VERSION', 'MARIVO_REPORT_RENDER_TOOL_NAME', 'createMarivoReportRenderTool']) {
      if (Object.hasOwn(root, removed)) throw new Error('packed root still exports removed report surface ' + removed)
    }
  `
  run(process.execPath, ['--input-type=module', '--eval', smokeProgram], { cwd: consumer })

  process.stdout.write(
    `verified ${manifest.id}: ${manifest.entryCount} files, ${manifest.unpackedSize} unpacked bytes; ${dshPeers.length} DSH peers at ${dshPeerRange}; Marivo ${compatibility.marivo.version}; packed report data kit and Marivo components passed\n`,
  )
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
