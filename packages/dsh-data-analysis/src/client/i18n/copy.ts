import type { PresentationLocale } from '../../presentation/contracts/types.ts'
import * as credentials from './credentials.ts'
import * as navigation from './navigation.ts'
import * as presentation from './presentation.ts'
import * as semantic from './semantic.ts'

export const dictionaries = { credentials, navigation, presentation, semantic }
export const zh = { ...credentials.zh, ...navigation.zh, ...presentation.zh, ...semantic.zh }
export const en: Record<keyof typeof zh, string> = {
  ...credentials.en,
  ...navigation.en,
  ...presentation.en,
  ...semantic.en,
}
export type CopyKey = keyof typeof zh
export interface CopyMessage {
  readonly key: CopyKey
  readonly params: Readonly<Record<string, string | number | CopyMessage>>
}
export type Notice = string | CopyMessage
export function message(key: CopyKey, params: CopyMessage['params'] = {}): CopyMessage {
  return { key, params }
}
export class CopyError extends Error {
  readonly copy: Notice
  constructor(copy: Notice) {
    super(typeof copy === 'string' ? copy : copy.key)
    this.copy = copy
  }
}
export function errorMessage(error: unknown): Notice {
  return error instanceof CopyError
    ? error.copy
    : error instanceof Error
      ? error.message
      : String(error)
}
export interface Translator {
  (value: Notice | undefined, params?: CopyMessage['params']): string
  readonly locale: PresentationLocale
}
export function translator(
  locale: PresentationLocale,
  lookup?: (key: CopyKey) => string,
): Translator {
  const translate = (value: Notice | undefined, params?: CopyMessage['params']): string => {
    if (value === undefined) return ''
    const key = typeof value === 'string' ? value : value.key
    const values = params ?? (typeof value === 'string' ? {} : value.params)
    const template = Object.hasOwn(zh, key)
      ? (lookup?.(key as CopyKey) ?? (locale === 'zh-CN' ? zh : en)[key as CopyKey])
      : key
    return template.replace(/\{(\w+)\}/g, (match, name) => {
      const entry = values[name]
      return entry === undefined
        ? match
        : typeof entry === 'number'
          ? String(entry)
          : translate(entry)
    })
  }
  return Object.assign(translate, { locale })
}
