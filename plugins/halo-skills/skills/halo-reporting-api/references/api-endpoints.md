# Halo Basic Report API — Endpoint Reference

Per-endpoint reference for the curl-based Halo API workflow defined in `../SKILL.md`. Assumes `BASE_URL`, `MC_ID`, and `TOKEN` are set per the environment config in `SKILL.md`.

All paths follow `${BASE_URL}/v2alpha/${MC_ID}/{resource}` and require:

```
Authorization: Bearer $TOKEN
```

**Read-only:** All endpoints documented here are `GET`. Creating reporting sets / basic reports is intentionally omitted to eliminate the prompt-injection-to-write attack path when this skill runs inside an agent. Use your Halo deployment's UI for write workflows.

---

## 1. Event Groups (Campaigns)

### List event groups

```bash
curl -s --max-time 60 \
  -H "Authorization: Bearer $TOKEN" \
  "${BASE_URL}/v2alpha/${MC_ID}/eventGroups?pageSize=50&structured_filter.metadata_search_query=BrandName"
```

**Response shape:** `{ "eventGroups": [...], "nextPageToken": "..." }`

Each event group includes:

- `name` — full resource name (`measurementConsumers/.../eventGroups/...`)
- `cmmsDataProvider` — publisher resource name (`dataProviders/<PUB_ID>`)
- `mediaTypes[]` — e.g., `["VIDEO"]`
- `eventGroupMetadata.adMetadata.campaignMetadata.brandName`
- `eventGroupMetadata.adMetadata.campaignMetadata.campaignName`
- `dataAvailabilityInterval.{startTime, endTime}` — RFC 3339

### Filters (all AND-combined; omit to skip)

| Parameter | Description |
|---|---|
| `structured_filter.cmms_data_provider_in` | Publisher filter (repeated). Format: `dataProviders/{PUB_ID}` |
| `structured_filter.media_types_intersect` | `VIDEO`, `DISPLAY`, `OTHER` (repeated) |
| `structured_filter.data_availability_start_time_on_or_after` | RFC 3339 timestamp |
| `structured_filter.data_availability_start_time_on_or_before` | RFC 3339 timestamp |
| `structured_filter.metadata_search_query` | Text search over brand/campaign name |
| `order_by.field` | `DATA_AVAILABILITY_START_TIME` |
| `order_by.descending` | `true` / `false` |
| `view` | `BASIC` (default) or `WITH_ACTIVITY_SUMMARY` |
| `pageSize` | Default 50, max 1000 |
| `pageToken` | Returned in previous response |

### Get a single event group

```bash
curl -s --max-time 60 \
  -H "Authorization: Bearer $TOKEN" \
  "${BASE_URL}/v2alpha/dataProviders/{DP_ID}/eventGroups/{EG_ID}"
```

> Single-get is keyed on `dataProviders/...`, **not** on `${MC_ID}`.

### Discover publishers

There is **no `/dataProviders` LIST endpoint**. Build the publisher list by collecting unique `cmmsDataProvider` values from the event-groups response.

---

## 2. Reporting Sets (Campaign Groups)

### List reporting sets

```bash
curl -s --max-time 60 \
  -H "Authorization: Bearer $TOKEN" \
  "${BASE_URL}/v2alpha/${MC_ID}/reportingSets?pageSize=100"
```

> Only entries with a populated `campaignGroup` field have associated basic reports. Filter accordingly when picking which one to feed into a `basicReports` lookup.

---

## 3. Basic Reports

### List basic reports

```bash
curl -s --max-time 60 \
  -H "Authorization: Bearer $TOKEN" \
  "${BASE_URL}/v2alpha/${MC_ID}/basicReports?pageSize=10&filter.create_time_after=2026-01-01T00:00:00Z"
```

`pageSize` default is 10, max is 25. Each entry has `name`, `state` (`RUNNING` | `SUCCEEDED` | `FAILED`), `title`, `createTime`.

### Get a basic report

```bash
curl -s --max-time 60 \
  -H "Authorization: Bearer $TOKEN" \
  "${BASE_URL}/v2alpha/${MC_ID}/basicReports/<REPORT_ID>"
```

`state` progresses through `RUNNING` → `SUCCEEDED` | `FAILED`.

---

## 4. Pagination (all LIST endpoints)

```
?pageSize=100
→ response includes "nextPageToken": "..."
?pageSize=100&pageToken=<nextPageToken>
→ ... loop until no nextPageToken is returned ...
```

---

## 5. Error → Fix cheat sheet

| Status | Likely cause | Fix |
|---|---|---|
| 400 | Used `snake_case` query param | Convert to `camelCase` |
| 400 | Event group ID isn't a full resource path | Use `dataProviders/<PUB>/eventGroups/<EG>` |
| 401 | Token >60 min old, or revoked | Re-authenticate (`./scripts/halo-auth.sh`); on persistent 401, delete `${XDG_CACHE_HOME:-$HOME/.cache}/halo-reporting-api/token` and retry |
| 403 | Token's audience/tenant doesn't match the deployment | Verify `AUTH0_URL` + `AUTH0_AUDIENCE` belong to the same deployment as `BASE_URL` |
| 404 | Wrong `MC_ID`, wrong deployment, or wrong report ID | Verify env vars + ID against your deployment operator |
| 429 | Rate-limited | Back off (exponential, starting ~2s) |
| 500 | Transient server error | Retry with backoff |
| HTTP 000 / connection refused | Network / TLS / corporate proxy in the way | Confirm DNS resolves `BASE_URL`; if behind a corporate egress proxy, set `HTTPS_PROXY` |

---

## 6. Response shape — completed report

```jsonc
{
  "state": "SUCCEEDED",
  "resultGroups": [{
    "title": "Results",
    "results": [{
      "metadata": { /* ... */ },
      "metricSet": {
        "populationSize": "55942000",
        "reportingUnit": {
          "cumulative": {
            "reach": "12345",
            "percentReach": 0.22,
            "kPlusReach": ["12345", "8000", "5000"],
            "percentKPlusReach": [0.22, 0.14, 0.09],
            "averageFrequency": 2.1,
            "impressions": "26000",
            "grps": 0.46
          },
          "nonCumulative": null,
          "stackedIncrementalReach": []
        },
        "components": [{
          "key": "dataProviders/<PUB_ID>",
          "value": {
            "cumulative": { /* same shape */ },
            "nonCumulative": null
          }
        }],
        "componentIntersections": []
      }
    }]
  }]
}
```

### Key gotchas

1. **`cumulative` vs `nonCumulative` are alternatives.** Both keys always exist; **exactly one is populated**, the other is `null`. Which one depends on the BasicReport request's `metricFrequency`: `{"total": true}` → values under `cumulative`; weekly/daily → values under `nonCumulative`. Parsers that only read `.cumulative` silently return `null` on weekly reports.
2. **Numeric fields are string-encoded.** `reach`, `impressions`, `populationSize`, `kPlusReach[]` come back as JSON strings (`"12345"`). `averageFrequency`, `percentReach`, `percentKPlusReach[]`, `grps` are real numbers.
3. **Per-publisher breakdowns** live under `metricSet.components[]`. Each entry has `key` (`"dataProviders/<PUB_ID>"`) and `value` with the same `cumulative`/`nonCumulative` shape. Empty `components: []` means the report was aggregated across publishers without breakdown.
4. **`resultGroups` is an array.** A report can contain many `resultGroups` (one per `resultGroupSpec` in the request, expanded by dimension cuts). Iterate.

### Field meanings

- **reach** / **impressions** — string-encoded integers (cast to int)
- **averageFrequency** / **percentReach** / **grps** — numbers
- **populationSize** — addressable population (string-encoded int); `percentReach = reach/populationSize`, `grps = impressions/populationSize × 100`
- **kPlusReach[i]** — people reached `i+1` or more times (string-encoded ints)

### jq snippet — extract metrics regardless of cumulative/nonCumulative

```bash
jq '.resultGroups[].results[].metricSet.reportingUnit
    | (.cumulative // .nonCumulative)
    | {reach, impressions, averageFrequency}'
```
