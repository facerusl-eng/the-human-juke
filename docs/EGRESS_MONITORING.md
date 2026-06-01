# Egress Monitoring

This project can exceed Supabase quota primarily from repeated API/queue traffic.

## Quick checks

1. Supabase Dashboard -> Organization -> Usage
2. Confirm which quota is rising (usually Egress)
3. Keep spend cap status aligned with live-show reliability needs

## Endpoint hotspot report

Use exported API log JSON (from Supabase tooling) to see which endpoints are hottest.

```bash
npm run report:api-log -- --file <path-to-api-content.json> --top 20
```

Example output includes:

1. Top endpoints by request count
2. HTTP methods distribution
3. Status code distribution

## Suggested weekly routine

1. Run the report from the latest API log export
2. Compare top endpoints with current polling intervals
3. Review feed and queue traffic before each live cycle
4. If egress trend rises, reduce polling or increase cache lifetimes for immutable assets
