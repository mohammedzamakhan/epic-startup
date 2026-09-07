# Database

Menuza supports two database deployment models:

1. **Cloudflare D1** (default) - Serverless SQLite with automatic replication
2. **Fly.io + LiteFS** (alternative) - Self-managed SQLite with LiteFS replication

## Control Plane Database Options

### Option 1: Cloudflare D1 (Default)

Menuza uses Cloudflare D1 (a serverless SQLite database) for the control plane database. D1 automatically handles replication, scaling, and backups without needing manual intervention like LiteFS. The control plane database is used for the App and Admin applications and stores operators and configuration data.

You manage D1 via the `wrangler` CLI.

**Pros:**
- Automatic replication and scaling
- No infrastructure management
- Global edge distribution
- Automatic backups

**Cons:**
- Limited regional control
- May not meet strict data residency requirements
- Vendor lock-in to Cloudflare

### Option 2: Fly.io + LiteFS (Alternative)

For deployments with strict data residency requirements (e.g., KSA/UAE), you can use Fly.io with LiteFS for SQLite replication on persistent volumes.

LiteFS provides:
- **Regional control**: Deploy to specific Fly.io regions (e.g., Bahrain)
- **Replication**: Automatic SQLite replication to secondary nodes
- **Fast reads**: Local SQLite queries with sub-ms latency
- **Failover**: Automatic primary election if the primary node fails

**Setup:**
1. Create Fly.io apps and volumes
2. Configure `litefs.yml` in each app
3. Deploy with `flyctl deploy`

See [Fly.io Deployment Guide](./deployment-flyio.md) for detailed instructions.

**Pros:**
- Guaranteed regional placement
- Full infrastructure control
- Standards-compliant data residency
- Multi-region replication

**Cons:**
- Requires volume management
- Manual scaling
- Higher operational complexity

## Tenant customer SQLite

Customer phone, name, and email are **not** in the control plane database. Each
published org gets a file `tenant_{orgId}.db` on the tenant-api node whose
`DATA_REGION` matches `Organization.dataRegion`. Production files live on an OCI
block volume (`/data/tenants`). When an org switches data regions, the old file
is destroyed and a new one is provisioned. There is no automated cross-region
tenant-DB migration because regional migration must be a destructive,
user-initiated action. See `docs/tenant-data-residency.md`.

## Drizzle Studio

To manage your local development database with a UI:

```sh
npm run db:studio
```

For connecting to your production D1 database, you can use the Cloudflare
Dashboard, or proxy a local studio connection via wrangler.

## Migrations

Migrations are handled by Drizzle. To create a new migration:

```sh
cd packages/database
npx drizzle-kit generate --name your_migration_name
```

### Local Development

To apply migrations to your local database:

```sh
npx tsx src/migrate.ts
```

`npm run db:migrate:deploy` is for the local LibSQL development database used by tests and local development.

### Cloudflare D1 (Production)

To deploy migrations to production on Cloudflare D1:

```sh
cd apps/app
npx wrangler d1 migrations apply menuza-db --remote \
  --config wrangler.deploy.jsonc
```

On pushes to `main` and `dev`, GitHub Actions applies pending D1 migrations before it triggers the App or Admin Worker deployments. The migration job uses the App config because App and Admin share the same control-plane D1 database; if migration fails, Worker deployments are not triggered.

### Fly.io + LiteFS (Production)

To deploy migrations on Fly.io:

```sh
# SSH into primary app machine
flyctl ssh console --app menuza-app

# Run migrations
cd /app
node packages/database/src/migrate.js

# Or via remote command
flyctl ssh console --app menuza-app -C "node /app/packages/database/src/migrate.js"
```

LiteFS automatically replicates the migrated database to secondary nodes.

## Seeding

During development, you may want to seed your database with test data:

```sh
npm run db:seed
```

## Backups

### Cloudflare D1

Cloudflare D1 takes automatic snapshots of your database. You can view, restore, or download these snapshots via the Cloudflare Dashboard or using `wrangler d1 backup` commands.

```sh
# Example of taking a manual backup
npx wrangler d1 backup create menuza-db
```

### Fly.io + LiteFS

For Fly.io deployments, create volume snapshots:

```sh
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

Automate daily backups via GitHub Actions (see [Fly.io Deployment Guide](./deployment-flyio.md#backup-and-recovery)).

### Tenant Databases

For tenant databases on OCI, you should configure standard OCI block volume backups.
