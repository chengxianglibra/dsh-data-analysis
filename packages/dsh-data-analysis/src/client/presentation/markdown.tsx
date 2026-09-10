import { Fragment, type ReactNode } from 'react'
import { useCopy } from './../i18n/context.tsx'
import type { Translator } from '../i18n/copy.ts'

export function safeMarkdownHref(value: string): string | undefined {
  const href = value.trim()
  return /^(?:https?:\/\/|mailto:|#)/i.test(href) &&
    ![...href].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
    ? href
    : undefined
}

// Deliberately render tokens as React text/elements: HTML, images and executable
// URLs never become markup or automatically requested resources.
function inline(t: Translator, text: string, depth = 0): ReactNode {
  if (depth > 8) return text
  // A failed link candidate must stop at the next opening delimiter. Letting
  // labels consume '[' retries the rest of a malformed line at every '['.
  const tokens =
    /(`[^`\n]+`|\*\*[^\n]+?\*\*|__[^\n]+?__|\*[^*\n]+\*|_[^_\n]+_|!?\[[^[\]\n]*\]\([^\s()[\]]*\))/g
  const nodes: ReactNode[] = []
  let offset = 0
  for (const match of text.matchAll(tokens)) {
    const position = match.index!
    nodes.push(text.slice(offset, position))
    const token = match[0]
    let element: ReactNode
    if (token.startsWith('`')) element = <code>{token.slice(1, -1)}</code>
    else if (token.startsWith('**') || token.startsWith('__'))
      element = <strong>{inline(t, token.slice(2, -2), depth + 1)}</strong>
    else if (token.startsWith('*') || token.startsWith('_'))
      element = <em>{inline(t, token.slice(1, -1), depth + 1)}</em>
    else {
      const link = /^(!?)\[([^\]]*)\]\(([^)]*)\)$/.exec(token)!
      const href = safeMarkdownHref(link[3]!)
      element = link[1] ? (
        <span>
          {t('marivo.presentation.image')}
          {link[2]}
        </span>
      ) : href ? (
        <a
          href={href}
          rel="noreferrer noopener"
          target={href.startsWith('#') ? undefined : '_blank'}
        >
          {inline(t, link[2]!, depth + 1)}
        </a>
      ) : (
        token
      )
    }
    nodes.push(<Fragment key={position}>{element}</Fragment>)
    offset = position + token.length
  }
  nodes.push(text.slice(offset))
  return nodes
}

export function Markdown({ text, depth = 0 }: { text: string; depth?: number }) {
  const t = useCopy()

  if (depth >= 12) return <p>{text}</p>
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const start = index
    const line = lines[index]!
    if (!line.trim()) {
      index += 1
      continue
    }
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      const content: string[] = []
      index += 1
      while (index < lines.length && !lines[index]!.trim().startsWith(fence[1]!)) {
        content.push(lines[index++]!)
      }
      if (index < lines.length) index += 1
      blocks.push(
        <pre key={start}>
          <code>{content.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line)
    if (heading) {
      // Reserve h1 for the report title without demoting authored h2 sections.
      const Tag = `h${Math.max(2, heading[1]!.length)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      blocks.push(<Tag key={start}>{inline(t, heading[2]!)}</Tag>)
      index += 1
      continue
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={start} />)
      index += 1
      continue
    }
    if (/^\s*>/.test(line)) {
      const content: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index]!))
        content.push(lines[index++]!.replace(/^\s*> ?/, ''))
      blocks.push(
        <blockquote key={start}>
          <Markdown text={content.join('\n')} depth={depth + 1} />
        </blockquote>,
      )
      continue
    }
    const list = /^\s*(?:([-+*])|(\d+)[.)])\s+/.exec(line)
    if (list) {
      const ordered = Boolean(list[2])
      const pattern = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-+*]\s+(.*)$/
      const items: ReactNode[] = []
      while (index < lines.length) {
        const item = pattern.exec(lines[index]!)
        if (!item) break
        items.push(<li key={index}>{inline(t, item[1]!)}</li>)
        index += 1
      }
      blocks.push(
        ordered ? (
          <ol key={start} start={Number(list[2])}>
            {items}
          </ol>
        ) : (
          <ul key={start}>{items}</ul>
        ),
      )
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^\s*(?:#{1,6}\s|>|`{3,}|~{3,}|[-+*]\s|\d+[.)]\s)/.test(lines[index]!)
    )
      paragraph.push(lines[index++]!)
    blocks.push(<p key={start}>{inline(t, paragraph.join('\n'))}</p>)
  }
  return <div className="pr-markdown">{blocks}</div>
}
