# Changelog

## 1.1.0

### Minor Changes

- [#50](https://github.com/jordan-simonovski/heatmap-investigation/pull/50) [`6a5e19a`](https://github.com/jordan-simonovski/heatmap-investigation/commit/6a5e19a6042afd5a76cfc355a9f96b0038bf57ef) Thanks [@jordan-simonovski](https://github.com/jordan-simonovski)! - Made a glowy boi for the error insights panel as a CTA

- [#51](https://github.com/jordan-simonovski/heatmap-investigation/pull/51) [`fe3ed59`](https://github.com/jordan-simonovski/heatmap-investigation/commit/fe3ed59527ef032de6ba865436532398ad70c86b) Thanks [@jordan-simonovski](https://github.com/jordan-simonovski)! - Saturation via wide events: box-select now also answers "was the infra saturated?" —
  ranked resource cards (p95 during selection vs baseline, straight off raw OTel metric rows
  in ClickHouse) plus an ambient saturation strip under the heatmap showing one line per
  service so a single service crossing into saturation is visible before you select. No
  metrics store, no dashboards, no new services — just query-time SQL over wide events.

## 1.0.3

### Patch Changes

- [#46](https://github.com/jordan-simonovski/heatmap-investigation/pull/46) [`b5d517d`](https://github.com/jordan-simonovski/heatmap-investigation/commit/b5d517de6841bb7c63ced6b696fbde5ebcc2982c) Thanks [@jordan-simonovski](https://github.com/jordan-simonovski)! - chore: harden the release pipeline — skip already-signed versions (HTTP 409) instead of failing the whole publish, and point changelog links at the renamed repo (heatmap-investigation)

## 1.0.2

### Patch Changes

- [#44](https://github.com/jordan-simonovski/heatmap-investigation/pull/44) [`13e2238`](https://github.com/jordan-simonovski/heatmap-investigation/commit/13e2238b6b573e086a92bd735d59be840d76c3ca) Thanks [@jordan-simonovski](https://github.com/jordan-simonovski)! - chore: bump transitive npm dependencies to resolve open Dependabot PRs (qs, serialize-javascript, protobufjs, @protobufjs/utf8, fast-uri, picomatch, protocol-buffers-schema, lodash, flatted, yaml, copy-webpack-plugin, terser-webpack-plugin)

## 1.0.1

### Patch Changes

- [#41](https://github.com/jordan-simonovski/heatmap-investigation/pull/41) [`75c64ff`](https://github.com/jordan-simonovski/heatmap-investigation/commit/75c64fff633be616f96669860b53916b742ba6f7) Thanks [@jordan-simonovski](https://github.com/jordan-simonovski)! - chore: patch bumped dependencies to resolve vulns

## 1.0.0 (Unreleased)

Initial release.
