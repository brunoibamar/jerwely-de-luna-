# AGENTS.md

## Verification

This is a vanilla JavaScript project (no Node.js dependencies). Use the following
commands to verify code quality:

- **Brace/paren balance check** (PowerShell, no runtime needed):
  ```powershell
  Get-Content -Raw js\<file>.js | ForEach-Object { ($_.Split('{').Count - 1) -eq ($_.Split('}').Count - 1) }
  ```
- **Load test in browser**: Open `index.html` in a Chromium browser and check the
  console for `[SafeJSON]`, `[StorageGuard]`, or `[DataValidator]` warnings.

## Architecture Notes

- All browser persistence goes through `SafeStorage` (writes with quota handling)
  and `SafeJSON` (reads with try/catch + fallback).
- `DataValidator` validates schemas before data is consumed.
- `StorageGuard.checkAll()` runs at app startup to audit all stores.
- Operational records use `AppStorage` (IndexedDB); `localStorage` is accessed
  directly only by its driver and test fixtures. Reads stay synchronous from
  a verified committed view. Wrap synchronous business mutations in
  `await AppStorage.transaction(() => { ... })` and show success only afterwards.
- Never nest or await inside the transaction callback. Sale, history, stock,
  and VIP points must commit together. Preserve original migration values.
- Regression suites: `tests/indexed-storage.cjs`, `tests/backup-safety.cjs`, and
  `tests/storage-full.cjs` (Node + Playwright in isolated Chromium profiles).
