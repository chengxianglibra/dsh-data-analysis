import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))

/** OpenUI's portals are attached to body, outside the reader's .mv-ui root. */
async function openUIStyles() {
  const styles = path.join(path.dirname(require.resolve('@openuidev/react-ui')), 'styles')
  const names = [
    'openui-defaults',
    'button',
    'select',
    'checkBoxGroup',
    'checkBoxItem',
    'datePicker',
    'calendar',
    'formControl',
    'label',
  ]
  const scope =
    ':where(.mv-ui, .mv-ui *, [class*="openui-theme-portal-"], [class*="openui-theme-portal-"] *)'
  const sheets = await Promise.all(
    names.map((name) => readFile(path.join(styles, `${name}.css`), 'utf8')),
  )
  return sheets
    .map((source, index) => {
      const ast = postcss.parse(source)
      const animations = new Map()
      ast.walkAtRules(/keyframes$/, (rule) => {
        animations.set(rule.params, `mv-openui-${rule.params}`)
        rule.params = animations.get(rule.params)
      })
      ast.walkDecls((declaration) => {
        if (!declaration.prop.includes('animation')) return
        for (const [name, replacement] of animations)
          declaration.value = declaration.value.replace(
            new RegExp(`(?<![\\w-])${name}(?![\\w-])`, 'g'),
            replacement,
          )
      })
      ast.walkRules((rule) => {
        if (
          rule.parent?.type === 'rule' ||
          (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name))
        )
          return
        if (index === 0) {
          rule.selector = rule.selector.replaceAll(
            ':root',
            ':is(.mv-ui, [class*="openui-theme-portal-"])',
          )
        } else {
          rule.selector = selectorParser((selectors) => {
            selectors.each((selector) => {
              const prefix = selectorParser().astSync(scope).first.first.clone()
              selector.prepend(prefix)
            })
          }).processSync(rule.selector)
        }
      })
      return ast.toString()
    })
    .join('\n')
}

/** Build exactly the plugin client sources and scope every generated utility. @param {{ check?: boolean }} options */
export async function buildUIStyles({ check = false } = {}) {
  const input = path.join(root, 'src/client/ui/theme.css')
  const compiler = await compile(await readFile(input, 'utf8'), {
    base: path.dirname(input),
    from: input,
    onDependency() {},
  })
  const scanner = new Scanner({ sources: compiler.sources })
  const ast = postcss.parse(compiler.build(scanner.scan()))
  ast.walkRules((rule) => {
    /** @type {import('postcss').Rule | import('postcss').AtRule | import('postcss').Root | import('postcss').Document | undefined} */
    let parent = rule.parent
    while (parent) {
      if (parent.type === 'rule' || (parent.type === 'atrule' && /keyframes$/.test(parent.name)))
        return
      parent = parent.parent
    }
    if (rule.selector === ':root, :host' || rule.selector === ':root') {
      rule.selector = '.mv-ui'
      return
    }
    // Explicit theme rules are already scoped, including Host/OS selectors.
    if (rule.selector.includes('.mv-ui')) return
    rule.selector = selectorParser((selectors) => {
      selectors.each((selector) => {
        const scope = selectorParser.pseudo({ value: ':where' })
        for (const scopedSelector of selectorParser().astSync('.mv-ui, .mv-ui *').nodes)
          scope.append(scopedSelector)
        const first = selector.nodes[0]
        if (first?.type === 'universal') selector.insertAfter(first, scope)
        else selector.prepend(scope)
      })
    }).processSync(rule.selector)
  })
  /** @type {Map<string, string>} */
  const animations = new Map()
  ast.walkAtRules(/keyframes$/, (rule) => {
    animations.set(rule.params, `mv-${rule.params}`)
    rule.params = `mv-${rule.params}`
  })
  ast.walkDecls((declaration) => {
    if (declaration.prop.includes('animation') || declaration.prop.startsWith('--animate-')) {
      for (const [name, replacement] of animations) {
        declaration.value = declaration.value.replace(
          new RegExp(`(?<![\\w-])${name}(?![\\w-])`, 'g'),
          replacement,
        )
      }
    }
  })
  let css = ast.toString()
  ast.walkAtRules('property', (rule) => {
    const original = rule.params
    const namespaced = `--mv-${original.slice(2)}`
    css = css.replace(new RegExp(`${original}(?![\\w-])`, 'g'), namespaced)
  })
  css = css.replaceAll('--tw-', '--mv-tw-')
  css += `\n${await openUIStyles()}`
  const output = path.join(root, 'src/client/ui/styles.generated.ts')
  const literal = css.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')
  const module = `// Generated by scripts/build-ui-styles.mjs. Do not edit.\nexport const COMPILED_UI_STYLES: string = \`${literal}\`\n`
  if (check) {
    if ((await readFile(output, 'utf8')) !== module)
      throw new Error('stale-ui-styles:run-build:ui-styles')
  } else {
    // Keep temporary files outside the client scan and replace the module in one step.
    const directory = await mkdtemp(path.join(root, '.ui-styles-'))
    try {
      const temporary = path.join(directory, 'styles.generated.ts')
      await writeFile(temporary, module)
      await rename(temporary, output)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  return css
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await buildUIStyles({ check: process.argv.includes('--check') })
