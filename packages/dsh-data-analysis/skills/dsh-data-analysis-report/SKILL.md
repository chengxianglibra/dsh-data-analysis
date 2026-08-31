---
name: dsh-data-analysis-report
description: Create or revise a durable HTML report from a Marivo analysis as a mutable DSH Workspace directory bundle. Use only when the user explicitly requests or accepts an HTML report; do not use for inline answers or other output formats.
---

# DSH data-analysis report

## Ownership and trigger

Use this skill only after the user explicitly requests a durable HTML report,
accepts an offer to create one, or asks to revise a report created in the
conversation. An explicit quick answer, no-file request, or different output
format takes precedence.

Marivo owns analytical meaning, Artifact state, Evidence, Quality, Lineage,
revalidation, and Session Graph semantics. This skill owns only the Agent
workflow for expressing those results as ordinary DSH Workspace files. It does
not define a report schema, template, renderer, publisher, or provenance
contract.

## Read trusted analysis state

Load `marivo-analysis` and follow its live Help routes. Work through Marivo
public objects such as `session.artifact(ref)`, `artifact.show()`,
`artifact.contract()`, `artifact.quality_summary`, `artifact.lineage`,
Artifact-owned Finding reads, `session.revalidate(ref)`, and a bounded
`session.graph(...)` when their facts are relevant. Use `artifact.to_pandas()`
only under the terminal-boundary rules disclosed by live Help.

Revalidate a restored Artifact before presenting it as current. A Session graph
is a factual runtime projection, not proof of current semantic authority or
datasource freshness. Preserve material warnings, truncation, unsupported
claims, and non-Marivo inputs without inventing unified lineage.

## Create the Workspace bundle

Choose the structure, narrative, HTML, CSS, SVG, JavaScript, local libraries,
charts, and interactions that best serve the request. Do not force a fixed set
of sections or chart types.

- Create a new directory for every report or revision, with `index.html` as the
  entry point.
- Keep required assets under that directory and reference them with relative
  paths. Do not depend on a remote CDN for an offline report.
- Put the primary report content in one semantic `<main>` element and give the
  document a meaningful `lang` and `<title>`.
- Generate and check resources before writing `index.html`; write the entry
  last to reduce exposure of a partial bundle.
- In Native or both presentation mode, write or edit the entry through a
  top-level DSH file Tool so Produced Files can project its path.
- In Code-only mode, call the same file Tool from Code Mode and print the exact
  entry path. Nested mutations do not appear in Produced Files.

The bundle is a mutable collection of Workspace files. Do not describe it as
immutable, content-addressed, published, replayable, shared, or recoverable by
historical bytes. Produced Files is path navigation, not readiness or a safety
proof.

## Check and deliver

Before claiming completion, check what applies to the report:

- `index.html` and every referenced local resource exist under the bundle;
- the page loads without a network dependency and contains no known credential
  values or secret-bearing environment names;
- the page has a meaningful title, language, main content, and usable keyboard
  behavior;
- dates, calendar labels, calculations, and other derived presentation facts
  are computed or checked rather than inferred from appearance;
- charts and interactions preserve a readable fallback or explanation;
- print output remains legible and does not omit decision-critical content;
- large data is summarized or bounded rather than embedded without need.

Use a browser when that capability is available. If a required check, resource
write, cancellation, or browser validation fails, say the report is incomplete
and do not treat the mere presence of a path as successful delivery.

After successful checks, return the exact `index.html` path. Local loopback Web
may open that path only when its Host reports `canOpenPath`; remote or headless
environments must degrade to path delivery.

Use `marivo_evidence_sources` separately only when the user explicitly asks for
the DSH source panel and exact persisted Findings exist. Its UI projection does
not prove the report narrative.
