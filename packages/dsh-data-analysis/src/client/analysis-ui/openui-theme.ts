/**
 * Project-scoped overrides for the OpenUI ThemeProvider.
 *
 * ThemeProvider merges these onto its built-in defaults and injects the result
 * as a runtime <style> tag covering both the scoped reader element and the
 * calendar portal. That insertion happens after the compiled stylesheet, so the
 * calendar's surface, accent, radius, spacing, shadow and type must be set here;
 * static CSS cannot override it.
 *
 * Colors mirror the mv-fallback-* values in theme.css. Radius and spacing follow
 * the project's 4/8 px rhythm instead of OpenUI's own scale.
 */

// Light: near-black text on white; near-black accent for selected days.
const lightTheme: Record<string, string> = {
  foreground: 'oklch(1 0 0)',
  background: 'oklch(0.97 0 0)',
  sunk: 'oklch(0.097 0 0 / 0.04)',
  sunkLight: 'oklch(0.097 0 0 / 0.02)',
  sunkDeep: 'oklch(0.097 0 0 / 0.08)',
  highlightSubtle: 'oklch(0.097 0 0 / 0.04)',
  highlight: 'oklch(0.205 0 0 / 0.08)',
  highlightStrong: 'oklch(0.205 0 0 / 0.14)',
  highlightIntense: 'oklch(0.205 0 0 / 0.28)',
  textNeutralPrimary: 'oklch(0.145 0 0)',
  textNeutralSecondary: 'oklch(0.145 0 0 / 0.6)',
  textNeutralTertiary: 'oklch(0.145 0 0 / 0.3)',
  textAccentPrimary: 'oklch(0.985 0 0)',
  textAccentSecondary: 'oklch(0.985 0 0 / 0.7)',
  borderDefault: 'oklch(0.922 0 0)',
  borderInteractive: 'oklch(0.145 0 0 / 0.3)',
  borderInteractiveEmphasis: 'oklch(0.145 0 0 / 0.5)',
  borderInteractiveSelected: 'oklch(0.205 0 0)',
  borderAccent: 'oklch(0.205 0 0)',
  interactiveAccentDefault: 'oklch(0.205 0 0)',
  interactiveAccentHover: 'oklch(0.28 0 0)',
  interactiveAccentPressed: 'oklch(0.35 0 0)',
  interactiveAccentDisabled: 'oklch(0.205 0 0 / 0.4)',
  // Radius — matches theme.css --radius (0.625rem) and its derived steps.
  radiusNone: '0px',
  radius3xs: '1px',
  radius2xs: '2px',
  radiusXs: '2px',
  radiusS: '4px',
  radiusM: '6px',
  radiusL: '8px',
  radiusXl: '10px',
  radius2xl: '12px',
  radiusFull: '9999px',
  // Spacing — 4px base; OpenUI's own scale jumps 6→8→9.
  space000: '0px',
  space3xs: '2px',
  space2xs: '4px',
  spaceXs: '6px',
  spaceS: '8px',
  spaceSM: '10px',
  spaceM: '12px',
  spaceML: '16px',
  spaceL: '16px',
  spaceXl: '20px',
  space2xl: '24px',
  space3xl: '32px',
  // Shadows — muted, matching the project's flat card treatment.
  shadow0: 'none',
  shadowS: '0 1px 3px -2px oklch(0 0 0 / 0.02), 0 2px 5px -2px oklch(0 0 0 / 0.04)',
  shadowM: '0 4px 6px -2px oklch(0 0 0 / 0.025), 0 2px 2px -2px oklch(0 0 0 / 0.05)',
  shadowL: '0 4px 4px -2px oklch(0 0 0 / 0.05), 0 4px 8px -2px oklch(0 0 0 / 0.04)',
  shadowXl: '0 8px 16px -4px oklch(0 0 0 / 0.08), 0 16px 32px -6px oklch(0 0 0 / 0.12)',
}

// Dark: near-white text on near-black; near-white accent for selected days.
const darkTheme: Record<string, string> = {
  foreground: 'oklch(0.145 0 0)',
  background: 'oklch(0.2 0 0)',
  sunk: 'oklch(1 0 0 / 0.04)',
  sunkLight: 'oklch(1 0 0 / 0.02)',
  sunkDeep: 'oklch(1 0 0 / 0.08)',
  highlightSubtle: 'oklch(1 0 0 / 0.04)',
  highlight: 'oklch(0.922 0 0 / 0.08)',
  highlightStrong: 'oklch(0.922 0 0 / 0.14)',
  highlightIntense: 'oklch(0.922 0 0 / 0.28)',
  textNeutralPrimary: 'oklch(0.985 0 0)',
  textNeutralSecondary: 'oklch(0.985 0 0 / 0.6)',
  textNeutralTertiary: 'oklch(0.985 0 0 / 0.3)',
  textAccentPrimary: 'oklch(0.145 0 0)',
  textAccentSecondary: 'oklch(0.145 0 0 / 0.7)',
  borderDefault: 'oklch(1 0 0 / 0.1)',
  borderInteractive: 'oklch(1 0 0 / 0.3)',
  borderInteractiveEmphasis: 'oklch(1 0 0 / 0.5)',
  borderInteractiveSelected: 'oklch(0.922 0 0)',
  borderAccent: 'oklch(0.922 0 0)',
  interactiveAccentDefault: 'oklch(0.922 0 0)',
  interactiveAccentHover: 'oklch(0.84 0 0)',
  interactiveAccentPressed: 'oklch(0.76 0 0)',
  interactiveAccentDisabled: 'oklch(0.922 0 0 / 0.4)',
  shadow0: 'none',
  shadowS: '0 1px 3px -2px oklch(0 0 0 / 0.06), 0 2px 5px -2px oklch(0 0 0 / 0.1)',
  shadowM: '0 4px 6px -2px oklch(0 0 0 / 0.08), 0 2px 2px -2px oklch(0 0 0 / 0.12)',
  shadowL: '0 4px 4px -2px oklch(0 0 0 / 0.12), 0 4px 8px -2px oklch(0 0 0 / 0.1)',
  shadowXl: '0 8px 16px -4px oklch(0 0 0 / 0.16), 0 16px 32px -6px oklch(0 0 0 / 0.2)',
}

// Radius and spacing are mode-independent; the dark map inherits them.
const layout: Record<string, string> = {
  radiusNone: '0px',
  radius3xs: '1px',
  radius2xs: '2px',
  radiusXs: '2px',
  radiusS: '4px',
  radiusM: '6px',
  radiusL: '8px',
  radiusXl: '10px',
  radius2xl: '12px',
  radiusFull: '9999px',
  space000: '0px',
  space3xs: '2px',
  space2xs: '4px',
  spaceXs: '6px',
  spaceS: '8px',
  spaceSM: '10px',
  spaceM: '12px',
  spaceML: '16px',
  spaceL: '16px',
  spaceXl: '20px',
  space2xl: '24px',
  space3xl: '32px',
}

// Typography — follow the project's 14px system-ui base instead of Inter at 16px.
const font = 'system-ui, sans-serif'
const typography = {
  fontBody: font,
  fontLabel: font,
  fontHeading: font,
  fontNumbers: font,
  fontCode: 'ui-monospace, monospace',
  fontSize2xs: '10px',
  fontSizeXs: '12px',
  fontSizeSm: '14px',
  fontSizeMd: '16px',
  fontWeightRegular: '400',
  fontWeightMedium: '500',
  textBodyXs: `400 12px/1.5 ${font}`,
  textBodyXsHeavy: `500 12px/1.5 ${font}`,
  textBodySm: `400 13px/1.5 ${font}`,
  textBodySmHeavy: `500 13px/1.5 ${font}`,
  textBodyDefault: `400 14px/1.5 ${font}`,
  textBodyDefaultHeavy: `500 14px/1.5 ${font}`,
  textLabelXs: `400 11px/1.4 ${font}`,
  textLabelXsHeavy: `500 11px/1.4 ${font}`,
  textLabelSm: `400 12px/1.4 ${font}`,
  textLabelSmHeavy: `500 12px/1.4 ${font}`,
  textLabelDefault: `400 14px/1.4 ${font}`,
  textLabelDefaultHeavy: `500 14px/1.4 ${font}`,
  letterSpacingNormal: 'normal',
  letterSpacingTight: 'normal',
  letterSpacingTighter: 'normal',
  fontVariationRegular: 'normal',
}

export const openUILightTheme: Record<string, string> = { ...lightTheme, ...layout, ...typography }
export const openUIDarkTheme: Record<string, string> = { ...darkTheme, ...layout, ...typography }
