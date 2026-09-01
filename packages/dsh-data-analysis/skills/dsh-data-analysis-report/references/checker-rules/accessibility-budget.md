# Accessibility and budget repairs

- Give images, controls, SVGs, tables, and headings the names and associations reported by
  `a11y.*` diagnostics. Remove positive tabindex and autoplay.
- Built-in charts create their visible `figcaption` at runtime. The static Checker does not require
  a placeholder caption in source HTML; verify the rendered caption in the browser journey.
- Make hover information reachable by focus and click/touch. Provide visible focus and reduced
  motion handling. Never use color as the only state signal.
- Keep table headers mechanically associated and provide captions. Static heuristics do not prove
  contrast, keyboard flow, or assistive-technology behavior; test those in a browser.
- For `budget.*`, reduce the bundle graph, individual or total text bytes, data URL payloads, or
  diagnostics at the source. Do not split or hide content merely to evade limits.

Any error remains blocking. Warnings require explicit evaluation but do not alone change
`passed_static` to `failed_static`.
