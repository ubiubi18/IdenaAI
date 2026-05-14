#!/usr/bin/env python3
"""Build an IDNA minted-value-per-identity dataset and SVG chart.

Uses only public endpoints:
- Idena explorer API: https://api.idena.io/api/epochs
- CoinCodex documented API: https://coincodex.com/page/api/
"""

from __future__ import annotations

import argparse
import bisect
import csv
import json
import math
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


IDENA_API = "https://api.idena.io/api"
COINCODEX_API = "https://coincodex.com/api/coincodex"
USER_AGENT = "IdenaAI research script (public API use; contact: local user)"


@dataclass(frozen=True)
class PricePoint:
    ts: int
    price_usd: float


@dataclass(frozen=True)
class OutputRow:
    epoch: int
    validation_time: datetime
    identities: int
    minted_idna: Decimal
    burnt_idna: Decimal
    price_usd: float | None
    price_time: datetime | None
    price_distance_hours: float | None
    avg_minted_idna_per_identity: Decimal | None
    avg_minted_usd_per_identity: Decimal | None


def fetch_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read().decode("utf-8")
    return json.loads(body)


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def decimal_or_zero(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return Decimal("0")


def build_url(base: str, path: str, params: dict[str, Any] | None = None) -> str:
    url = f"{base.rstrip('/')}/{path.lstrip('/')}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    return url


def latest_completed_epoch() -> int:
    data = fetch_json(build_url(IDENA_API, "epochs", {"limit": 1}))
    latest = data["result"][0]
    epoch = int(latest["epoch"])
    validation_time = parse_dt(latest["validationTime"])
    identities = int(latest.get("validatedCount") or 0)
    if validation_time > datetime.now(timezone.utc) or identities <= 0:
        return epoch - 1
    return epoch


def fetch_epochs(start_epoch: int, limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    token: int | None = start_epoch
    remaining = limit
    while remaining > 0 and token is not None:
        batch_limit = min(remaining, 100)
        data = fetch_json(
            build_url(
                IDENA_API,
                "epochs",
                {"limit": batch_limit, "continuationToken": token},
            )
        )
        batch = data.get("result", [])
        rows.extend(batch)
        remaining -= len(batch)
        next_token = data.get("continuationToken")
        token = int(next_token) if next_token is not None else None
        if not batch:
            break
    return rows[:limit]


def daterange_chunks(start: date, end: date, days: int) -> list[tuple[date, date]]:
    del days  # Calendar quarters keep CoinCodex sampling stable across ranges.
    quarter_start_month = ((start.month - 1) // 3) * 3 + 1
    cursor = date(start.year, quarter_start_month, 1)
    today = datetime.now(timezone.utc).date()
    effective_end = min(end, today)
    chunks: list[tuple[date, date]] = []
    while cursor <= effective_end:
        if cursor.month == 10:
            next_cursor = date(cursor.year + 1, 1, 1)
        else:
            next_cursor = date(cursor.year, cursor.month + 3, 1)
        chunk_end = min(next_cursor - timedelta(days=1), today)
        chunks.append((cursor, chunk_end))
        cursor = next_cursor
    return chunks


def fetch_price_points(start: date, end: date) -> list[PricePoint]:
    # CoinCodex currently caps responses around 600 samples. Calendar-quarter
    # chunks keep samples close to each epoch and stable across requested ranges.
    points_by_ts: dict[int, PricePoint] = {}
    for chunk_start, chunk_end in daterange_chunks(start, end, 120):
        path = (
            "get_coin_history/IDNA/"
            f"{chunk_start.isoformat()}/{chunk_end.isoformat()}/600"
        )
        data = fetch_json(build_url(COINCODEX_API, path))
        for item in data.get("IDNA", []) if isinstance(data, dict) else []:
            if len(item) >= 2:
                point = PricePoint(ts=int(item[0]), price_usd=float(item[1]))
                points_by_ts[point.ts] = point
        time.sleep(0.2)
    points = sorted(points_by_ts.values(), key=lambda p: p.ts)
    if not points:
        raise RuntimeError("No CoinCodex price samples were returned")
    return points


def nearest_price(points: list[PricePoint], when: datetime) -> tuple[PricePoint, float]:
    target = int(when.timestamp())
    timestamps = [point.ts for point in points]
    idx = bisect.bisect_left(timestamps, target)
    candidates = []
    if idx < len(points):
        candidates.append(points[idx])
    if idx > 0:
        candidates.append(points[idx - 1])
    point = min(candidates, key=lambda p: abs(p.ts - target))
    distance_hours = abs(point.ts - target) / 3600
    return point, distance_hours


def build_rows(
    epoch_rows: list[dict[str, Any]],
    price_points: list[PricePoint],
    max_price_distance_hours: float,
) -> list[OutputRow]:
    output: list[OutputRow] = []
    for row in epoch_rows:
        validation_time = parse_dt(row["validationTime"])
        identities = int(row.get("validatedCount") or 0)
        minted = decimal_or_zero(row.get("coins", {}).get("minted"))
        burnt = decimal_or_zero(row.get("coins", {}).get("burnt"))

        avg_idna = minted / Decimal(identities) if identities > 0 else None
        point, distance_hours = nearest_price(price_points, validation_time)
        if distance_hours <= max_price_distance_hours:
            price_usd: float | None = point.price_usd
            price_dt: datetime | None = datetime.fromtimestamp(point.ts, timezone.utc)
            price_distance: float | None = distance_hours
            avg_usd = (
                avg_idna * Decimal(str(point.price_usd))
                if avg_idna is not None
                else None
            )
        else:
            price_usd = None
            price_dt = None
            price_distance = None
            avg_usd = None
        output.append(
            OutputRow(
                epoch=int(row["epoch"]),
                validation_time=validation_time,
                identities=identities,
                minted_idna=minted,
                burnt_idna=burnt,
                price_usd=price_usd,
                price_time=price_dt,
                price_distance_hours=price_distance,
                avg_minted_idna_per_identity=avg_idna,
                avg_minted_usd_per_identity=avg_usd,
            )
        )
    return sorted(output, key=lambda item: item.epoch)


def decimal_to_str(value: Decimal | None, places: int = 12) -> str:
    if value is None:
        return ""
    quant = Decimal(1).scaleb(-places)
    return format(value.quantize(quant), "f")


def write_csv(rows: list[OutputRow], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "epoch",
                "validation_time_utc",
                "validation_date_utc",
                "validated_identities",
                "minted_idna",
                "burnt_idna",
                "idna_price_usd",
                "price_timestamp_utc",
                "price_distance_hours",
                "avg_minted_idna_per_identity",
                "avg_minted_usd_per_identity",
            ]
        )
        for row in rows:
            writer.writerow(
                [
                    row.epoch,
                    row.validation_time.isoformat().replace("+00:00", "Z"),
                    row.validation_time.date().isoformat(),
                    row.identities,
                    decimal_to_str(row.minted_idna, 18),
                    decimal_to_str(row.burnt_idna, 18),
                    "" if row.price_usd is None else f"{row.price_usd:.12f}",
                    ""
                    if row.price_time is None
                    else row.price_time.isoformat().replace("+00:00", "Z"),
                    ""
                    if row.price_distance_hours is None
                    else f"{row.price_distance_hours:.2f}",
                    decimal_to_str(row.avg_minted_idna_per_identity, 12),
                    decimal_to_str(row.avg_minted_usd_per_identity, 12),
                ]
            )


def nice_ticks(max_value: float, count: int = 5) -> list[float]:
    if max_value <= 0:
        return [0]
    raw_step = max_value / count
    magnitude = 10 ** math.floor(math.log10(raw_step))
    residual = raw_step / magnitude
    if residual <= 1:
        step = magnitude
    elif residual <= 2:
        step = 2 * magnitude
    elif residual <= 5:
        step = 5 * magnitude
    else:
        step = 10 * magnitude
    top = math.ceil(max_value / step) * step
    ticks = []
    value = 0.0
    while value <= top + step / 2:
        ticks.append(value)
        value += step
    return ticks


def svg_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def format_money(value: float) -> str:
    if value >= 1000:
        return f"${value:,.0f}"
    if value >= 1:
        return f"${value:,.2f}"
    return f"${value:.4f}"


def format_count(value: float) -> str:
    return f"{value:,.0f}"


def write_svg(rows: list[OutputRow], path: Path) -> None:
    chart_rows = [r for r in rows if r.avg_minted_usd_per_identity is not None]
    if len(chart_rows) < 2:
        raise RuntimeError("Need at least two rows with values to draw chart")

    width = 1400
    height = 760
    left = 105
    right = 92
    top = 118
    bottom = 118
    plot_w = width - left - right
    plot_h = height - top - bottom
    values = [float(r.avg_minted_usd_per_identity or 0) for r in chart_rows]
    y_ticks = nice_ticks(max(values) * 1.05, 5)
    y_max = y_ticks[-1] if y_ticks else max(values)
    identity_values = [r.identities for r in chart_rows]
    identity_ticks = nice_ticks(max(identity_values) * 1.05, 5)
    identity_max = identity_ticks[-1] if identity_ticks else max(identity_values)

    def x_pos(index: int) -> float:
        return left + (index / (len(chart_rows) - 1)) * plot_w

    def y_pos(value: float) -> float:
        return top + plot_h - (value / y_max) * plot_h

    def identity_y_pos(value: float) -> float:
        return top + plot_h - (value / identity_max) * plot_h

    def trend_color(index: int) -> str:
        if index <= 0:
            return "#64748b"
        previous = chart_rows[index - 1].identities
        current = chart_rows[index].identities
        if current > previous:
            return "#198754"
        if current < previous:
            return "#d33f49"
        return "#64748b"

    points = [(x_pos(i), y_pos(v)) for i, v in enumerate(values)]
    identity_points = [
        (x_pos(i), identity_y_pos(v)) for i, v in enumerate(identity_values)
    ]
    identity_line_path = " ".join(f"{x:.2f},{y:.2f}" for x, y in identity_points)
    area_path = (
        f"M {points[0][0]:.2f},{top + plot_h:.2f} "
        + " ".join(f"L {x:.2f},{y:.2f}" for x, y in points)
        + f" L {points[-1][0]:.2f},{top + plot_h:.2f} Z"
    )

    max_row = max(chart_rows, key=lambda r: float(r.avg_minted_usd_per_identity or 0))
    min_row = min(chart_rows, key=lambda r: float(r.avg_minted_usd_per_identity or 0))
    latest_row = chart_rows[-1]
    summary_line_1 = (
        f"Epochs {chart_rows[0].epoch}-{chart_rows[-1].epoch}, "
        f"{chart_rows[0].validation_time.date()} to {chart_rows[-1].validation_time.date()} UTC."
    )
    summary_line_2 = "Metric: (minted IDNA / validated identities) * nearest IDNA/USD price sample."

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<style>",
        "text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;fill:#172033}",
        ".title{font-size:30px;font-weight:700}.subtitle{font-size:15px;fill:#5f6f86}",
        ".axis{font-size:13px;fill:#5f6f86}.grid{stroke:#e2e8f0;stroke-width:1}",
        ".value-segment{fill:none;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}",
        ".identity-line{fill:none;stroke:#6f42c1;stroke-width:1.4;stroke-linejoin:round;stroke-linecap:round;opacity:.78}",
        ".dot{stroke:white;stroke-width:1.5}.note{font-size:12px;fill:#6b7280}",
        ".callout{font-size:13px;fill:#243145;font-weight:600}",
        ".legend{font-size:13px;fill:#38465a}",
        "</style>",
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
        '<text class="title" x="52" y="44">IDNA Minted Value per Validated Identity</text>',
        f'<text class="subtitle" x="52" y="70">{svg_escape(summary_line_1)}</text>',
        f'<text class="subtitle" x="52" y="91">{svg_escape(summary_line_2)}</text>',
        '<line x1="845" y1="38" x2="875" y2="38" stroke="#198754" stroke-width="4" stroke-linecap="round"/>',
        '<text class="legend" x="884" y="42">identity count grew</text>',
        '<line x1="1018" y1="38" x2="1048" y2="38" stroke="#d33f49" stroke-width="4" stroke-linecap="round"/>',
        '<text class="legend" x="1057" y="42">identity count declined</text>',
        '<line x1="845" y1="60" x2="875" y2="60" stroke="#6f42c1" stroke-width="1.4" stroke-linecap="round"/>',
        '<text class="legend" x="884" y="64">validated identities (right axis)</text>',
        f'<rect x="{left}" y="{top}" width="{plot_w}" height="{plot_h}" fill="#f8fafc" stroke="#d8e0ea"/>',
    ]

    for tick in y_ticks:
        y = y_pos(tick)
        parts.append(f'<line class="grid" x1="{left}" x2="{left + plot_w}" y1="{y:.2f}" y2="{y:.2f}"/>')
        parts.append(f'<text class="axis" x="{left - 12}" y="{y + 4:.2f}" text-anchor="end">{format_money(tick)}</text>')

    for tick in identity_ticks:
        y = identity_y_pos(tick)
        parts.append(f'<text class="axis" x="{left + plot_w + 12}" y="{y + 4:.2f}" text-anchor="start">{format_count(tick)}</text>')

    x_label_count = 10
    for i in range(x_label_count + 1):
        idx = round(i * (len(chart_rows) - 1) / x_label_count)
        row = chart_rows[idx]
        x = x_pos(idx)
        label = f"#{row.epoch}"
        date_label = row.validation_time.date().isoformat()
        parts.append(f'<line class="grid" x1="{x:.2f}" x2="{x:.2f}" y1="{top}" y2="{top + plot_h}"/>')
        parts.append(f'<text class="axis" x="{x:.2f}" y="{top + plot_h + 25}" text-anchor="middle">{label}</text>')
        parts.append(f'<text class="axis" x="{x:.2f}" y="{top + plot_h + 43}" text-anchor="middle">{date_label}</text>')

    parts.append(f'<path d="{area_path}" fill="#1f77b4" opacity="0.14"/>')
    parts.append(f'<polyline class="identity-line" points="{identity_line_path}"/>')
    for i in range(1, len(points)):
        x1, y1 = points[i - 1]
        x2, y2 = points[i]
        parts.append(
            f'<path class="value-segment" d="M {x1:.2f},{y1:.2f} L {x2:.2f},{y2:.2f}" stroke="{trend_color(i)}"/>'
        )

    for i, (x, y) in enumerate(points):
        if i % 3 == 0 or i in (0, len(points) - 1):
            row = chart_rows[i]
            tooltip = (
                f"Epoch {row.epoch}: "
                f"{format_money(float(row.avg_minted_usd_per_identity or 0))} "
                f"({row.validation_time.date()}, identities {row.identities})"
            )
            parts.append(f'<circle class="dot" cx="{x:.2f}" cy="{y:.2f}" r="3.2" fill="{trend_color(i)}"><title>{svg_escape(tooltip)}</title></circle>')

    def callout(row: OutputRow, label: str, y_offset: int) -> None:
        idx = chart_rows.index(row)
        x = x_pos(idx)
        y = y_pos(float(row.avg_minted_usd_per_identity or 0))
        value = format_money(float(row.avg_minted_usd_per_identity or 0))
        anchor = "start" if x < width * 0.62 else "end"
        text_x = x + (10 if anchor == "start" else -10)
        parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="5.5" fill="#243145" stroke="white" stroke-width="2"/>')
        parts.append(f'<text class="callout" x="{text_x:.2f}" y="{y + y_offset:.2f}" text-anchor="{anchor}">{label}: {value} at epoch {row.epoch}</text>')

    callout(max_row, "High", -10)
    callout(min_row, "Low", 20)
    callout(latest_row, "Latest", -18)

    parts.extend(
        [
            f'<text class="axis" x="{left + plot_w / 2:.2f}" y="{height - 36}" text-anchor="middle">Epoch validation date / epoch number</text>',
            f'<text class="axis" transform="translate(28 {top + plot_h / 2:.2f}) rotate(-90)" text-anchor="middle">Average minted value per validated identity, USD</text>',
            f'<text class="axis" transform="translate({width - 22} {top + plot_h / 2:.2f}) rotate(90)" text-anchor="middle">Validated identities</text>',
            '<text class="note" x="52" y="724">Sources: api.idena.io public explorer API; CoinCodex documented non-commercial historical API.</text>',
            '<text class="note" x="52" y="742">CoinGecko free API was checked but not used for this range because it returned a 365-day historical limit error.</text>',
            "</svg>",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(parts), encoding="utf-8")


def write_summary(rows: list[OutputRow], path: Path) -> None:
    priced_rows = [r for r in rows if r.avg_minted_usd_per_identity is not None]
    if not priced_rows:
        content = [
            "# IDNA Epoch Minted Value Analysis",
            "",
            f"- Epoch range: {rows[0].epoch} to {rows[-1].epoch} ({len(rows)} completed epochs)",
            f"- Date range: {rows[0].validation_time.date()} to {rows[-1].validation_time.date()} UTC",
            "- No nearby free historical IDNA/USD price samples were found for this epoch range.",
            "",
        ]
        path.write_text("\n".join(content), encoding="utf-8")
        return

    values = [float(r.avg_minted_usd_per_identity or 0) for r in priced_rows]
    prices = [r.price_distance_hours for r in rows if r.price_distance_hours is not None]
    high = max(priced_rows, key=lambda r: float(r.avg_minted_usd_per_identity or 0))
    low = min(priced_rows, key=lambda r: float(r.avg_minted_usd_per_identity or 0))
    latest = priced_rows[-1]
    missing_price_count = len(rows) - len(priced_rows)
    content = [
        "# IDNA Epoch Minted Value Analysis",
        "",
        f"- Epoch range: {rows[0].epoch} to {rows[-1].epoch} ({len(rows)} completed epochs)",
        f"- Date range: {rows[0].validation_time.date()} to {rows[-1].validation_time.date()} UTC",
        f"- Priced epochs: {len(priced_rows)}",
        f"- Epochs without nearby free price data: {missing_price_count}",
        "- Formula: `(minted IDNA / validated identities) * nearest IDNA/USD historical price`",
        f"- Latest priced value: ${float(latest.avg_minted_usd_per_identity or 0):.4f} at epoch {latest.epoch}",
        f"- High value: ${float(high.avg_minted_usd_per_identity or 0):.4f} at epoch {high.epoch}",
        f"- Low value: ${float(low.avg_minted_usd_per_identity or 0):.4f} at epoch {low.epoch}",
        f"- Median value: ${sorted(values)[len(values) // 2]:.4f}",
        f"- Maximum price-sample distance: {max(prices):.2f} hours",
        "",
        "Sources:",
        "- Idena explorer API: https://api.idena.io/api/epochs",
        "- CoinCodex API documentation: https://coincodex.com/page/api/",
        "",
        "Note: CoinGecko public API was checked but returned a 365-day historical range limit for the full requested span.",
        "",
    ]
    path.write_text("\n".join(content), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--start-epoch", type=int)
    parser.add_argument("--max-price-distance-hours", type=float, default=36)
    parser.add_argument("--out-dir", type=Path, default=Path("output/idna_epoch_value_analysis"))
    args = parser.parse_args()

    if args.epochs < 1:
        raise SystemExit("--epochs must be at least 1")
    if args.max_price_distance_hours <= 0:
        raise SystemExit("--max-price-distance-hours must be positive")

    start_epoch = args.start_epoch if args.start_epoch is not None else latest_completed_epoch()
    raw_epochs = fetch_epochs(start_epoch, args.epochs)
    if not raw_epochs:
        raise SystemExit("No epochs returned by the Idena API")
    min_dt = min(parse_dt(row["validationTime"]) for row in raw_epochs)
    max_dt = max(parse_dt(row["validationTime"]) for row in raw_epochs)
    price_points = fetch_price_points(
        min_dt.date() - timedelta(days=1),
        max_dt.date() + timedelta(days=1),
    )
    rows = build_rows(raw_epochs, price_points, args.max_price_distance_hours)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    suffix = f"epochs_{rows[0].epoch:03d}_{rows[-1].epoch:03d}"
    csv_path = args.out_dir / f"idna_epoch_minted_value_{suffix}.csv"
    svg_path = args.out_dir / f"idna_minted_value_per_identity_{suffix}.svg"
    summary_path = args.out_dir / f"idna_epoch_minted_value_{suffix}.md"
    write_csv(rows, csv_path)
    write_svg(rows, svg_path)
    write_summary(rows, summary_path)

    print(f"Wrote {csv_path}")
    print(f"Wrote {svg_path}")
    print(f"Wrote {summary_path}")
    print(f"Epochs: {rows[0].epoch}-{rows[-1].epoch}")
    print(
        "Priced epochs: "
        f"{sum(1 for row in rows if row.avg_minted_usd_per_identity is not None)}"
    )


if __name__ == "__main__":
    main()
