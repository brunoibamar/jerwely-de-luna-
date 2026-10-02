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
