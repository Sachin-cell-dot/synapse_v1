from __future__ import annotations

import sqlite3
import json
from collections.abc import Mapping, Sequence
from contextlib import closing
from pathlib import Path


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS forecast_cycles (
    cycle_id TEXT PRIMARY KEY,
    retrieved_at_utc TEXT NOT NULL,
    configuration_sha256 TEXT NOT NULL,
    mode TEXT NOT NULL,
    created_at_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_forecasts (
    cycle_id TEXT NOT NULL REFERENCES forecast_cycles(cycle_id),
    district_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    requested_model_id TEXT NOT NULL,
    upstream_run_time_utc TEXT,
    run_identity_status TEXT NOT NULL,
    valid_start_utc TEXT NOT NULL,
    valid_end_utc TEXT NOT NULL,
    lead_days INTEGER NOT NULL,
    precipitation_mm REAL,
    raw_response_sha256 TEXT NOT NULL,
    PRIMARY KEY (cycle_id, district_id, source_id, valid_start_utc, valid_end_utc)
);
CREATE TABLE IF NOT EXISTS blended_forecasts (
    cycle_id TEXT NOT NULL REFERENCES forecast_cycles(cycle_id),
    district_id TEXT NOT NULL,
    valid_start_utc TEXT NOT NULL,
    valid_end_utc TEXT NOT NULL,
    lead_days INTEGER NOT NULL,
    forecast_mm REAL,
    status TEXT NOT NULL,
    fallback TEXT,
    weights_json TEXT NOT NULL,
    issued_at_utc TEXT NOT NULL,
    PRIMARY KEY (cycle_id, district_id, valid_start_utc, valid_end_utc)
);
CREATE TABLE IF NOT EXISTS verification (
    district_id TEXT NOT NULL,
    valid_start_utc TEXT NOT NULL,
    valid_end_utc TEXT NOT NULL,
    value_mm REAL NOT NULL,
    provider TEXT NOT NULL,
    classification TEXT NOT NULL,
    available_at_utc TEXT NOT NULL,
    raw_response_sha256 TEXT NOT NULL,
    PRIMARY KEY (district_id, valid_start_utc, valid_end_utc, provider)
);
CREATE TABLE IF NOT EXISTS skill_observations (
    district_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    lead_days INTEGER NOT NULL,
    valid_start_utc TEXT NOT NULL,
    valid_end_utc TEXT NOT NULL,
    forecast_mm REAL NOT NULL,
    verification_mm REAL NOT NULL,
    verification_provider TEXT NOT NULL,
    verification_classification TEXT NOT NULL,
    verification_available_at_utc TEXT NOT NULL,
    source_artifact_sha256 TEXT NOT NULL,
    imported_at_utc TEXT NOT NULL,
    PRIMARY KEY (district_id, source_id, lead_days, valid_start_utc, verification_provider)
);
"""


def initialize_database(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as connection, connection:
        connection.executescript(SCHEMA)


def historical_errors(connection: sqlite3.Connection, *, district_id: str, lead_days: int, source_ids: Sequence[str], available_before_utc: str, limit: int) -> dict[str, list[float]]:
    result = {}
    for source_id in source_ids:
        rows = connection.execute(
            """
            SELECT absolute_error FROM (
                SELECT sf.valid_start_utc AS valid_start, ABS(sf.precipitation_mm - v.value_mm) AS absolute_error
                FROM source_forecasts sf
                JOIN verification v
                  ON v.district_id = sf.district_id
                 AND v.valid_start_utc = sf.valid_start_utc
                 AND v.valid_end_utc = sf.valid_end_utc
                WHERE sf.district_id = ? AND sf.source_id = ? AND sf.lead_days = ?
                  AND sf.precipitation_mm IS NOT NULL AND v.available_at_utc < ?
                UNION ALL
                SELECT valid_start_utc AS valid_start, ABS(forecast_mm - verification_mm) AS absolute_error
                FROM skill_observations
                WHERE district_id = ? AND source_id = ? AND lead_days = ?
                  AND verification_available_at_utc < ?
            )
            ORDER BY valid_start DESC
            LIMIT ?
            """,
            (district_id, source_id, lead_days, available_before_utc, district_id, source_id, lead_days, available_before_utc, limit),
        ).fetchall()
        result[source_id] = [float(row[0]) for row in reversed(rows)]
    return result


def hierarchical_historical_errors(connection: sqlite3.Connection, *, district_id: str, region_district_ids: Sequence[str], statewide_district_ids: Sequence[str], lead_days: int, source_ids: Sequence[str], available_before_utc: str, limit: int) -> tuple[dict[str, list[float]], str | None]:
    scopes = (
        ("district", (district_id,)),
        ("regional", tuple(dict.fromkeys(region_district_ids))),
        ("statewide", tuple(dict.fromkeys(statewide_district_ids))),
    )
    last = {source_id: [] for source_id in source_ids}
    for level, district_ids in scopes:
        if not district_ids:
            continue
        placeholders = ",".join("?" for _ in district_ids)
        result = {}
        for source_id in source_ids:
            query = f"""
                SELECT absolute_error FROM (
                    SELECT sf.valid_start_utc AS valid_start, ABS(sf.precipitation_mm-v.value_mm) AS absolute_error
                    FROM source_forecasts sf JOIN verification v
                      ON v.district_id=sf.district_id AND v.valid_start_utc=sf.valid_start_utc AND v.valid_end_utc=sf.valid_end_utc
                    WHERE sf.district_id IN ({placeholders}) AND sf.source_id=? AND sf.lead_days=?
                      AND sf.precipitation_mm IS NOT NULL AND v.available_at_utc < ?
                    UNION ALL
                    SELECT valid_start_utc, ABS(forecast_mm-verification_mm)
                    FROM skill_observations
                    WHERE district_id IN ({placeholders}) AND source_id=? AND lead_days=?
                      AND verification_available_at_utc < ?
                ) ORDER BY valid_start DESC LIMIT ?
            """
            params = (*district_ids, source_id, lead_days, available_before_utc, *district_ids, source_id, lead_days, available_before_utc, limit * len(district_ids))
            result[source_id] = [float(row[0]) for row in reversed(connection.execute(query, params).fetchall())]
        last = result
        if all(result.get(source_id) for source_id in source_ids):
            return result, None if level == "district" else f"{level}_lead_skill_fallback"
    return last, None


def write_cycle(*, path: Path, cycle: Mapping, source_rows: Sequence[Mapping], blend_rows: Sequence[Mapping]) -> None:
    initialize_database(path)
    with closing(sqlite3.connect(path)) as connection, connection:
        connection.execute(
            "INSERT INTO forecast_cycles(cycle_id,retrieved_at_utc,configuration_sha256,mode,created_at_utc) VALUES(?,?,?,?,?)",
            (cycle["cycle_id"], cycle["retrieved_at_utc"], cycle["configuration_sha256"], cycle["mode"], cycle["created_at_utc"]),
        )
        connection.executemany(
            """INSERT INTO source_forecasts(cycle_id,district_id,source_id,requested_model_id,upstream_run_time_utc,run_identity_status,valid_start_utc,valid_end_utc,lead_days,precipitation_mm,raw_response_sha256)
               VALUES(:cycle_id,:district_id,:source_id,:requested_model_id,:upstream_run_time_utc,:run_identity_status,:valid_start_utc,:valid_end_utc,:lead_days,:precipitation_mm,:raw_response_sha256)""",
            source_rows,
        )
        connection.executemany(
            """INSERT INTO blended_forecasts(cycle_id,district_id,valid_start_utc,valid_end_utc,lead_days,forecast_mm,status,fallback,weights_json,issued_at_utc)
               VALUES(:cycle_id,:district_id,:valid_start_utc,:valid_end_utc,:lead_days,:forecast_mm,:status,:fallback,:weights_json,:issued_at_utc)""",
            [{**row, "weights_json": json.dumps(row["weights"], sort_keys=True, separators=(",", ":"))} for row in blend_rows],
        )
