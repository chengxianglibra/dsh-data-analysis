import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { type ComponentType, useSyncExternalStore } from 'react'
import { HostCopyProvider } from './context.tsx'
import { type CopyKey, dictionaries, translator } from './copy.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'marivo.credentials': keyof typeof dictionaries.credentials.zh
    'marivo.navigation': keyof typeof dictionaries.navigation.zh
    'marivo.presentation': keyof typeof dictionaries.presentation.zh
    'marivo.semantic': keyof typeof dictionaries.semantic.zh
    'marivo.python': keyof typeof dictionaries.python.zh
    'marivo.settings': keyof typeof dictionaries.settings.zh
  }
}
export function installCopy(ctx: Context) {
  ctx.effect(() => ctx.locale.register('marivo.credentials', dictionaries.credentials))
  ctx.effect(() => ctx.locale.register('marivo.navigation', dictionaries.navigation))
  ctx.effect(() => ctx.locale.register('marivo.presentation', dictionaries.presentation))
  ctx.effect(() => ctx.locale.register('marivo.semantic', dictionaries.semantic))
  ctx.effect(() => ctx.locale.register('marivo.python', dictionaries.python))
  ctx.effect(() => ctx.locale.register('marivo.settings', dictionaries.settings))
}
export function hostCopy(ctx: Context) {
  const active = ctx.locale.getSnapshot().active
  return translator(active === 'zh' ? 'zh-CN' : 'en-US', (key: CopyKey) => {
    const namespace = key.split('.').slice(0, 2).join('.') as 'marivo.navigation'
    return ctx.locale.bind(namespace)(key as keyof typeof dictionaries.navigation.zh)
  })
}
/** Subscribe without changing component identity or the page-owned models. */
export function localized<P extends object>(
  ctx: Context,
  Component: ComponentType<P>,
): ComponentType<P> {
  const subscribe = (listener: () => void) => ctx.locale.subscribe(listener)
  const getSnapshot = () => ctx.locale.getSnapshot()
  return function Localized(props: P) {
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    return (
      <HostCopyProvider t={hostCopy(ctx)}>
        <Component {...props} />
      </HostCopyProvider>
    )
  }
}
