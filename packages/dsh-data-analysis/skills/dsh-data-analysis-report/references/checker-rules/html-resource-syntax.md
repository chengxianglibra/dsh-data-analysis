# HTML, resource, and syntax repairs

- `html.*`: repair parser errors, document metadata, the single main/h1, duplicate IDs, fragment
  and ARIA references, invalid attributes, dangerous URL schemes, or a forbidden base element.
- `resource.*`: keep referenced local regular files under the bundle root. Replace file URLs and
  resolve missing or escaping paths. External dependency warnings record unchecked coverage and
  are not offline proof.
- `css.*`, `javascript.*`, `json.*`, `svg.*`: repair the reported parser location. Do not weaken or
  skip the rule.
- `security.*`: remove secret-like names and values from report resources; refer to credential
  handles only when the narrative truly needs them.
- `starter.*`: replace every reserved placeholder ID and remove
  `<meta name="dsh-report-starter" content="unresolved">` before delivery.

Rerun the Checker after each repair group. It never edits or formats the files for you.
