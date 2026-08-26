# Repository Guidelines

## Project Scope

`dsh-data-analysis` integrates Marivo into the DeepSeek Harness agent runtime.
The repository contains an executable TypeScript plugin and its design and
acceptance documentation.

Keep the ownership boundary explicit:

- DeepSeek Harness owns agent orchestration, sessions, tool and skill lifecycles,
  credentials, and profiles.
- Marivo owns analytical semantics, artifacts, evidence, quality, lineage, and
  their validity contracts.
- This project owns the integration seam: runtime and workspace binding, live
  capability disclosure, credential-safe workflows, packaging, and validation.

Do not duplicate or reinterpret contracts owned by either sibling project.

## Repository Organization and Sources of Truth

- `packages/dsh-data-analysis/` contains implementation, tests, validation
  scripts, and package metadata.
- `docs/architecture.md` is the overall architecture; `docs/modules/` contains current module architecture.
- `README.md` is the user entry point; the package README covers distribution.
- Root workspace scripts define the supported build and verification workflow.

Treat current code and checked-out sibling Marivo and Harness sources as
authoritative. Historical Slice documents explain decisions, not current
runtime contracts.

## Engineering Principles

- Prefer narrow integration seams over shadow registries, copied schemas, or
  plugin-owned upstream behavior.
- Use Marivo's public, live contracts and preserve runtime identity across
  related operations.
- Separate shared-runtime concerns from per-Workspace configuration and state.
- Preserve Harness tool, skill, session, and profile behavior unless explicitly
  changing it.
- Keep credentials operation-scoped; never expose or persist secret values in
  logs, results, arguments, or telemetry.
- Fail explicitly at trust boundaries; never silently switch interpreter,
  installation, project, or capability source.
- Make the smallest coherent change and avoid speculative policy expansion.

## Development and Verification

Use Node.js 24 or later and install dependencies with `npm install`. For
executable changes, run focused tests and keep `npm run check` clean. Run
`npm run build` and `npm run verify:plugin-package` when exports, client code,
package metadata, or distribution contents change.

Real-environment and real-model validations supplement deterministic tests. Run
them when their boundary changes and prerequisites are available; report skipped
or blocked checks.

## Documentation and Change Quality

Write user-facing documentation in clear Chinese while preserving canonical
English identifiers. Use focused Markdown, descriptive ATX headings, relative
links, and lowercase kebab-case filenames. Link upstream contracts instead of
restating them.

Update documentation and acceptance records when behavior or ownership changes.
Check links, review rendered Markdown, and run `git diff --check`. Keep commits
single-purpose and exclude unrelated workspace changes.
