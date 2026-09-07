# Fly.io Deployment Guide

Menuza can be deployed to Fly.io as an alternative to Cloudflare Workers. This guide covers deploying `apps/app`, `apps/admin`, and `apps/web` to Fly.io with SQLite + LiteFS replication and regional placement optimized for KSA/UAE.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Fly.io Deployment                         │
└─────────────────────────────────────────────────────────────┘

apps/app (menuza-app)
  ├── Region: Bahrain (bah) - Primary (2 machines)
  ├── Region: Dubai (dxb) - Backup (1 machine)
  ├── SQLite + LiteFS (replicated)
  └── Persistent volume: /data (10GB)

apps/admin (menuza-admin)
  ├── Region: Bahrain (bah) - (1 machine)
  └── Shared database access (read-only)

apps/web (menuza-web)
  ├── Region: Bahrain (bah) - (2 machines)
  ├── Region: Dubai (dxb) - (1 machine)
  └── Static site (no persistent storage)
```

## Prerequisites

1. **Fly.io account**: Sign up at https://fly.io
2. **flyctl CLI**: Install from https://fly.io/docs/hands-on/install-flyctl/
3. **Authenticate**:
   ```bash
   flyctl auth login
   ```

## Regional Placement for KSA/UAE

Fly.io regions optimized for KSA/UAE traffic:

| Region Code | Location       | Latency (from Riyadh) | Recommended Use    |
| ----------- | -------------- | --------------------- | ------------------ |
| `bah`       | Bahrain        | ~20-30ms              | Primary            |
| `dxb`       | Dubai, UAE     | ~40-50ms              | Backup/Failover    |
| `jnb`       | Johannesburg   | ~150ms                | Africa expansion   |
| `fra`       | Frankfurt      | ~160ms                | Europe expansion   |

**Default configuration uses `bah` (Bahrain) as primary region.**

## Database: SQLite + LiteFS

### Why LiteFS?

- **Replication**: Automatic SQLite replication across multiple machines
- **No PostgreSQL**: Simpler than managing Postgres instances
- **Fast reads**: Local SQLite queries with sub-ms latency
- **Write-ahead log**: Consistent writes to primary, replicated to secondaries

### LiteFS Configuration

Each app has a `litefs.yml` configuration:

```yaml
# apps/app/litefs.yml
fuse:
  dir: "/litefs"
  allow-other: true

data:
  dir: "/data/litefs"

exec:
  - cmd: "node /app/server/index.js"
    if-candidate: true

lease:
  type: "consul"
  candidate: ${FLY_REGION == PRIMARY_REGION}
  promote: true
```

**Key points:**
- Primary is elected via Consul lease
- Writes go to primary, replicated to secondaries
- Automatic failover if primary goes down

## Deployment Steps

### 1. Create Fly Apps

```bash
# App (main application)
cd apps/app
flyctl apps create menuza-app

# Admin dashboard
cd ../admin
flyctl apps create menuza-admin

# Marketing site
cd ../web
flyctl apps create menuza-web
```

### 2. Create Persistent Volumes

```bash
# Create volume for app database
flyctl volumes create menuza_data \
  --app menuza-app \
  --region bah \
  --size 10

# Admin shares the same database (read-only)
flyctl volumes create menuza_data \
  --app menuza-admin \
  --region bah \
  --size 10
```

### 3. Set Secrets

```bash
# App secrets
flyctl secrets set \
  --app menuza-app \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  INTERNAL_COMMAND_TOKEN="$(openssl rand -hex 32)" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  HONEYPOT_SECRET="$(openssl rand -hex 16)"

# Admin secrets (same SESSION_SECRET and INTERNAL_COMMAND_TOKEN)
flyctl secrets set \
  --app menuza-admin \
  SESSION_SECRET="<same-as-app>" \
  INTERNAL_COMMAND_TOKEN="<same-as-app>" \
  HONEYPOT_SECRET="$(openssl rand -hex 16)"

# Web secrets (if needed)
flyctl secrets set \
  --app menuza-web \
  PUBLIC_APP_URL="https://app.menuza.com"
```

### 4. Deploy

```bash
# Deploy app
cd apps/app
flyctl deploy

# Deploy admin
cd ../admin
flyctl deploy

# Deploy web
cd ../web
flyctl deploy
```

### 5. Configure Custom Domains

```bash
# App domain
flyctl certs create app.menuza.com --app menuza-app

# Admin domain
flyctl certs create admin.menuza.com --app menuza-admin

# Web domain
flyctl certs create menuza.com --app menuza-web
flyctl certs create www.menuza.com --app menuza-web
```

Add DNS records:
```
app.menuza.com    CNAME   menuza-app.fly.dev
admin.menuza.com  CNAME   menuza-admin.fly.dev
menuza.com        CNAME   menuza-web.fly.dev
www.menuza.com    CNAME   menuza-web.fly.dev
```

## Database Migrations

Run migrations on the primary app:

```bash
# SSH into app machine
flyctl ssh console --app menuza-app

# Run migrations
cd /app
node packages/database/src/migrate.js

# Or via remote command
flyctl ssh console --app menuza-app -C "node /app/packages/database/src/migrate.js"
```

## Scaling

### Horizontal Scaling

```bash
# Scale app to 3 machines in Bahrain
flyctl scale count 3 --region bah --app menuza-app

# Add machines in Dubai for failover
flyctl scale count 1 --region dxb --app menuza-app
```

### Vertical Scaling

```bash
# Upgrade app resources
flyctl scale vm shared-cpu-2x --memory 2048 --app menuza-app

# Available VM sizes:
# - shared-cpu-1x (256MB-1GB)
# - shared-cpu-2x (512MB-2GB)
# - shared-cpu-4x (1GB-4GB)
# - shared-cpu-8x (2GB-8GB)
```

## Monitoring

### Health Checks

Apps are configured with health checks at `/resources/healthcheck`:

```bash
# Check app health
curl https://app.menuza.com/resources/healthcheck

# View health check status
flyctl status --app menuza-app
```

### Logs

```bash
# Real-time logs
flyctl logs --app menuza-app

# Filter logs
flyctl logs --app menuza-app --region bah

# JSON format
flyctl logs --app menuza-app --json
```

### Metrics

```bash
# VM metrics
flyctl metrics --app menuza-app

# View in dashboard
flyctl dashboard --app menuza-app
```

## Backup and Recovery

### Database Backups

```bash
# Create snapshot
flyctl volumes snapshots create menuza_data --app menuza-app

# List snapshots
flyctl volumes snapshots list menuza_data --app menuza-app

# Restore from snapshot
flyctl volumes create menuza_data_restored \
  --snapshot-id <snapshot-id> \
  --region bah \
  --app menuza-app
```

### Automated Backups

Add to CI/CD:

```yaml
# .github/workflows/backup.yml
name: Daily Database Backup
on:
  schedule:
    - cron: '0 2 * * *' # 2 AM UTC daily

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Create snapshot
        run: |
          flyctl volumes snapshots create menuza_data --app menuza-app
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

## Comparison: Cloudflare vs Fly.io

| Feature              | Cloudflare Workers     | Fly.io                 |
| -------------------- | ---------------------- | ---------------------- |
| **Database**         | D1 (SQLite)            | LiteFS (SQLite)        |
| **Deployment**       | wrangler               | flyctl                 |
| **Scaling**          | Automatic, global      | Manual, regional       |
| **Cold starts**      | ~0ms                   | ~100ms                 |
| **Regional control** | Limited                | Full control           |
| **Pricing**          | Workers Paid (~$5/mo)  | ~$15-30/mo             |
| **Setup complexity** | Low                    | Medium                 |
| **KSA data residency** | Not guaranteed       | Guaranteed (bah region)|

## Cost Estimate (KSA/UAE Deployment)

**Fly.io Pricing (2024):**

| Resource                    | Quantity | Cost/month |
| --------------------------- | -------- | ---------- |
| App (2x shared-cpu-1x, 1GB) | 2        | $6.80      |
| Admin (1x shared-cpu-1x, 512MB) | 1     | $2.40      |
| Web (2x shared-cpu-1x, 256MB) | 2        | $4.20      |
| Volume (10GB, bah)          | 1        | $2.00      |
| Outbound bandwidth (50GB)   | 1        | $4.50      |
| **Total**                   |          | **~$20/mo**|

*First 3 VMs and 3GB volume are free on Fly.io's free tier.*

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/deploy-flyio.yml
name: Deploy to Fly.io

on:
  push:
    branches: [main]
    paths:
      - 'apps/app/**'
      - 'apps/admin/**'
      - 'apps/web/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Fly
        uses: superfly/flyctl-actions/setup-flyctl@master
      
      - name: Deploy App
        run: flyctl deploy --app menuza-app
        working-directory: apps/app
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
      
      - name: Deploy Admin
        run: flyctl deploy --app menuza-admin
        working-directory: apps/admin
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
      
      - name: Deploy Web
        run: flyctl deploy --app menuza-web
        working-directory: apps/web
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

## Troubleshooting

### LiteFS Issues

```bash
# Check LiteFS status
flyctl ssh console --app menuza-app
litefs status

# View LiteFS logs
flyctl logs --app menuza-app | grep litefs

# Force primary election
flyctl ssh console --app menuza-app
litefs promote
```

### Volume Issues

```bash
# Check volume status
flyctl volumes list --app menuza-app

# Extend volume size
flyctl volumes extend <volume-id> --size 20 --app menuza-app
```

### Network Issues

```bash
# Check internal DNS
flyctl ssh console --app menuza-app
dig menuza-app.internal

# Test inter-app connectivity
flyctl ssh console --app menuza-admin
curl http://menuza-app.internal:8080/resources/healthcheck
```

## Migration from Cloudflare

### Export from D1

```bash
# Export D1 database
cd apps/app
npx wrangler d1 export menuza-db --output=database.sql
```

### Import to LiteFS

```bash
# Upload SQL to Fly.io volume
flyctl ssh sftp shell --app menuza-app
put database.sql /data/

# Import to SQLite
flyctl ssh console --app menuza-app
sqlite3 /data/litefs/data.db < /data/database.sql
```

## Related Documentation

- [Deployment (Cloudflare)](./deployment.md) - Cloudflare Workers deployment
- [Database](./database.md) - Database schema and migrations
- [Tenant Data Residency](./tenant-data-residency.md) - Regional data handling
- [Fly.io Docs](https://fly.io/docs/) - Official Fly.io documentation
- [LiteFS Guide](https://fly.io/docs/litefs/) - LiteFS documentation
