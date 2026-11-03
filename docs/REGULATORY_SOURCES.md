# Regulatory Sources

The platform stores reference standards with document, section, unit, averaging period and applicability. All seeded records are marked `REFERENCE_ONLY`. Applicability, current amendments and official URLs must be confirmed against the issuing authority before any enforcement use.

## Seeded documents

| Short title | Issuing authority | Category | Verification | Notes |
|---|---|---|---|---|
| NAAQS 2009 | Central Pollution Control Board | air | REFERENCE_ONLY | National Ambient Air Quality Standards notification, 18 November 2009 |
| CPCB Water Quality Criteria | Central Pollution Control Board | water | REFERENCE_ONLY | Outdoor bathing / designated best use reference criteria |
| EP Rules 1986 Schedule VI | Ministry of Environment, Forest and Climate Change | industrial | REFERENCE_ONLY | General effluent standards; industry-specific standards may be stricter |
| SWM Rules 2016 | Ministry of Environment, Forest and Climate Change | waste | REFERENCE_ONLY | Municipal solid waste duties/prohibitions; no numeric thresholds encoded |

## Seeded standards

### Air — NAAQS 2009 (residential/rural/other areas)

| Parameter | Limit | Averaging |
|---|---|---|
| PM2.5 | 60 µg/m³ | 24 hours |
| PM2.5 | 40 µg/m³ | annual (not used by the screen) |
| PM10 | 100 µg/m³ | 24 hours |
| PM10 | 60 µg/m³ | annual (not used by the screen) |
| NO2 | 80 µg/m³ | 24 hours |
| NO2 | 40 µg/m³ | annual (not used by the screen) |
| SO2 | 80 µg/m³ | 24 hours |
| SO2 | 50 µg/m³ | annual (not used by the screen) |
| CO | 2 mg/m³ | 8 hours |
| CO | 4 mg/m³ | 1 hour |
| O3 | 100 µg/m³ | 8 hours |
| O3 | 180 µg/m³ | 1 hour |

The seeded rows cover the 24h/8h limits used for screening. The application explicitly warns that a single hourly value is not a valid 24h average and is not an official exceedance.

### Water — CPCB outdoor bathing reference

| Parameter | Reference | Averaging |
|---|---|---|
| pH | 6.5–8.5 | grab sample |
| Dissolved oxygen | ≥ 5 mg/L | grab sample |

This is not a drinking-water standard and not an effluent standard. The app does not use turbidity/conductivity against a legal threshold; those are informational.

### Industrial — EP Rules 1986 Schedule VI general standards (reference)

| Parameter | Reference | Averaging |
|---|---|---|
| pH (effluent) | 5.5–9.0 | effluent sample |
| Suspended solids | ≤ 100 mg/L | effluent sample |
| BOD | ≤ 30 mg/L | effluent sample |
| COD | ≤ 250 mg/L | effluent sample |

These are general effluent standards for inland surface water. They are **not applied to stack monitoring readings**; the comparison engine returns `NOT_APPLICABLE_SOURCE_TYPE` for stack readings. Facility-specific consent conditions and industry-specific standards may differ and must be checked.

### Waste — SWM Rules 2016

No numeric ambient threshold is encoded. Waste risk is report-evidence based. The document is provided for context and investigation references only.

## Comparison rules

`GET /api/v1/compliance/compare` checks:

1. **Unit** — normalises `µg/m3`/`µg/m³` and `mg/m3`/`mg/m³`; does not convert values.
2. **Averaging period** — a single hourly observation cannot be compared with a 24h or 8h standard; returns `NOT_COMPARABLE_AVERAGING`.
3. **Source type** — stack readings cannot be compared with effluent standards; returns `NOT_APPLICABLE_SOURCE_TYPE`.
4. **Applicability** — displayed but not automatically resolved; an officer must confirm.

Labels:

- `POTENTIAL COMPLIANCE CONCERN — reference comparison only` only when a valid reference comparison is above the reference.
- `NOT COMPARABLE — see reason` when unit/averaging/source type fails.
- `WITHIN REFERENCE RANGE (reference only)` otherwise.

The API never returns “violation”. Official determinations are recorded only by an authorised administrator in the incident workflow, with an audit entry.

## Official references

- CPCB: https://cpcb.nic.in/
- NAAQS page: https://cpcb.nic.in/National-Ambient-Air-Quality-Standards/
- India Code: https://www.indiacode.nic.in/
- MoEFCC: https://moef.gov.in/

Some seeded URLs point to authority landing pages rather than a deep PDF link because a stable deep link was not verified. Always confirm the current official text before use.

## What is not claimed

- No legal advice.
- No automatic legal applicability determination.
- No official exceedance from an hourly value.
- No facility attribution from a nearby station.
- No invented clause or threshold.
