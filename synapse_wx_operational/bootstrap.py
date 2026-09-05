from __future__ import annotations

import csv
import hashlib
import sqlite3
from contextlib import closing
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .config import OperationalConfig
from .store import initialize_database


def import_skill_history(config: OperationalConfig) -> dict:
    settings = config.data["historical_bootstrap"]
    source_path = config.resolve(settings["path"])
    source_bytes = source_path.read_bytes()
    source_sha256 = hashlib.sha256(source_bytes).hexdigest()
    database_path = config.resolve(config.data["storage"]["database_path"])
    initialize_database(database_path)
    forecast_settings = config.data["forecast"]
    zone = ZoneInfo(forecast_settings["source_timezone"])
    accumulation_hour = int(forecast_settings["daily_accumulation_start_hour"])
    imported_at = datetime.now(timezone.utc).isoformat()
    source_columns = settings["source_columns"]
    required_columns = {settings["date_column"], settings["district_id_column"], settings["verification_column"], *source_columns.values()}
    inserted = 0
    unchanged = 0
    with source_path.open(newline="", encoding="utf-8-sig") as handle, closing(sqlite3.connect(database_path)) as connection, connection:
        reader = csv.DictReader(handle)
        missing = sorted(required_columns - set(reader.fieldnames or ()))
        if missing:
            raise ValueError(f"Historical bootstrap is missing configured columns: {missing}")
        for row in reader:
            valid_date = date.fromisoformat(row[settings["date_column"]])
            valid_start_local = datetime.combine(valid_date, time(hour=accumulation_hour), zone)
            valid_end_local = valid_start_local + timedelta(days=1)
            valid_start = valid_start_local.astimezone(timezone.utc).isoformat()
            valid_end = valid_end_local.astimezone(timezone.utc).isoformat()
            available_at = (valid_end_local + timedelta(hours=float(settings["verification_availability_lag_hours"]))).astimezone(timezone.utc).isoformat()
            district_id = str(row[settings["district_id_column"]])
            verification = float(row[settings["verification_column"]])
            for source_id, column in source_columns.items():
                if row[column] == "":
                    continue
                values = (
                    district_id, source_id, int(settings["lead_days"]), valid_start, valid_end,
                    float(row[column]), verification, settings["verification_provider"],
                    settings["verification_classification"], available_at, source_sha256, imported_at,
                )
                existing = connection.execute(
                    """SELECT forecast_mm,verification_mm,valid_end_utc,verification_classification,verification_available_at_utc,source_artifact_sha256
                       FROM skill_observations WHERE district_id=? AND source_id=? AND lead_days=? AND valid_start_utc=? AND verification_provider=?""",
                    (district_id, source_id, int(settings["lead_days"]), valid_start, settings["verification_provider"]),
                ).fetchone()
                expected = (values[5], values[6], values[4], values[8], values[9], values[10])
                if existing is not None:
                    if existing != expected:
                        raise RuntimeError(f"Immutable skill history conflict for {district_id}/{source_id}/{valid_start}")
                    unchanged += 1
                    continue
                connection.execute(
                    """INSERT INTO skill_observations(district_id,source_id,lead_days,valid_start_utc,valid_end_utc,forecast_mm,verification_mm,verification_provider,verification_classification,verification_available_at_utc,source_artifact_sha256,imported_at_utc)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                    values,
                )
                inserted += 1
    return {
        "status": "pass",
        "source_path": str(source_path),
        "source_sha256": source_sha256,
        "inserted": inserted,
        "unchanged": unchanged,
        "lead_days": int(settings["lead_days"]),
        "verification_provider": settings["verification_provider"],
    }
