# Dataset snapshot

Prefer the installed report kit for a DataFrame or Marivo Artifact:

```python
from pathlib import Path
from dsh_data_analysis_report import emit_dataset

report_dir = Path("reports/monthly-revenue")
receipt = emit_dataset(result_df, report_dir / "data" / "monthly-revenue.js")
```

For a persisted Artifact, pass the Artifact directly and include an identity-matched revalidation
when current state matters:

```python
revalidation = session.revalidate(artifact.ref)
receipt = emit_dataset(
    artifact,
    report_dir / "data" / "monthly-revenue.js",
    revalidation=revalidation,
)
```

The filename stem becomes the dataset ID unless `dataset_id` is explicitly required. Load classic
scripts in this order, before the consumer:

```html
<script src="./assets/report-data.js"></script>
<script src="./data/monthly-revenue.js"></script>
<script src="./assets/report-charts.js"></script>
<script src="./assets/app.js"></script>
```

Use `ReportData.get("monthly-revenue")` for the positional dataset or
`ReportData.records("monthly-revenue")` for frozen record views. Missing IDs, duplicate IDs, schema
drift, and unsupported values are errors; do not replace them with empty rows or zeroes.

Finite numeric cells may exceed JavaScript's safe-integer range. They stay attached to the original
Artifact dataset, but browser arithmetic can round low-order digits because it uses IEEE-754
numbers. For byte-scale presentation, divide by the chosen GB/TB base in rendering code and format
the result with `ReportCharts.formatNumber`; do not re-emit the data as a computed dataset merely to
pass transport validation.

The snapshot is a bounded display object. Do not restore it as an Artifact or treat its emitted
time, lineage, Quality, Evidence, or revalidation projection as authority beyond the fields
actually present.
