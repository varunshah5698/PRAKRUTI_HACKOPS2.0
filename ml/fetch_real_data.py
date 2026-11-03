"""Build a real Mumbai training extract from OpenAQ v3 + Open-Meteo.

Source data:
  * Air quality: OpenAQ v3 hourly API (default) or the public OpenAQ S3 daily
    archive (`--source archive`) for CPCB/MPCB/BMC/IITM stations inside the
    Greater Mumbai boundary.
  * Weather: Open-Meteo ERA5 archive (reanalysis, not a station measurement).

The script never invents missing observations. Gaps stay NaN, units are
converted only with documented factors, and every conversion/QC rule is
recorded in the sidecar metadata file next to the CSV.

Usage:
    python fetch_real_data.py --start 2025-02-18 --end 2026-10-27
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CACHE = HERE / "data" / "raw"
BOUNDARY = ROOT / "server" / "data" / "mumbai-boundary.geojson"
OPENAQ = "https://api.openaq.org/v3"
_thread_local = threading.local()

POLLUTANTS = ("pm25", "pm10", "no2", "so2", "co", "o3")
# ppb -> ug/m3 at 25 C, 101.325 kPa (molar volume 24.45 L/mol).
PPB_TO_UGM3 = {"no2": 46.0055 / 24.45, "so2": 64.066 / 24.45, "o3": 47.998 / 24.45}
# CPCB publishes CO in mg/m3. OpenAQ labels the CO sensor "ppb" but the values
# are ppm: a co-located legacy CO sensor reported 640 ug/m3 where the new sensor
# reports 0.5, and 0.5 ppm * 1.145 = 0.57 mg/m3. Treat "ppb" CO as ppm.
CO_PPM_TO_MGM3 = 1.145

# Physical/plausibility bounds. Values outside are treated as sensor faults.
BOUNDS = {
    "pm25": (0.0, 1000.0),
    "pm10": (0.0, 2000.0),
    "no2": (0.0, 2000.0),
    "so2": (0.0, 2000.0),
    "co": (0.0, 50.0),
    "o3": (0.0, 1000.0),
    "temperature": (-5.0, 50.0),
    "humidity": (0.0, 100.0),
    "wind_speed": (0.0, 150.0),
    "wind_dir": (0.0, 360.0),
    "precipitation": (0.0, 500.0),
}

GOVERNMENT_OWNERS = ("MPCB", "BMC", "IITM", "CPCB", "MAHARASHTRA POLLUTION CONTROL BOARD")


def load_api_key() -> str:
    key = os.environ.get("OPENAQ_API_KEY", "").strip()
    if key:
        return key
    for name in (".env.local", ".env"):
        path = ROOT / name
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            if line.startswith("OPENAQ_API_KEY="):
                value = line.split("=", 1)[1].strip().strip('"').strip("'")
                if value:
                    return value
    raise SystemExit("OPENAQ_API_KEY is not set in the environment or .env.local.")


class Client:
    def __init__(self, api_key: str, cache: Path, min_interval: float = 1.1) -> None:
        self.api_key = api_key
        self.cache = cache
        self.min_interval = min_interval
        self.next_slot = 0.0
        self.requests = 0
        self._lock = threading.Lock()

    def _cached(self, path: Path) -> dict | None:
        if path.exists():
            try:
                return json.loads(path.read_text())
            except json.JSONDecodeError:
                return None
        return None

    def _reserve_slot(self) -> None:
        # Reserve a global start slot so concurrent workers stay under the
        # 60 requests/minute limit while still overlapping network latency.
        with self._lock:
            slot = max(time.monotonic(), self.next_slot)
            self.next_slot = slot + self.min_interval
        delay = slot - time.monotonic()
        if delay > 0:
            time.sleep(delay)

    def get(self, path: str, params: dict | None = None, cache_key: str | None = None) -> dict:
        cache_path = self.cache / cache_key if cache_key else None
        if cache_path:
            cached = self._cached(cache_path)
            if cached is not None:
                return cached
        url = OPENAQ + path + ("?" + urllib.parse.urlencode(params) if params else "")
        headers = {"X-API-Key": self.api_key, "Accept": "application/json"}
        for attempt in range(8):
            self._reserve_slot()
            try:
                request = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(request, timeout=90) as response:
                    payload = json.load(response)
                    with self._lock:
                        self.requests += 1
                if cache_path:
                    cache_path.parent.mkdir(parents=True, exist_ok=True)
                    cache_path.write_text(json.dumps(payload))
                return payload
            except urllib.error.HTTPError as error:
                if error.code == 429:
                    reset = int(error.headers.get("X-Ratelimit-Reset", "60") or 60)
                    time.sleep(max(5, reset) + attempt * 5)
                    continue
                if error.code == 422:
                    raise SystemExit(f"OpenAQ rejected the request: {url}\n{error.read().decode()[:300]}")
                raise
        raise RuntimeError(f"OpenAQ rate limit persisted for {url}")


def point_in_ring(lng: float, lat: float, ring: list) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def within_mumbai(lng: float, lat: float, boundary: dict) -> bool:
    for feature in boundary["features"]:
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for polygon in polygons:
            if point_in_ring(lng, lat, polygon[0]) and not any(
                point_in_ring(lng, lat, hole) for hole in polygon[1:]
            ):
                return True
    return False


def latest_age_days(value: str | None, now: datetime) -> float:
    if not value:
        return math.inf
    return (now - datetime.fromisoformat(value.replace("Z", "+00:00"))).total_seconds() / 86400


def sensor_key(sensor: dict) -> str:
    return f"{sensor['parameter']['name']}:{sensor['parameter']['units']}"


def converted_value(code: str, unit: str, value: float) -> tuple[float, str] | tuple[None, None]:
    unit = unit.replace("µg/m3", "µg/m³").replace("ug/m3", "µg/m³").replace("mg/m3", "mg/m³").strip()
    if code == "co":
        if unit == "µg/m³":
            return value / 1000.0, "legacy_mass"
        if unit == "mg/m³":
            return value, "legacy_mass"
        if unit == "ppb":
            return value * CO_PPM_TO_MGM3, "ppb_labelled_ppm"
        return None, None
    factor = PPB_TO_UGM3.get(code)
    if unit == "µg/m³":
        return value, "mass"
    if unit == "ppb" and factor:
        return value * factor, "ppb_converted"
    return None, None


def archive_url(location_id: int, day) -> str:
    return (
        "https://openaq-data-archive.s3.amazonaws.com/records/csv.gz/"
        f"locationid={location_id}/year={day.year}/month={day.month:02d}/"
        f"location-{location_id}-{day.year}{day.month:02d}{day.day:02d}.csv.gz"
    )


def fetch_archive_location(location_id: int, start: str, end: str, workers: int) -> pd.DataFrame:
    """Download the public OpenAQ daily archive files for one location.

    One daily file holds every sensor at the location, so this is much faster
    and less rate-limited than replaying the API page by page.
    """
    days = pd.date_range(start, end, freq="D", inclusive="left", tz="UTC")
    cache_dir = CACHE / "archive" / f"location_{location_id}"
    cache_dir.mkdir(parents=True, exist_ok=True)

    def download(day) -> Path:
        day = day.date()
        path = cache_dir / f"{day.isoformat()}.csv.gz"
        if path.exists():
            return path
        session = getattr(_thread_local, "session", None)
        if session is None:
            session = requests.Session()
            _thread_local.session = session
        for attempt in range(5):
            try:
                response = session.get(archive_url(location_id, day), timeout=90)
                if response.status_code == 404:
                    path.write_bytes(b"")
                    return path
                response.raise_for_status()
                path.write_bytes(response.content)
                return path
            except requests.RequestException:
                if attempt == 4:
                    raise
                time.sleep(1 + attempt * 2)
        return path

    frames = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        for path in executor.map(download, days):
            if path.stat().st_size == 0:
                continue
            try:
                frames.append(pd.read_csv(path, compression="gzip"))
            except Exception:
                path.unlink(missing_ok=True)
    if not frames:
        return pd.DataFrame(columns=["sensors_id", "datetime", "parameter", "units", "value"])
    frame = pd.concat(frames, ignore_index=True)
    frame["datetime"] = pd.to_datetime(frame["datetime"], utc=True)
    return frame


def archive_series(frame: pd.DataFrame, sensor_id: int, code: str, unit: str) -> tuple[pd.Series, dict]:
    quality = {"rows": 0, "out_of_bounds": 0, "bad_unit": 0, "low_coverage": 0}
    if frame.empty:
        return pd.Series(dtype=float, index=pd.DatetimeIndex([], tz="UTC")), quality
    rows = frame[frame["sensors_id"] == sensor_id].reset_index(drop=True)
    quality["rows"] = int(len(rows))
    if rows.empty:
        return pd.Series(dtype=float, index=pd.DatetimeIndex([], tz="UTC")), quality
    values = pd.to_numeric(rows["value"], errors="coerce")
    normalised = []
    method = None
    for value in values:
        if not np.isfinite(value):
            normalised.append(np.nan)
            continue
        converted, method = converted_value(code, unit, float(value))
        if converted is None:
            normalised.append(np.nan)
            quality["bad_unit"] += 1
            continue
        low, high = BOUNDS[code]
        if converted < low or converted > high:
            normalised.append(np.nan)
            quality["out_of_bounds"] += 1
            continue
        normalised.append(converted)
    if method:
        quality[f"method_{method}"] = int(np.isfinite(normalised).sum())
    hourly = pd.DataFrame({"hour": rows["datetime"].dt.floor("h"), "value": normalised}).dropna()
    if hourly.empty:
        return pd.Series(dtype=float, index=pd.DatetimeIndex([], tz="UTC")), quality
    grouped = hourly.groupby("hour")["value"].agg(["mean", "count"])
    # Keep hours with at least half the sensor's usual cadence; a single
    # 15-minute reading is not a valid hourly mean.
    if float(grouped["count"].median()) >= 2:
        before = len(grouped)
        grouped = grouped[grouped["count"] >= 2]
        quality["low_coverage"] += before - len(grouped)
    series = grouped["mean"].astype(float)
    if not isinstance(series.index, pd.DatetimeIndex):
        series.index = pd.DatetimeIndex([], tz="UTC")
    elif series.index.tz is None:
        series.index = series.index.tz_localize("UTC")
    return series.sort_index(), quality


def fetch_hours(client: Client, sensor_id: int, start: str, end: str) -> list[dict]:
    rows: list[dict] = []
    page = 1
    while page <= 60:
        payload = client.get(
            f"/sensors/{sensor_id}/hours",
            {
                "datetime_from": start,
                "datetime_to": end,
                "limit": 1000,
                "page": page,
            },
            cache_key=f"openaq/sensor_{sensor_id}/{start}_{end}/page_{page}.json",
        )
        results = payload.get("results", [])
        rows.extend(results)
        found = payload.get("meta", {}).get("found")
        if len(results) < 1000:
            break
        if isinstance(found, int) and page * 1000 >= found:
            break
        page += 1
    return rows


def series_from_hours(rows: list[dict], code: str, unit: str) -> tuple[pd.Series, dict]:
    records: dict[pd.Timestamp, list[float]] = {}
    quality: dict[str, int] = {"rows": 0, "low_coverage": 0, "out_of_bounds": 0, "bad_unit": 0}
    for row in rows:
        quality["rows"] += 1
        coverage = (row.get("coverage") or {}).get("percentComplete")
        if coverage is not None and float(coverage) < 50:
            quality["low_coverage"] += 1
            continue
        start = ((row.get("period") or {}).get("datetimeFrom") or {}).get("utc")
        value = row.get("value")
        if not start or value is None:
            continue
        # Hourly windows start on :15/:30/:45. Assign to the containing UTC hour.
        timestamp = pd.Timestamp(start).floor("h")
        value, method = converted_value(code, unit, float(value))
        if value is None:
            quality["bad_unit"] += 1
            continue
        low, high = BOUNDS[code]
        if not np.isfinite(value) or value < low or value > high:
            quality["out_of_bounds"] += 1
            continue
        records.setdefault(timestamp, []).append(value)
        quality[f"method_{method}"] = quality.get(f"method_{method}", 0) + 1
    series = pd.Series({timestamp: float(np.mean(values)) for timestamp, values in records.items()}, dtype=float)
    if not isinstance(series.index, pd.DatetimeIndex):
        series.index = pd.DatetimeIndex([], tz="UTC")
    elif series.index.tz is None:
        series.index = series.index.tz_localize("UTC")
    return series.sort_index(), quality


def fetch_weather(client_weather, lat: float, lng: float, start: str, end: str) -> pd.DataFrame:
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": f"{lat:.5f}",
        "longitude": f"{lng:.5f}",
        "start_date": start[:10],
        "end_date": end[:10],
        "hourly": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m",
        "wind_speed_unit": "kmh",
        "timezone": "UTC",
    }
    cache_path = client_weather / f"openmeteo/station_{lat:.5f}_{lng:.5f}_{start[:10]}_{end[:10]}.json"
    if cache_path.exists():
        payload = json.loads(cache_path.read_text())
    else:
        for attempt in range(5):
            try:
                response = requests.get(url, params=params, timeout=120)
                if response.status_code == 429:
                    time.sleep(20 + attempt * 20)
                    continue
                response.raise_for_status()
                payload = response.json()
                break
            except requests.RequestException:
                if attempt == 4:
                    raise
                time.sleep(5 * (attempt + 1))
        else:
            raise RuntimeError("Open-Meteo archive rate limit persisted")
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(payload))
    hourly = payload.get("hourly") or {}
    frame = pd.DataFrame(
        {
            "temperature": hourly.get("temperature_2m"),
            "humidity": hourly.get("relative_humidity_2m"),
            "precipitation": hourly.get("precipitation"),
            "wind_speed": hourly.get("wind_speed_10m"),
            "wind_dir": hourly.get("wind_direction_10m"),
        },
        index=pd.to_datetime(hourly.get("time", []), utc=True),
    )
    for column, (low, high) in BOUNDS.items():
        if column in frame:
            frame.loc[(frame[column] < low) | (frame[column] > high), column] = np.nan
    return frame


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2025-02-18T00:00:00Z")
    parser.add_argument("--end", default=(datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT00:00:00Z"))
    parser.add_argument("--output", type=Path, default=HERE / "data" / "mumbai_air_quality.csv")
    parser.add_argument("--metadata", type=Path, default=HERE / "data" / "mumbai_air_quality.meta.json")
    parser.add_argument("--min-pm25-coverage", type=float, default=0.30)
    parser.add_argument("--min-pm25-rows", type=int, default=2000)
    parser.add_argument("--max-stations", type=int, default=0, help="Smoke-test only: limit stations after selection.")
    parser.add_argument("--workers", type=int, default=4, help="Concurrent OpenAQ requests (rate limit is global).")
    parser.add_argument("--source", choices=("api", "archive"), default="api", help="Hourly API pages or the public S3 daily archive.")
    parser.add_argument("--archive-workers", type=int, default=24, help="Concurrent S3 daily-file downloads.")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()

    start, end = args.start, args.end
    CACHE.mkdir(parents=True, exist_ok=True)
    if args.refresh:
        # Refresh station/sensor discovery; historical pages stay cached.
        (CACHE / "openaq" / "locations.json").unlink(missing_ok=True)
        for path in (CACHE / "openaq").glob("latest_*.json"):
            path.unlink()
    client = Client(load_api_key(), CACHE)
    boundary = json.loads(BOUNDARY.read_text())
    now = datetime.now(timezone.utc)

    locations_payload = client.get(
        "/locations",
        {"bbox": "72.75,18.88,73.05,19.28", "limit": 100},
        cache_key="openaq/locations.json",
    )
    locations = []
    for location in locations_payload.get("results", []):
        coordinates = location.get("coordinates") or {}
        lat, lng = coordinates.get("latitude"), coordinates.get("longitude")
        if lat is None or lng is None or not within_mumbai(lng, lat, boundary):
            continue
        owner = ((location.get("owner") or {}).get("name") or "").upper()
        provider = ((location.get("provider") or {}).get("name") or "").upper()
        if not any(token in owner or token in provider for token in GOVERNMENT_OWNERS):
            continue
        if latest_age_days((location.get("datetimeLast") or {}).get("utc"), now) > 21:
            continue
        locations.append(location)

    print(f"{len(locations)} active government stations inside the Mumbai boundary")
    selected: list[dict] = []
    for location in locations:
        latest = client.get(f"/locations/{location['id']}/latest", cache_key=f"openaq/latest_{location['id']}.json")
        active = {
            row.get("sensorsId")
            for row in latest.get("results", [])
            if latest_age_days((row.get("datetime") or {}).get("utc"), now) <= 180
        }
        sensors = [sensor for sensor in location.get("sensors", []) if sensor.get("id") in active]
        by_pollutant: dict[str, list[dict]] = {}
        for sensor in sensors:
            code = str((sensor.get("parameter") or {}).get("name") or "").lower()
            if code in POLLUTANTS:
                by_pollutant.setdefault(code, []).append(sensor)
        latest_by_sensor = {
            row.get("sensorsId"): (row.get("datetime") or {}).get("utc")
            for row in latest.get("results", [])
        }
        chosen: dict[str, dict] = {}
        for code, options in by_pollutant.items():
            # Prefer the sensor that reported most recently; break ties by mass unit.
            options.sort(
                key=lambda sensor: (
                    latest_age_days(latest_by_sensor.get(sensor.get("id")), now),
                    str((sensor.get("parameter") or {}).get("units") or "") not in ("µg/m³", "ug/m3", "mg/m³"),
                    -(sensor.get("id") or 0),
                )
            )
            chosen[code] = options[0]
        if "pm25" not in chosen:
            continue
        selected.append({"location": location, "sensors": chosen, "latest": latest})

    print(f"{len(selected)} stations with an active PM2.5 sensor")

    expected = len(pd.date_range(start, end, freq="h", inclusive="left"))
    station_data: dict[int, dict] = {}

    if args.source == "archive":
        # Process one location at a time and keep only the small hourly series.
        # Holding every raw daily frame in memory is enough to OOM on 23 stations.
        for item in selected:
            location = item["location"]
            location_id = location["id"]
            print(f"  archive download {location_id} {location['name'][:48]}")
            frame = None
            for attempt in range(2):
                try:
                    frame = fetch_archive_location(location_id, start, end, args.archive_workers)
                    break
                except Exception as error:  # A single S3 failure must not discard the whole extract.
                    print(f"    attempt {attempt + 1} failed: {error}")
            if frame is None:
                frame = pd.DataFrame(columns=["sensors_id", "datetime", "parameter", "units", "value"])
            data = {
                "location": location,
                "sensors": item["sensors"],
                "series": {},
                "quality": {},
                "coverage": {},
            }
            for code, sensor in item["sensors"].items():
                series, quality = archive_series(frame, sensor["id"], code, sensor["parameter"]["units"])
                data["series"][code] = series
                data["quality"][code] = quality
                data["coverage"][code] = len(series) / expected if expected else 0.0
            station_data[location_id] = data
            print(
                f"  {location_id} {location['name'][:48]:48s} pm25 "
                f"{len(data['series'].get('pm25', [])):6d} rows ({data['coverage'].get('pm25', 0):5.1%})"
            )
            del frame
    else:
        # First pass: fetch PM2.5 so weak stations can be dropped before spending
        # rate limit on the other pollutants.
        def pm25_task(item: dict) -> tuple[int, dict]:
            location = item["location"]
            sensor = item["sensors"]["pm25"]
            rows = fetch_hours(client, sensor["id"], start, end)
            series, quality = series_from_hours(rows, "pm25", sensor["parameter"]["units"])
            coverage = len(series) / expected if expected else 0.0
            return location["id"], {
                "location": location,
                "sensors": item["sensors"],
                "series": {"pm25": series},
                "quality": {"pm25": quality},
                "coverage": {"pm25": coverage},
            }

        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
            for station_id, data in executor.map(pm25_task, selected):
                station_data[station_id] = data
                location = data["location"]
                series = data["series"]["pm25"]
                coverage = data["coverage"]["pm25"]
                print(f"  {location['id']} {location['name'][:48]:48s} pm25 {len(series):6d} rows ({coverage:5.1%})")

    keep = {
        station_id
        for station_id, data in station_data.items()
        if data["coverage"]["pm25"] >= args.min_pm25_coverage and len(data["series"]["pm25"]) >= args.min_pm25_rows
    }
    print(f"{len(keep)} stations pass PM2.5 coverage >= {args.min_pm25_coverage:.0%} and >= {args.min_pm25_rows} rows")
    if args.max_stations:
        keep = set(sorted(keep)[: args.max_stations])
        print(f"Smoke-test limit: {len(keep)} stations")
    if not keep:
        raise SystemExit("No station passed the PM2.5 coverage gate; refusing to write an empty extract.")

    if args.source == "api":
        tasks = [
            (station_id, code, sensor)
            for station_id in sorted(keep)
            for code, sensor in station_data[station_id]["sensors"].items()
            if code != "pm25"
        ]

        def pollutant_task(task: tuple[int, str, dict]) -> tuple[int, str, pd.Series, dict, float]:
            station_id, code, sensor = task
            rows = fetch_hours(client, sensor["id"], start, end)
            series, quality = series_from_hours(rows, code, sensor["parameter"]["units"])
            coverage = len(series) / expected if expected else 0.0
            return station_id, code, series, quality, coverage

        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
            for station_id, code, series, quality, coverage in executor.map(pollutant_task, tasks):
                data = station_data[station_id]
                location = data["location"]
                data["series"][code] = series
                data["quality"][code] = quality
                data["coverage"][code] = coverage
                print(f"  {location['id']} {code:5s} {len(series):6d} rows ({coverage:5.1%})")

    index = pd.date_range(start, end, freq="h", inclusive="left", tz="UTC")
    frames = []
    stations_meta = []
    for station_id in sorted(keep):
        data = station_data[station_id]
        location = data["location"]
        lat = location["coordinates"]["latitude"]
        lng = location["coordinates"]["longitude"]
        frame = pd.DataFrame(index=index)
        for code in POLLUTANTS:
            series = data["series"].get(code)
            if series is None:
                frame[code] = np.nan
            else:
                # A pollutant that is mostly zero is a stuck/failed sensor.
                if len(series) and float((series == 0).mean()) > 0.5:
                    series = series * np.nan
                    data["quality"].setdefault(code, {})["mostly_zero"] = 1
                frame[code] = series.reindex(index)
        try:
            weather = fetch_weather(CACHE, lat, lng, start, end).reindex(index)
        except Exception as error:  # Weather is required by the pipeline; fail loudly.
            raise SystemExit(f"Weather fetch failed for station {location['id']}: {error}")
        for column in ("temperature", "humidity", "wind_speed", "wind_dir", "precipitation"):
            frame[column] = weather[column]
        frame.insert(0, "timestamp", index)
        frame.insert(0, "station_id", f"OPENAQ-{location['id']}")
        frames.append(frame)
        stations_meta.append(
            {
                "station_id": f"OPENAQ-{location['id']}",
                "openaq_id": location["id"],
                "name": location["name"],
                "provider": (location.get("provider") or {}).get("name"),
                "owner": (location.get("owner") or {}).get("name"),
                "latitude": lat,
                "longitude": lng,
                "sensors": {
                    code: {
                        "id": sensor["id"],
                        "parameter": sensor["parameter"]["name"],
                        "unit": sensor["parameter"]["units"],
                        "conversion": converted_value(code, sensor["parameter"]["units"], 0.0)[1],
                    }
                    for code, sensor in data["sensors"].items()
                },
                "coverage": {code: round(value, 4) for code, value in data["coverage"].items()},
                "quality": data["quality"],
            }
        )

    output = pd.concat(frames).sort_values(["station_id", "timestamp"]).reset_index(drop=True)
    columns = ["station_id", "timestamp", *POLLUTANTS, "temperature", "humidity", "wind_speed", "wind_dir", "precipitation"]
    output = output[columns]
    output["timestamp"] = output["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False, na_rep="")
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()

    metadata = {
        "dataset": "Mumbai PM2.5 forecasting extract",
        "built_at": datetime.now(timezone.utc).isoformat(),
        "period": {"start": start, "end": end, "timezone": "UTC"},
        "sources": {
            "air_quality": (
                "OpenAQ S3 daily archive, raw station measurements aggregated to hourly means (provider CPCB; owners MPCB/BMC/IITM)"
                if args.source == "archive"
                else "OpenAQ v3 precomputed hourly measurements (provider CPCB; owners MPCB/BMC/IITM)"
            ),
            "weather": "Open-Meteo ERA5 archive reanalysis, not a station measurement",
        },
        "stations": stations_meta,
        "rows": int(len(output)),
        "non_null": {column: int(output[column].notna().sum()) for column in columns[2:]},
        "missing_fraction": {column: round(float(output[column].isna().mean()), 4) for column in columns[2:]},
        "unit_conversions": {
            "no2_ppb_to_ugm3": round(PPB_TO_UGM3["no2"], 4),
            "so2_ppb_to_ugm3": round(PPB_TO_UGM3["so2"], 4),
            "o3_ppb_to_ugm3": round(PPB_TO_UGM3["o3"], 4),
            "co_ppb_label_to_mgm3": CO_PPM_TO_MGM3,
            "co_note": "CPCB CO feed is mg/m3; OpenAQ labels it ppb but values are ppm (legacy co-located sensor cross-check).",
        },
        "qc": {
            "coverage_gate_per_hour": (
                "archived hours need >= 2 raw readings when the sensor cadence is sub-hourly"
                if args.source == "archive"
                else "OpenAQ percentComplete >= 50"
            ),
            "pm25_station_gate": f">= {args.min_pm25_coverage:.0%} hourly coverage and >= {args.min_pm25_rows} rows",
            "bounds": BOUNDS,
            "mostly_zero_pollutant_dropped": "> 50% zero values",
            "gaps": "left as NaN; no interpolation",
            "provider_filter": "station owner/provider contains MPCB, BMC, IITM or CPCB; location active within 21 days",
        },
        "sha256": digest,
        "attribution": "Data from OpenAQ (CPCB/MPCB/BMC/IITM) and Open-Meteo (ERA5). Check upstream licences before redistribution.",
    }
    args.metadata.write_text(json.dumps(metadata, indent=2))
    print(f"\nWrote {len(output):,} rows, {len(keep)} stations -> {args.output}")
    print(f"SHA-256 {digest}\nMetadata -> {args.metadata}")
    print(f"OpenAQ requests used in this run: {client.requests}")
    print(output.describe().T[["count", "mean", "min", "max"]])


if __name__ == "__main__":
    main()
