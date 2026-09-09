import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import semver from 'semver'
import ts from 'typescript'

/** @param {string} name @param {string} actual @param {string} range */
export function assertCompatibleVersion(name, actual, range) {
  if (!semver.validRange(range) || !semver.satisfies(actual, range))
    throw new Error(`${name} installed at ${actual}; compatibility requires ${range}`)
}

/** @param {string} name @param {string} pluginPath @param {string} hostPath */
export function assertHostIdentity(name, pluginPath, hostPath) {
  if (pluginPath !== hostPath) throw new Error(`duplicate-host-instance:${name}`)
}

/** @param {string} filename @param {string} specifier @param {string} sourceRoot */
export function assertProductionImport(filename, specifier, sourceRoot) {
  if (/^@deepseek-ai\/dsh-session-persistence(?:[/-]|$)/.test(specifier))
    throw new Error(`validation-only-import:${filename}:${specifier}`)
  if (/^(?:file:|link:|workspace:|\/|[A-Za-z]:[\\/])/.test(specifier))
    throw new Error(`local-host-import:${filename}:${specifier}`)
  if (specifier.startsWith('.')) {
    const target = path.resolve(path.dirname(filename), specifier)
    const relative = path.relative(sourceRoot, target)
    if (relative === '..' || relative.startsWith(`..${path.sep}`))
      throw new Error(`production-import-outside-src:${filename}:${specifier}`)
  }
}

/** @param {string} sourceRoot */
export function checkProductionSource(sourceRoot) {
  sourceRoot = realpathSync(sourceRoot)
  /** @param {string} directory */
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(filename)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      const source = ts.createSourceFile(
        filename,
        readFileSync(filename, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      )
      /** @param {ts.Node} node */
      function inspect(node) {
        const specifier =
          ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
            ? node.moduleSpecifier
            : ts.isCallExpression(node) &&
                (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                  (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
              ? node.arguments[0]
              : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
                ? node.argument.literal
                : undefined
        if (specifier && ts.isStringLiteral(specifier)) {
          assertProductionImport(filename, specifier.text, sourceRoot)
          if (specifier.text.startsWith('.')) {
            const actual = realpathSync(path.resolve(path.dirname(filename), specifier.text))
            assertProductionImport(
              filename,
              `./${path.relative(path.dirname(filename), actual)}`,
              sourceRoot,
            )
          }
        }
        ts.forEachChild(node, inspect)
      }
      inspect(source)
    }
  }
  visit(sourceRoot)
}

/** Checks this plugin's peers, not every unrelated transitive Host dependency. @param {string} root */
export function checkPluginDependencies(root) {
  const packageRoot = path.join(root, 'packages/dsh-data-analysis')
  const pluginRequire = createRequire(path.join(packageRoot, 'package.json'))
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  const range = manifest.dshDataAnalysisCompatibility.dsh.peerRange
  if (!semver.validRange(range))
    throw new Error('DSH compatibility requires a valid supported range')
  const hostFilename = pluginRequire.resolve('@deepseek-ai/dsh/package.json')
  const hostRequire = createRequire(hostFilename)
  const host = JSON.parse(readFileSync(hostFilename, 'utf8'))
  assertCompatibleVersion(host.name, host.version, range)
  const peers = Object.entries(manifest.peerDependencies).filter(([name]) =>
    name.startsWith('@deepseek-ai/dsh-'),
  )
  const singletons = ['@deepseek-ai/cordis', ...peers.map(([name]) => name)]
  const owners = [pluginRequire, hostRequire]
  for (const [name, peerRange] of peers) {
    if (peerRange !== range) throw new Error(`inconsistent-peer-range:${name}`)
    const filename = pluginRequire.resolve(`${name}/package.json`)
    const peer = JSON.parse(readFileSync(filename, 'utf8'))
    assertCompatibleVersion(name, peer.version, range)
    owners.push(createRequire(filename))
  }
  for (const name of singletons) {
    const expected = realpathSync(hostRequire.resolve(`${name}/package.json`))
    for (const owner of owners)
      assertHostIdentity(name, realpathSync(owner.resolve(`${name}/package.json`)), expected)
  }
  for (const filename of [
    path.join(root, 'package.json'),
    path.join(packageRoot, 'package.json'),
  ]) {
    const pkg = JSON.parse(readFileSync(filename, 'utf8'))
    for (const [name, spec] of Object.entries({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    })) {
      if (name.startsWith('@deepseek-ai/') && /^(?:file:|link:)/.test(String(spec)))
        throw new Error(`local-host-dependency:${name}`)
    }
  }
  checkProductionSource(path.join(packageRoot, 'src'))
  return { distributionVersion: host.version, peerRange: range, peers: peers.length }
}
