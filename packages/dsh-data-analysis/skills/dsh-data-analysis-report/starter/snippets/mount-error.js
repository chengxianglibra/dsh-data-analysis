;((scope) => {
  function mount(container, render) {
    if (!(container instanceof Element)) {
      const error = new Error('Component host is not an Element')
      error.code = 'container-invalid'
      throw error
    }
    try {
      return render(container)
    } catch (error) {
      const message = document.createElement('p')
      message.className = 'callout callout-critical'
      const code = typeof error?.code === 'string' ? error.code : 'render-failed'
      message.textContent = `组件未生成（${code}）`
      container.replaceChildren(message)
      throw error
    }
  }

  Object.defineProperty(scope, 'mount', {
    configurable: false,
    enumerable: true,
    value: Object.freeze(mount),
    writable: false,
  })
})(globalThis)
