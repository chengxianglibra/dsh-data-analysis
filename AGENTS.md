# Repository Guidelines

## Project Structure & Module Organization

This is a documentation-first design project for a Marivo-powered analytical agent runtime on DeepSeek Harness.

- `README.md` is the short project entry point and links to canonical designs.
- `docs/design-vision.md` contains the product vision, architecture boundaries, and core runtime concepts.
- `docs/marivo-evidence-validity-design.md` is intentionally only a pointer; the canonical evidence contract lives in the sibling `../marivo` repository.

Add design material under `docs/`. Keep topics focused, and link primary entry points from `README.md`. Do not duplicate Marivo-owned contracts here.

## Documentation Development & Checks

Markdown-only changes still use these lightweight checks:

```sh
rg '^#{1,6} ' README.md docs/     # review heading hierarchy
rg '\.\./marivo' README.md docs/  # inspect cross-repository links
git diff --check                  # detect whitespace errors in a Git checkout
```

Preview changed Markdown and verify relative links from their source file. If executable code is introduced, add its setup, run, formatting, and test commands here in the same change.

The executable MVP package now lives under `packages/dsh-data-analysis/`. Use Node.js 24 or later;
Node's built-in TypeScript stripping runs the tests and validation scripts without a separate build:

```sh
npm install                       # setup
npm run typecheck                 # static check
npm run test:slice1               # deterministic Slice 1 tests
npm run validate:slice1:real      # local editable Marivo source validation
npm run test:slice2               # deterministic Slice 2 Tool Runtime tests
npm run validate:slice2:real      # raw-help parity and import-shadow validation
npm run test:slice3               # deterministic native Headless checkpoint tests
npm run validate:slice3:real      # local Marivo checkpoint integration validation
npm run validate:slice4:real      # credential-gated real-model journeys and counterfactual
```

There is no automatic formatter yet. Follow the neighboring Harness TypeScript style and keep
`npm run typecheck` clean. Add a formatter command here before introducing a formatting gate.

## Writing Style & Naming Conventions

Use UTF-8 Markdown, short paragraphs, descriptive ATX headings (`## Heading`), fenced code blocks with language tags, and tables only for useful comparisons. Follow the existing Chinese prose style for user-facing design text while preserving English contract identifiers such as `Artifact`, `Finding`, and `needs-authority`. Wrap prose around 80–100 characters when practical.

Name design files with lowercase kebab-case, for example `docs/evidence-directed-loop.md`. Use one canonical term for each concept and define it on first use.

## Design and Testing Expectations

Keep the ownership boundary explicit: Harness owns orchestration and policy; Marivo owns semantic,
artifact, evidence, quality, and lineage contracts. Review documentation terminology, diagrams,
state values, and every changed link; executable changes must also pass the Slice tests and relevant
real validation above. Link to canonical Marivo documentation instead of restating its contracts.

## Commit & Pull Request Guidelines

This directory does not currently include Git history, so no repository-specific commit convention can be inferred. Use concise, imperative subjects with a useful scope, such as `docs: clarify evidence closure`. Keep commits single-purpose.

Pull requests should explain the design problem, summarize the decision, list affected documents, and call out moved or externally owned contracts. Link relevant issues or upstream Marivo changes. Include screenshots only when rendered diagrams or layout changed, and report the manual checks performed.
