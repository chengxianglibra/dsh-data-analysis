/** Series order used by the analysis-ui chart theme. */
export const FRAME_CHART_LIGHT = [
  '#4263d5',
  '#21867a',
  '#bd7b24',
  '#8661c5',
  '#ba6481',
  '#71849a',
  '#a34e36',
  '#3970a0',
] as const

export const FRAME_CHART_DARK = [
  '#93b4ff',
  '#5dcead',
  '#f2ba68',
  '#b99af2',
  '#ed9eb9',
  '#a4b6cf',
  '#ff9d7c',
  '#72c6e8',
] as const

/** Invert OpenUI's midpoint sampling so series retain their declared order. */
export function paletteForSeries(colors: readonly string[]): string[] {
  if (!colors.length) return []
  if (colors.length === 1) return [colors[0]!]
  if (colors.length === 2) return [colors[0]!, colors[0]!, colors[1]!]
  const length = colors.length
  const middle = Math.floor(length / 2)
  const offset = Math.floor((length - 1) / 2)
  const palette = Array<string>(length)
  colors.forEach((color, index) => {
    palette[(middle + index - offset + length) % length] = color
  })
  return palette
}
