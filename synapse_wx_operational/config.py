from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ConfigurationError(ValueError):
    """Raised when operational configuration is incomplete or inconsistent."""


@dataclass(frozen=True)
class OperationalConfig:
    path: Path
    root: Path
    data: dict[str, Any]
    sha256: str

    def resolve(self, configured_path: str) -> Path:
        candidate = Path(configured_path)
        return candidate if candidate.is_absolute() else self.root / candidate

    @property
    def enabled_sources(self) -> tuple[dict[str, Any], ...]:
        return tuple(source for source in self.data["forecast"]["sources"] if source["enabled"])


def _require(mapping: dict[str, Any], keys: tuple[str, ...], context: str) -> None:
    missing = [key for key in keys if key not in mapping]
    if missing:
        raise ConfigurationError(f"Missing {context} settings: {', '.join(missing)}")


def load_config(path: Path) -> OperationalConfig:
    path = path.resolve()
    raw = path.read_bytes()
    data = json.loads(raw)
    _require(data, ("schema_version", "project", "storage", "geography", "forecast", "blend", "verification", "imd_realtime", "historical_bootstrap", "archive"), "top-level")
    _require(data["storage"], ("database_path", "raw_response_directory", "export_directory"), "storage")
    if data["schema_version"] != 1:
        raise ConfigurationError(f"Unsupported schema_version: {data['schema_version']}")
    _require(data["forecast"], ("api_base_url", "hourly_variable", "source_timezone", "lead_days", "sources", "request_timeout_seconds", "request_attempts", "retry_backoff_seconds", "maximum_retry_wait_seconds", "request_interval_seconds", "request_cache_ttl_minutes", "request_cache_directory", "coordinate_batch_size", "user_agent"), "forecast")
    _require(data["blend"], ("rolling_window_days", "inverse_mae_power", "mae_floor_mm", "minimum_sources_to_publish"), "blend")
    sources = data["forecast"]["sources"]
    if not sources:
        raise ConfigurationError("At least one forecast source must be declared")
    ids = [source.get("id") for source in sources]
    if any(not source_id for source_id in ids) or len(ids) != len(set(ids)):
        raise ConfigurationError("Forecast source ids must be present and unique")
    for source in sources:
        _require(source, ("id", "label", "provider", "api_model", "enabled"), f"source {source.get('id', '<unknown>')}")
    leads = data["forecast"]["lead_days"]
    if not leads or any(not isinstance(day, int) or day < 0 for day in leads) or len(leads) != len(set(leads)):
        raise ConfigurationError("lead_days must contain unique non-negative integers")
    if data["forecast"]["request_timeout_seconds"] <= 0 or data["forecast"]["request_attempts"] <= 0 or data["forecast"]["retry_backoff_seconds"] < 0 or data["forecast"]["maximum_retry_wait_seconds"] <= 0 or data["forecast"]["request_interval_seconds"] < 0 or data["forecast"]["request_cache_ttl_minutes"] <= 0:
        raise ConfigurationError("Request timeout and attempts must be positive; retry backoff cannot be negative")
    if not isinstance(data["forecast"]["coordinate_batch_size"], int) or data["forecast"]["coordinate_batch_size"] <= 0:
        raise ConfigurationError("coordinate_batch_size must be a positive integer")
    if data["blend"]["rolling_window_days"] <= 0 or data["blend"]["inverse_mae_power"] <= 0 or data["blend"]["mae_floor_mm"] <= 0:
        raise ConfigurationError("Blending window, power, and MAE floor must be positive")
    enabled = [source for source in sources if source["enabled"]]
    if data["blend"]["minimum_sources_to_publish"] > len(enabled):
        raise ConfigurationError("minimum_sources_to_publish exceeds enabled source count")
    bootstrap = data["historical_bootstrap"]
    _require(bootstrap, ("path", "date_column", "district_id_column", "verification_column", "verification_provider", "verification_classification", "verification_availability_lag_hours", "lead_days", "source_columns"), "historical_bootstrap")
    unknown_bootstrap_sources = set(bootstrap["source_columns"]) - set(ids)
    if unknown_bootstrap_sources:
        raise ConfigurationError(f"Historical bootstrap references unknown sources: {sorted(unknown_bootstrap_sources)}")
    archive = data["archive"]
    _require(archive, ("previous_runs_api_base_url", "single_runs_api_base_url", "raw_response_directory", "request_cache_directory", "skill_classification", "reconstruction_mode", "reconstruction_lead_days", "run_cycle_hours_utc", "run_availability_lag_hours", "run_identity_status", "single_run_forecast_days"), "archive")
    if archive["reconstruction_lead_days"] not in leads:
        raise ConfigurationError("archive reconstruction_lead_days must be a configured forecast lead")
    run_hours = archive["run_cycle_hours_utc"]
    if not run_hours or len(run_hours) != len(set(run_hours)) or any(not isinstance(hour, int) or hour < 0 or hour > 23 for hour in run_hours):
        raise ConfigurationError("archive run_cycle_hours_utc must contain unique UTC hours from 0 to 23")
    if archive["run_availability_lag_hours"] < 0 or archive["single_run_forecast_days"] <= 0:
        raise ConfigurationError("archive run availability lag cannot be negative and forecast days must be positive")
    verification = data["verification"]
    _require(verification, ("provider", "classification", "unit", "date_column", "district_id_column", "value_column", "availability_time_column", "reject_unknown_districts"), "verification")
    imd = data["imd_realtime"]
    _require(imd, ("provider", "product", "download_url", "request_field", "request_date_format", "latest_available_day_offset", "user_agent", "request_timeout_seconds", "request_attempts", "retry_backoff_seconds", "raw_directory", "district_csv_directory", "grid"), "imd_realtime")
    _require(imd["grid"], ("longitude_count", "latitude_count", "longitude_start", "latitude_start", "spacing_degrees", "value_bytes", "byte_order", "missing_value", "minimum_valid_coverage_fraction"), "imd_realtime.grid")
    if not isinstance(imd["latest_available_day_offset"], int) or imd["latest_available_day_offset"] < 0:
        raise ConfigurationError("imd_realtime.latest_available_day_offset must be a non-negative integer")
    root = path.parent.parent if path.parent.name == "config" else path.parent
    return OperationalConfig(path=path, root=root, data=data, sha256=hashlib.sha256(raw).hexdigest())
