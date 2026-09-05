from __future__ import annotations

import hashlib
import math
import sqlite3
import uuid
from collections import defaultdict
from contextlib import closing
from datetime import datetime, time, timedelta, timezone
from math import fsum
from zoneinfo import ZoneInfo

from .blend import blend_forecasts
from .config import OperationalConfig
from .geography import District, load_districts, sample_district
from .open_meteo import PointForecast, fetch_points
from .store import hierarchical_historical_errors, initialize_database, write_cycle


def _select_district(config: OperationalConfig, selector: str) -> District:
    geography = config.data["geography"]
    districts = load_districts(config.resolve(geography["boundary_path"]), geography)
    matches = [district for district in districts if district.district_id.casefold() == selector.casefold() or district.name.casefold() == selector.casefold()]
    if len(matches) != 1:
        raise ValueError(f"District selector matched {len(matches)} districts")
    return matches[0]


def _daily_point_values(point: PointForecast, timezone_name: str, accumulation_start_hour: int) -> dict:
    zone = ZoneInfo(timezone_name)
    totals: dict = defaultdict(list)
    for timestamp, value in zip(point.times, point.precipitation):
        if value is None:
            continue
        local = datetime.fromisoformat(timestamp)
        if local.tzinfo is None:
            local = local.replace(tzinfo=zone)
        else:
            local = local.astimezone(zone)
        totals[(local - timedelta(hours=accumulation_start_hour)).date()].append(value)
    return {day: fsum(values) for day, values in totals.items()}


def _aggregate_source(points: tuple[PointForecast, ...], *, issue_local: datetime, lead_days: tuple[int, ...], minimum_coverage: float, timezone_name: str, accumulation_start_hour: int) -> dict[int, float | None]:
    daily = [_daily_point_values(point, timezone_name, accumulation_start_hour) for point in points]
    point_weights = [math.cos(math.radians(point.latitude)) for point in points]
    result = {}
    for lead in lead_days:
        valid_date = issue_local.date() + timedelta(days=lead)
        available = [(values[valid_date], weight) for values, weight in zip(daily, point_weights) if valid_date in values]
        coverage = len(available) / len(points) if points else 0.0
        result[lead] = fsum(value * weight for value, weight in available) / fsum(weight for _, weight in available) if available and coverage >= minimum_coverage else None
    return result


def _run_cycle(config: OperationalConfig, districts: tuple[District, ...]) -> dict:
    forecast_config = config.data["forecast"]
    blend_config = config.data["blend"]
    geography_config = config.data["geography"]
    zone = ZoneInfo(forecast_config["source_timezone"])
    retrieved_at = datetime.now(timezone.utc)
    issue_local = retrieved_at.astimezone(zone)
    cycle_id = uuid.uuid4().hex
    district_points = {district.district_id: sample_district(district, geography_config["sampling"]) for district in districts}
    raw_directory = config.resolve(config.data["storage"]["raw_response_directory"])
    cache_directory = config.resolve(forecast_config["request_cache_directory"])
    database_path = config.resolve(config.data["storage"]["database_path"])
    initialize_database(database_path)
    source_rows = []
    per_district_forecasts = {
        district.district_id: {lead: {} for lead in forecast_config["lead_days"]}
        for district in districts
    }
    for source in config.enabled_sources:
        batch_size = int(forecast_config["coordinate_batch_size"])
        flattened = [(district.district_id, point) for district in districts for point in district_points[district.district_id]]
        results_by_district: dict[str, list[PointForecast]] = defaultdict(list)
        for start in range(0, len(flattened), batch_size):
            batch = flattened[start:start + batch_size]
            results = fetch_points(source=source, coordinates=tuple(point for _, point in batch), forecast=forecast_config, raw_directory=raw_directory, cache_directory=cache_directory)
            for (district_id, _), result in zip(batch, results):
                results_by_district[district_id].append(result)
        for district in districts:
            point_results = tuple(results_by_district[district.district_id])
            aggregates = _aggregate_source(
                point_results,
                issue_local=issue_local,
                lead_days=tuple(forecast_config["lead_days"]),
                minimum_coverage=float(geography_config["sampling"]["minimum_coverage_fraction"]),
                timezone_name=forecast_config["source_timezone"],
                accumulation_start_hour=int(forecast_config["daily_accumulation_start_hour"]),
            )
            provenance_digest = hashlib.sha256("".join(sorted({point.response_sha256 for point in point_results})).encode()).hexdigest()
            for lead, value in aggregates.items():
                valid_date = issue_local.date() + timedelta(days=lead)
                valid_start_local = datetime.combine(valid_date, time(hour=int(forecast_config["daily_accumulation_start_hour"])), zone)
                valid_end_local = valid_start_local + timedelta(days=1)
                per_district_forecasts[district.district_id][lead][source["id"]] = value
                source_rows.append({
                    "cycle_id": cycle_id, "district_id": district.district_id,
                    "source_id": source["id"], "requested_model_id": source["api_model"],
                    "upstream_run_time_utc": None, "run_identity_status": "not_exposed_by_latest_endpoint",
                    "valid_start_utc": valid_start_local.astimezone(timezone.utc).isoformat(),
                    "valid_end_utc": valid_end_local.astimezone(timezone.utc).isoformat(),
                    "lead_days": lead, "precipitation_mm": value,
                    "raw_response_sha256": provenance_digest,
                })
    blend_rows = []
    statewide_ids = tuple(district.district_id for district in districts)
    regional_ids = {district.district_id: tuple(peer.district_id for peer in districts if peer.division == district.division) for district in districts}
    with closing(sqlite3.connect(database_path)) as connection:
        for district in districts:
            for lead, forecasts in per_district_forecasts[district.district_id].items():
                valid_date = issue_local.date() + timedelta(days=lead)
                valid_start_local = datetime.combine(valid_date, time(hour=int(forecast_config["daily_accumulation_start_hour"])), zone)
                valid_end_local = valid_start_local + timedelta(days=1)
                errors, hierarchy_fallback = hierarchical_historical_errors(
                    connection, district_id=district.district_id, region_district_ids=regional_ids[district.district_id], statewide_district_ids=statewide_ids, lead_days=lead,
                    source_ids=tuple(forecasts), available_before_utc=retrieved_at.isoformat(),
                    limit=int(blend_config["rolling_window_days"]),
                )
                blend = blend_forecasts(
                    forecasts, errors, power=float(blend_config["inverse_mae_power"]),
                    mae_floor=float(blend_config["mae_floor_mm"]),
                    minimum_sources=int(blend_config["minimum_sources_to_publish"]),
                )
                blend_rows.append({
                    "cycle_id": cycle_id, "district_id": district.district_id,
                    "valid_start_utc": valid_start_local.astimezone(timezone.utc).isoformat(),
                    "valid_end_utc": valid_end_local.astimezone(timezone.utc).isoformat(),
                    "lead_days": lead, "forecast_mm": blend.forecast_mm,
                    "status": blend.status, "fallback": blend.fallback or hierarchy_fallback,
                    "weights": blend.weights, "issued_at_utc": retrieved_at.isoformat(),
                })
    cycle = {"cycle_id": cycle_id, "retrieved_at_utc": retrieved_at.isoformat(), "configuration_sha256": config.sha256, "mode": config.data["project"]["mode"], "created_at_utc": retrieved_at.isoformat()}
    write_cycle(path=database_path, cycle=cycle, source_rows=source_rows, blend_rows=blend_rows)
    summary = {
        "cycle_id": cycle_id,
        "issued_at_utc": retrieved_at.isoformat(),
        "districts": len(districts),
        "sampling_points": sum(len(points) for points in district_points.values()),
        "source_rows": len(source_rows),
        "blend_rows": len(blend_rows),
        "complete_blends": sum(row["status"] == "complete" for row in blend_rows),
        "degraded_blends": sum(row["status"] == "degraded" for row in blend_rows),
        "insufficient_blends": sum(row["status"] == "insufficient_sources" for row in blend_rows),
    }
    if len(districts) == 1:
        summary.update({"district_id": districts[0].district_id, "district": districts[0].name, "blends": blend_rows})
    return summary


def run_district_cycle(config: OperationalConfig, district_selector: str) -> dict:
    return _run_cycle(config, (_select_district(config, district_selector),))


def run_statewide_cycle(config: OperationalConfig) -> dict:
    geography = config.data["geography"]
    districts = load_districts(config.resolve(geography["boundary_path"]), geography)
    return _run_cycle(config, districts)
