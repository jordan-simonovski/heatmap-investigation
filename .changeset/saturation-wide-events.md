---
'heatmap-app': minor
---

Saturation via wide events: box-select now also answers "was the infra saturated?" —
ranked resource cards (p95 during selection vs baseline, straight off raw OTel metric rows
in ClickHouse) plus an ambient saturation strip under the heatmap showing one line per
service so a single service crossing into saturation is visible before you select. No
metrics store, no dashboards, no new services — just query-time SQL over wide events.
