export interface TestEventInit {
  key?: string
  relatedTarget?: TestNode | null
}

export class TestEvent {
  readonly key: string
  readonly relatedTarget: TestNode | null
  readonly type: string

  constructor(type: string, init: TestEventInit = {}) {
    this.type = type
    this.key = init.key ?? ''
    this.relatedTarget = init.relatedTarget ?? null
  }
}

type Listener = (event: TestEvent) => void

export class TestNode {
  readonly childNodes: TestNode[] = []
  parentNode: TestNode | null = null
  protected ownText = ''
  private readonly listeners = new Map<string, Set<Listener>>()

  get textContent(): string {
    return this.ownText + this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    this.replaceChildren()
    this.ownText = String(value)
  }

  append(...children: TestNode[]): void {
    for (const child of children) this.insert(child, this.childNodes.length)
  }

  prepend(...children: TestNode[]): void {
    let index = 0
    for (const child of children) this.insert(child, index++)
  }

  replaceChildren(...children: TestNode[]): void {
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes.length = 0
    this.ownText = ''
    this.append(...children)
  }

  remove(): void {
    if (this.parentNode === null) return
    const index = this.parentNode.childNodes.indexOf(this)
    if (index >= 0) this.parentNode.childNodes.splice(index, 1)
    this.parentNode = null
  }

  contains(candidate: TestNode): boolean {
    return candidate === this || this.childNodes.some((child) => child.contains(candidate))
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  dispatchEvent(event: TestEvent): boolean {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event)
    return true
  }

  protected insert(child: TestNode, index: number): void {
    if (child instanceof TestDocumentFragment) {
      for (const grandchild of [...child.childNodes]) this.insert(grandchild, index++)
      return
    }
    child.remove()
    child.parentNode = this
    this.childNodes.splice(index, 0, child)
  }
}

function dataProperty(name: string): string {
  return name.replaceAll(/-([a-z])/g, (_, character: string) => character.toUpperCase())
}

export class TestElement extends TestNode {
  readonly attributes = new Map<string, string>()
  readonly dataset: Record<string, string> = {}
  readonly style: Record<string, string> = {}
  readonly tagName: string
  className = ''
  hidden = false
  id = ''
  scope = ''
  type = ''

  constructor(tagName: string) {
    super()
    this.tagName = tagName.toUpperCase()
  }

  setAttribute(name: string, value: string): void {
    const normalized = String(value)
    this.attributes.set(name, normalized)
    if (name === 'class') this.className = normalized
    if (name === 'id') this.id = normalized
    if (name.startsWith('data-')) this.dataset[dataProperty(name.slice(5))] = normalized
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.className || null
    if (name === 'id') return this.id || null
    return this.attributes.get(name) ?? null
  }

  matches(selector: string): boolean {
    if (selector === ':popover-open') return false
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1))
    if (selector.startsWith('#')) return this.id === selector.slice(1)
    return this.tagName.toLowerCase() === selector.toLowerCase()
  }

  querySelector(selector: string): TestElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): TestElement[] {
    const found: TestElement[] = []
    const visit = (node: TestNode): void => {
      for (const child of node.childNodes) {
        if (child instanceof TestElement && child.matches(selector)) found.push(child)
        visit(child)
      }
    }
    visit(this)
    return found
  }

  focus(): void {
    this.dispatchEvent(new TestEvent('focus'))
  }
}

export class TestDocumentFragment extends TestNode {}

export class TestDocument {
  readonly body = new TestElement('body')

  createElement(tagName: string): TestElement {
    return new TestElement(tagName)
  }

  createElementNS(_namespace: string, tagName: string): TestElement {
    return new TestElement(tagName)
  }

  createDocumentFragment(): TestDocumentFragment {
    return new TestDocumentFragment()
  }

  querySelector(selector: string): TestElement | null {
    if (this.body.matches(selector)) return this.body
    return this.body.querySelector(selector)
  }
}
