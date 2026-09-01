# Dataset and trace repairs

- Load each registry provider before its snapshots, and every snapshot before its consumer.
- Register each literal dataset or trace ID once. Read only IDs already registered earlier in the
  classic script sequence.
- Re-emit schema-invalid snapshots with the installed report kit instead of hand-patching fields.
- Repair dangling trace identities at the graph selection or emit step; do not invent nodes or
  alter lifecycle facts for presentation.
- `trace.artifact-preview-missing` means at least one Frame node lacks an identity-matched Marivo
  Artifact dataset. Load it through `session.artifact(ref)`, emit at most 10 preview rows, and load
  every snapshot before the trace consumer.
- An Artifact-backed report without a standard trace receives a warning. Add the focused trace,
  or retain the warning when the user explicitly requested omission and avoid complete
  traceability claims.

Dataset and trace snapshots remain transport projections, not analytical validation receipts.
