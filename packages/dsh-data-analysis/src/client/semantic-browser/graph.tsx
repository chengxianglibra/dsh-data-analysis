// @ts-nocheck -- JSX is bundled by the plugin client build.

import { useId, useMemo, useRef, useState } from 'react'
import { refKey } from '../../semantic-reference/contracts.ts'
import { useCopy } from './../i18n/context.tsx'
import { fieldLabels, kindLabels } from './labels.ts'

export function ObjectGraph({ object, objects, navigate }) {
  const t = useCopy()

  const arrowId = useId().replaceAll(':', '')
  const root = refKey(object.ref)
  const [depth, setDepth] = useState(1)
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 })
  const drag = useRef(null)
  const graph = useMemo(() => {
    const keys = new Set([root]),
      edges = [],
      edgeKeys = new Set()
    let frontier = [root],
      limited = false
    for (let level = 0; level < depth; level++) {
      const next = []
      for (const key of frontier)
        for (const relation of objects.get(key)?.relations ?? []) {
          const target = refKey(relation.ref)
          if (!objects.has(target)) continue
          if (!keys.has(target)) {
            if (keys.size >= 60) {
              limited = true
              continue
            }
            keys.add(target)
            next.push(target)
          }
          const edgeKey = `${key}/${relation.field}/${target}`
          if (!edgeKeys.has(edgeKey)) {
            edgeKeys.add(edgeKey)
            edges.push({ from: key, to: target, field: relation.field })
          }
        }
      frontier = next
    }
    const others = [...keys].filter((key) => key !== root)
    const dense = others.length > 10
    const nodes = [
      { key: root, x: 400, y: dense ? 45 : 260 },
      ...others.map((key, i) => {
        if (dense) return { key, x: 100 + (i % 4) * 200, y: 140 + Math.floor(i / 4) * 100 }
        const angle = (2 * Math.PI * i) / Math.max(1, others.length)
        return { key, x: 400 + Math.cos(angle) * 285, y: 260 + Math.sin(angle) * 195 }
      }),
    ]
    const grouped = new Map()
    for (const edge of edges) {
      const pair = JSON.stringify([edge.from, edge.to])
      const current = grouped.get(pair)
      if (current) current.fields.push(edge.field)
      else grouped.set(pair, { ...edge, fields: [edge.field] })
    }
    return {
      nodes,
      edges,
      visualEdges: [...grouped.values()],
      limited,
      height: dense ? 200 + Math.ceil(others.length / 4) * 100 : 520,
    }
  }, [root, objects, depth])
  const positions = new Map(graph.nodes.map((node) => [node.key, node]))
  return (
    <div className="sb-graph">
      <div className="sb-actions">
        <button type="button" onClick={() => setDepth((d) => d + 1)}>
          {t('marivo.semantic.expand-one-more-level')}
        </button>
        <button
          type="button"
          aria-label={t('marivo.semantic.zoom-in')}
          onClick={() => setCamera((c) => ({ ...c, scale: Math.min(3, c.scale * 1.25) }))}
        >
          ＋
        </button>
        <button
          type="button"
          aria-label={t('marivo.semantic.zoom-out')}
          onClick={() => setCamera((c) => ({ ...c, scale: Math.max(0.4, c.scale / 1.25) }))}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => {
            setDepth(1)
            setCamera({ x: 0, y: 0, scale: 1 })
          }}
        >
          {t('marivo.semantic.center-graph')}
        </button>
      </div>
      <p className="sb-muted">
        {t('marivo.semantic.declared-relationships-level')}
        {depth} {t('marivo.semantic.drag-the-background-to-pan-click-an-object-for')}
      </p>
      {graph.limited && (
        <p role="status">{t('marivo.semantic.the-graph-shows-at-most-60-objects-see-the')}</p>
      )}
      <svg
        viewBox={`0 0 800 ${graph.height}`}
        aria-label={t('marivo.semantic.local-relationship-graph')}
        role="img"
        onPointerDown={(event) => {
          if (event.target.closest('[role="button"]')) return
          const rect = event.currentTarget.getBoundingClientRect()
          drag.current = { x: event.clientX, y: event.clientY, camera, ratio: 800 / rect.width }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (drag.current)
            setCamera({
              ...drag.current.camera,
              x: drag.current.camera.x + (event.clientX - drag.current.x) * drag.current.ratio,
              y: drag.current.camera.y + (event.clientY - drag.current.y) * drag.current.ratio,
            })
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <title>
          {t(
            'marivo.semantic.object-relationships-an-equivalent-clickable-list-is-available-below',
          )}
        </title>
        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--sb-muted)" />
          </marker>
        </defs>
        <g
          transform={`translate(${camera.x + 400} ${camera.y + 260}) scale(${camera.scale}) translate(-400 -260)`}
        >
          {graph.visualEdges.map((edge) => {
            const a = positions.get(edge.from),
              b = positions.get(edge.to)
            const dx = b.x - a.x,
              dy = b.y - a.y
            const inset = Math.min(
              Math.abs(dx) > 0 ? 84 / Math.abs(dx) : 1,
              Math.abs(dy) > 0 ? 27 / Math.abs(dy) : 1,
            )
            const label = fieldLabels[edge.fields[0]] ?? edge.fields[0]
            return (
              <g key={`${edge.from}/${edge.field}/${edge.to}`}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x - dx * inset}
                  y2={b.y - dy * inset}
                  stroke="var(--sb-border)"
                  strokeWidth="1.5"
                  markerEnd={`url(#${arrowId})`}
                />
                {graph.nodes.length <= 11 && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 5}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--sb-muted)"
                    paintOrder="stroke"
                    stroke="var(--sb-soft)"
                    strokeWidth="3"
                  >
                    {t(label)}
                    {edge.fields.length > 1 ? ` +${edge.fields.length - 1}` : ''}
                  </text>
                )}
                <title>
                  {edge.from} →{' '}
                  {edge.fields.map((field) => fieldLabels[field] ?? field).join(' / ')} → {edge.to}
                </title>
              </g>
            )
          })}
          {graph.nodes.map((node) => {
            const item = objects.get(node.key)
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG node with keyboard activation; equivalent HTML buttons are provided below.
              <g
                key={node.key}
                role="button"
                tabIndex={0}
                aria-label={t('marivo.semantic.view-value', { p0: item.name })}
                onClick={() => navigate(node.key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    navigate(node.key)
                  }
                }}
              >
                <title>{node.key}</title>
                <rect
                  x={node.x - 83}
                  y={node.y - 26}
                  width="166"
                  height="52"
                  rx="8"
                  fill={node.key === root ? 'var(--sb-accent)' : 'var(--sb-bg)'}
                  stroke="var(--sb-border)"
                />
                <text
                  x={node.x}
                  y={node.y - 3}
                  textAnchor="middle"
                  fontSize="12"
                  fill={node.key === root ? '#fff' : 'var(--sb-text)'}
                >
                  {item.name.length > 18 ? `${item.name.slice(0, 17)}…` : item.name}
                </text>
                <text
                  x={node.x}
                  y={node.y + 15}
                  textAnchor="middle"
                  fontSize="10"
                  fill={node.key === root ? '#fff' : 'var(--sb-muted)'}
                >
                  {t(kindLabels[item.ref.kind] ?? item.ref.kind)}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <details>
        <summary>
          {t('marivo.semantic.relationships')}
          {graph.edges.length}）
        </summary>
        <ul className="sb-relation-list">
          {graph.edges.map((edge) => (
            <li key={`${edge.from}/${edge.field}/${edge.to}`}>
              <button type="button" onClick={() => navigate(edge.from)}>
                {objects.get(edge.from).name}
              </button>
              <span>{t(fieldLabels[edge.field] ?? edge.field)} →</span>
              <button type="button" onClick={() => navigate(edge.to)}>
                {objects.get(edge.to).name}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
