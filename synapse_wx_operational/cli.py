from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path

from .bootstrap import import_skill_history
from .archive import bootstrap_archived_skill, reconstruct_missing_cycles
from .config import load_config
from .evaluate import evaluate_cycle
from .export import export_cycle
from .imd_realtime import fetch_imd_district_rainfall
from .open_meteo import fetch_point
from .pipeline import run_district_cycle, run_statewide_cycle
from .store import initialize_database
from .verification import import_verification


def main() -> None:
    parser = argparse.ArgumentParser(description="SYNAPSE-WX operational pipeline")
    parser.add_argument("--config", type=Path, required=True)
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("validate-config")
    subcommands.add_parser("init-db")
    subcommands.add_parser("bootstrap-history")
    subcommands.add_parser("bootstrap-archived-skill")
    subcommands.add_parser("reconstruct-missing-cycles")
    fetch_parser = subcommands.add_parser("fetch-point")
    fetch_parser.add_argument("--source", required=True)
    fetch_parser.add_argument("--latitude", type=float, required=True)
    fetch_parser.add_argument("--longitude", type=float, required=True)
    district_parser = subcommands.add_parser("run-district")
    district_parser.add_argument("--district", required=True)
    subcommands.add_parser("run-statewide")
    export_parser = subcommands.add_parser("export-cycle")
    export_parser.add_argument("--cycle-id", required=True)
    evaluate_parser = subcommands.add_parser("evaluate-cycle")
    evaluate_parser.add_argument("--cycle-id", required=True)
    verification_parser = subcommands.add_parser("import-verification")
    verification_parser.add_argument("--file", type=Path, required=True)
    verification_parser.add_argument("--dry-run", action="store_true")
    imd_parser = subcommands.add_parser("fetch-imd")
    imd_parser.add_argument("--date", type=date.fromisoformat, required=True)
    ingest_imd_parser = subcommands.add_parser("ingest-imd")
    ingest_imd_parser.add_argument("--date", type=date.fromisoformat, required=True)
    subcommands.add_parser("ingest-latest-imd")
    args = parser.parse_args()
    config = load_config(args.config)
    if args.command == "validate-config":
        result = {
            "status": "pass",
            "schema_version": config.data["schema_version"],
            "configuration_sha256": config.sha256,
            "enabled_sources": [source["id"] for source in config.enabled_sources],
        }
    elif args.command == "init-db":
        database_path = config.resolve(config.data["storage"]["database_path"])
        initialize_database(database_path)
        result = {"status": "pass", "database": str(database_path), "configuration_sha256": config.sha256}
    elif args.command == "bootstrap-history":
        result = import_skill_history(config)
    elif args.command == "bootstrap-archived-skill":
        result = bootstrap_archived_skill(config)
    elif args.command == "reconstruct-missing-cycles":
        result = reconstruct_missing_cycles(config)
    elif args.command == "fetch-point":
        matching_sources = [source for source in config.enabled_sources if source["id"] == args.source]
        if len(matching_sources) != 1:
            parser.error(f"--source must name one enabled configured source: {[source['id'] for source in config.enabled_sources]}")
        point = fetch_point(
            source=matching_sources[0],
            latitude=args.latitude,
            longitude=args.longitude,
            forecast=config.data["forecast"],
            raw_directory=config.resolve(config.data["storage"]["raw_response_directory"]),
            cache_directory=config.resolve(config.data["forecast"]["request_cache_directory"]),
        )
        result = {
            "status": "pass",
            "source": point.source_id,
            "requested_model_id": point.requested_model_id,
            "hourly_rows": len(point.times),
            "first_valid_time": point.times[0] if point.times else None,
            "last_valid_time": point.times[-1] if point.times else None,
            "non_null_values": sum(value is not None for value in point.precipitation),
            "raw_response_sha256": point.response_sha256,
            "raw_path": str(point.raw_path),
        }
    elif args.command == "run-district":
        result = run_district_cycle(config, args.district)
    elif args.command == "run-statewide":
        result = run_statewide_cycle(config)
    elif args.command == "export-cycle":
        result = export_cycle(config, args.cycle_id)
    elif args.command == "evaluate-cycle":
        result = evaluate_cycle(config, args.cycle_id)
    elif args.command == "import-verification":
        result = import_verification(config, args.file, dry_run=args.dry_run)
    elif args.command == "fetch-imd":
        result = fetch_imd_district_rainfall(config, args.date)
    else:
        target_date = args.date if args.command == "ingest-imd" else datetime.now(ZoneInfo(config.data["forecast"]["source_timezone"])).date() - timedelta(days=int(config.data["imd_realtime"]["latest_available_day_offset"]))
        fetched = fetch_imd_district_rainfall(config, target_date)
        imported = import_verification(config, Path(fetched["district_csv_path"]))
        result = {"status": "pass", "fetch": fetched, "import": imported}
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
