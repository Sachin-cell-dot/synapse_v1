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

