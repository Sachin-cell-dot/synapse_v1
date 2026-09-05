# SYNAPSE-WX operational extension

The audited historical hindcast remains unchanged. Operational forecasts are a separate, append-only product with explicit provenance.

## Data flow

1. Load and validate a versioned configuration.
2. Determine a compatible forecast cycle for every enabled source.
3. Retrieve each source independently and preserve the raw response and its hash.
4. Aggregate matched precipitation intervals to configured district geometries.
5. Read only verification records available before issuance.
6. Calculate weights independently by district and lead time.
7. Persist source values, exact weights, configuration hash, status, and blended output immutably.
8. Add verification later without rewriting the issued forecast.

## Historical skill bootstrap

The audited historical master can seed operational skill through the configured `historical_bootstrap` contract. Imported rows live in a dedicated immutable skill-history table and retain the source artifact hash, provider, classification, availability time, and lead time. Re-importing an identical artifact is idempotent; a conflicting record aborts rather than overwriting history.

Only Day-1 forecasts exist in the current audited master. Consequently, Day 1 can use the rolling adaptive weights immediately, while Days 2–5 must remain equal-weight cold starts until lead-specific histories are available.

## Run identity limitation

The Open-Meteo latest-forecast endpoint does not provide enough metadata to infer an exact upstream initialization time safely. The operational collector must therefore either use an explicitly selected archived/single run or store the run time as null with `run_identity_status=not_exposed_by_endpoint`. Retrieval time must never be presented as model initialization time.

## Configuration boundary

Operational values live in validated configuration. Application code operates on configured collections; it does not assume three models, 31 districts, specific dates, or Karnataka-specific labels. Frozen scientific parameters remain configurable but versioned, and every issued forecast records the configuration hash.

## Verified vertical slice

The Open-Meteo adapter and a one-district cycle have been verified against live GFS, IFS HRES, and AIFS responses. District sampling is geometry-driven, coordinate retrieval is batched using a configured limit, daily accumulation uses the configured timezone and start hour, and the resulting source values and blends are stored append-only. The latest-forecast endpoint still does not expose a trustworthy upstream initialization time, so the stored run identity is explicitly marked unavailable rather than inferred.

The statewide command uses one issue identifier across all configured districts and writes no cycle until every retrieval and calculation has completed. API rate limits are handled through configured pacing, bounded exponential retry, and a short-lived request cache. Failed partial collections therefore do not appear as issued forecasts.

Before statewide scheduling, add routine verification ingestion, backfill Days 2–5 from lead-specific archived runs, and implement a cycle-selection policy using reproducible individual runs where available.
