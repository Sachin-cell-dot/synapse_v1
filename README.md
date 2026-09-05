# SYNAPSE-WX

SYNAPSE-WX is a leakage-safe Karnataka district-wise 24-hour rainfall forecasting MVP. It combines separate GFS, IFS HRES, and AIFS rainfall forecasts using district-specific dynamic trust weights derived only from earlier IMD realised-rainfall errors.

## Frozen model-only MVP

- Common three-model period begins 2025-10-01.
- Training: 2025-10-01 to 2025-12-31.
- Validation: 2026-01-01 to 2026-04-30.
- Final held-out test: 2026-05-01 to 2026-08-31.
- Rolling performance window: 60 days.
- Inverse-MAE power: 2.0.
- SYNOP features are excluded from training because the available station dataset failed statewide spatial and temporal coverage checks.

## Main commands

```powershell
python collect_synapse_wx_statewide.py --help
python train_synapse_wx_model_only.py
python verify_synapse_wx_model_only_outputs.py
python generate_synapse_wx_detailed_reports.py
python verify_synapse_wx_detailed_reports.py
```

Input datasets, raw API responses, and generated outputs are intentionally excluded from Git. The collectors and reports preserve leakage controls and provenance so those artifacts can be reproduced locally.

## Important interpretation

The saved evaluation output is a historical hindcast, not a live operational forecast. Final test observations are used only for verification after the model configuration is frozen.

## Operational extension (in development)

The configuration-driven operational foundation lives in `synapse_wx_operational/`. It is deliberately separate from the frozen historical scripts and outputs. No issued operational forecast may overwrite another, and all scientific and deployment values are loaded from versioned configuration.

```powershell
python -m synapse_wx_operational.cli --config config/operational.example.json validate-config
python -m synapse_wx_operational.cli --config config/operational.example.json init-db
python -m synapse_wx_operational.cli --config config/operational.example.json bootstrap-history
python -m synapse_wx_operational.cli --config config/operational.example.json run-district --district "Bengaluru Urban"
python -m synapse_wx_operational.cli --config config/operational.example.json run-statewide
python -m synapse_wx_operational.cli --config config/operational.example.json export-cycle --cycle-id CYCLE_ID
python -m synapse_wx_operational.cli --config config/operational.example.json evaluate-cycle --cycle-id CYCLE_ID
python -m synapse_wx_operational.cli --config config/operational.example.json import-verification --file PATH_TO_IMD_CSV --dry-run
python -m synapse_wx_operational.cli --config config/operational.example.json import-verification --file PATH_TO_IMD_CSV
python -m synapse_wx_operational.cli --config config/operational.example.json ingest-imd --date 2026-09-04
python -m synapse_wx_operational.cli --config config/operational.example.json ingest-latest-imd
python -m unittest discover -s tests -v
```

`run-district` is the bounded vertical slice: it derives sampling points from the configured boundary, retrieves every enabled source, forms configured lead-day accumulations, and appends the issued source and blended forecasts to SQLite. With no eligible verification history it records the configured equal-weight cold-start fallback.

`bootstrap-history` imports configured source and verification columns into a separate immutable skill-history table. The current audited dataset supplies Day-1 history only, so longer forecast leads correctly retain the equal-weight cold start until lead-specific history is collected or backfilled. The configured verification-availability lag controls which historical dates are eligible at issuance.

`bootstrap-archived-skill` derives its date window from the verified historical master and configured rolling window, retrieves Previous Runs fields for every configured lead, and adds only missing immutable district/model/lead skill observations. `reconstruct-missing-cycles` detects the gap between the historical master and the first live cycle, retrieves exact Single Runs, and exports those dates with the configured archived-reconstruction mode. Neither command contains a fixed date or cycle identifier.

Operational weighting uses the first complete evidence level in this order: district and lead, regional and lead, statewide and lead, then the configured no-history fallback. The selected fallback level is persisted with every blend.

Run the IMD verification import with `--dry-run` first. CSV column names, district identifiers, units, provider, classification, and optional availability timestamp column are declared in configuration. If no availability timestamp column is configured, the first successful import time is retained as the leakage-safe availability time. Identical re-imports are harmless; conflicting values are rejected.

The IMD commands retrieve the official real-time daily 0.25-degree rainfall binary grid, preserve it unchanged with a manifest and SHA-256 hash, and derive district values from grid points inside the configured polygons. These are SYNAPSE-WX district aggregates of an IMD gridded product, not an IMD-published district table. `ingest-latest-imd` uses the configured availability-day offset and is scheduler-friendly; no system scheduler is installed by the project.

`evaluate-cycle` matches verification by provider, district, and exact valid interval. It exports row-level source and blend errors plus MAE, RMSE, and bias summaries by lead time. Unpublished verification remains explicitly pending and is never replaced with a proxy or zero.

See `docs/OPERATIONAL_ARCHITECTURE.md` for the data contract, provenance rules, and the next implementation slice. Copy the example configuration to a deployment-specific file before operational use; do not put credentials in version control.

## Historical hindcast dashboard

The local dashboard is in `dashboard/`. It presents the frozen model-only MVP; IMD realised rainfall appears only under **Verification only**.

```powershell
cd dashboard
npm install
npm run dev
```

If `npm` is not on your PowerShell path, use `C:\Program Files\nodejs\npm.cmd` instead.

Data sources:

- `outputs/synapse_wx_dashboard_forecasts.csv` — 3,749 frozen May–August 2026 district-day hindcasts.
- `outputs/synapse_wx_dashboard_districts.geojson` — one polygon feature for each of Karnataka's 31 districts.

The app copies these ignored local outputs into `dashboard/public/data/` automatically before `npm run dev` and `npm run build`. The forecast datasets remain local and are not published in Git.
