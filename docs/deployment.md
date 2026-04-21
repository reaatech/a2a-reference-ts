# Deployment Guide

## Docker Compose

```bash
cd docker && docker compose up
```

Services:
- `hello-agent` — Example A2A agent on port 3000
- `redis` — Task store backend
- `prometheus` — Metrics scraping
- `grafana` — Metrics dashboards

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Runtime environment |
| `PORT` | `3000` | HTTP server port |
| `LOG_LEVEL` | `info` | Pino log level |
| `REDIS_URL` | — | Redis connection string (optional) |
| `JWKS_URI` | — | JWKS endpoint for JWT validation (optional) |
| `API_KEYS` | — | Comma-separated API keys (optional) |

## Kubernetes

> **Coming soon.**
>
> A Helm chart and sample K8s manifests will be added in a future release.

## Cloudflare Workers

> **Coming soon.**
>
> A Workers adapter and wrangler configuration example will be added in a future release.
