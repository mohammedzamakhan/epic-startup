# Background Jobs and Async Execution

Menuza uses **Cloudflare Workflows** via the `apps/jobs-cron` worker as the async execution tier. This is the equivalent of Trigger.dev or other background job processors, but built on Cloudflare's native infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Background Jobs Flow                     │
└─────────────────────────────────────────────────────────────┘

Cloudflare Cron Trigger (apps/jobs-cron)
        │
        │ Scheduled triggers (cron expressions)
        │ POST + Bearer INTERNAL_COMMAND_TOKEN
        ▼
App Instance (Cloudflare Workers)
        │
        │ /resources/jobs/* route handlers
        ▼
Control-plane SQLite (D1)
        │
        │ Audit logs, MCP tokens, GDPR requests, etc.
        ▼
Tenant API (Regional)
        │
        │ Customer data processing
        ▼
Per-org SQLite (Regional)
```

## Job Categories

### 1. Scheduled Jobs (Cron-based)

These run on a fixed schedule defined in `apps/jobs-cron/src/index.ts`:

| Schedule     | Route                                | Purpose                           |
| ------------ | ------------------------------------ | --------------------------------- |
| `0 2 * * *`  | `/resources/jobs/audit-log-archival` | Archive old audit logs            |
| `0 3 * * *`  | `/resources/jobs/mcp-token-cleanup`  | Remove expired MCP tokens         |
| `0 4 * * *`  | `/resources/jobs/gdpr-erasure`       | Process pending GDPR erasures     |
| `0 * * * *`  | Tenant engagement sync               | Sync customer engagement metrics  |

**Adding a new cron job:**

1. Add route in `apps/app/app/routes/resources+/jobs.your-job.ts`
2. Update `JOB_ROUTES` in `apps/jobs-cron/src/index.ts`
3. Deploy the jobs-cron worker

### 2. Workflows (Event-driven)

Workflows are long-running, stateful processes triggered by events:

#### Storage Migration Workflow

Handles background migration of media files when organizations switch storage providers:

```typescript
// Trigger migration
POST /workflows/storage-migration/start
{
  "migrationId": "mig_123"
}

// Monitor progress
GET /workflows/storage-migration/status/:id
```

**Flow:**
1. Admin enables BYO S3 or changes buckets
2. App creates `StorageMigration` row and triggers workflow
3. Workflow loops: `POST /resources/storage/migration/:id/batch`
4. App copies batch, deletes from source, updates progress
5. Workflow completes when all objects migrated

#### Marketing Journey Workflow

Handles multi-step customer marketing campaigns:

```typescript
// Start journey
POST /workflows/marketing-journey/start
{
  "orgId": "org_123",
  "journeyId": "journey_456",
  "customerId": "cust_789",
  "graph": { /* journey definition */ }
}

// Cancel journey
POST /workflows/marketing-journey/:instanceId/cancel

// Check status
GET /workflows/marketing-journey/:instanceId
```

## Configuration

### Environment Variables

| Variable                 | Where                      | Purpose                                           |
| ------------------------ | -------------------------- | ------------------------------------------------- |
| `INTERNAL_COMMAND_TOKEN` | App, tenant-api, jobs-cron | Bearer token for internal routes (≥16 chars)      |
| `APP_BASE_URL`           | jobs-cron                  | App URL to POST jobs to                           |
| `JOBS_CRON_WORKER_URL`   | App                        | Worker URL for triggering workflows               |
| `TENANT_API_URL`         | jobs-cron                  | US tenant-api URL for engagement sync             |
| `TENANT_API_URL_KSA`     | jobs-cron                  | KSA tenant-api URL for engagement sync            |

### Setting Secrets

```bash
# On jobs-cron worker
cd apps/jobs-cron
npx wrangler secret put INTERNAL_COMMAND_TOKEN

# On App (Cloudflare Workers)
cd apps/app
npx wrangler secret put INTERNAL_COMMAND_TOKEN
npx wrangler secret put JOBS_CRON_WORKER_URL
```

## Development

### Local Development

```bash
# Start jobs-cron worker
cd apps/jobs-cron
npm run dev  # Runs on http://localhost:8787

# Trigger a workflow manually
curl -X POST http://localhost:8787/workflows/storage-migration/start \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"migrationId": "test_123"}'
```

### Testing Cron Jobs Locally

Cloudflare Workers doesn't fire cron triggers in local development. To test:

1. **Manual trigger via curl:**
   ```bash
   curl -X POST http://localhost:3001/resources/jobs/audit-log-archival \
     -H "Authorization: Bearer your-internal-token"
   ```

2. **Add temporary test route:**
   ```typescript
   // apps/jobs-cron/src/index.ts
   if (pathname === '/test-cron') {
     await invokeJob(env, '/resources/jobs/audit-log-archival')
     return Response.json({ success: true })
   }
   ```

## Deployment

The `deploy-jobs-cron` GitHub Actions job deploys when `apps/jobs-cron/**` changes.

**Manual deploy:**
```bash
cd apps/jobs-cron
npm run deploy
```

**Wrangler configuration** is in `apps/jobs-cron/wrangler.jsonc`:
```jsonc
{
  "name": "menuza-jobs-cron",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "workflows": [
    {
      "name": "storage-migration",
      "binding": "STORAGE_MIGRATION_WORKFLOW",
      "class_name": "StorageMigrationWorkflow"
    },
    {
      "name": "marketing-journey",
      "binding": "MARKETING_JOURNEY_WORKFLOW",
      "class_name": "MarketingJourneyWorkflow"
    }
  ],
  "triggers": {
    "crons": [
      "0 2 * * *",
      "0 3 * * *",
      "0 4 * * *",
      "0 * * * *"
    ]
  }
}
```

## Creating New Background Jobs

### 1. Simple Cron Job

**Step 1:** Create route handler
```typescript
// apps/app/app/routes/resources+/jobs.my-task.ts
import { requireInternalCommandAuth } from '#app/utils/internal-command-auth.server.js'
import { type ActionFunctionArgs } from 'react-router'

export async function action({ request }: ActionFunctionArgs) {
  await requireInternalCommandAuth(request)
  
  // Your job logic here
  console.log('Running my task')
  
  return Response.json({ success: true })
}
```

**Step 2:** Register in jobs-cron
```typescript
// apps/jobs-cron/src/index.ts
const JOB_ROUTES = {
  '0 5 * * *': '/resources/jobs/my-task',
  // ... other jobs
}
```

**Step 3:** Update wrangler.jsonc triggers
```jsonc
{
  "triggers": {
    "crons": [
      "0 5 * * *",
      // ... other schedules
    ]
  }
}
```

### 2. Workflow Job

**Step 1:** Create workflow class
```typescript
// apps/jobs-cron/src/my-workflow.ts
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'

export class MyWorkflow extends WorkflowEntrypoint {
  async run(event: WorkflowEvent<{ id: string }>, step: WorkflowStep) {
    // Workflow logic with durable execution
    await step.do('process', async () => {
      // Your processing logic
    })
  }
}
```

**Step 2:** Register workflow binding
```jsonc
// apps/jobs-cron/wrangler.jsonc
{
  "workflows": [
    {
      "name": "my-workflow",
      "binding": "MY_WORKFLOW",
      "class_name": "MyWorkflow"
    }
  ]
}
```

**Step 3:** Add trigger endpoint
```typescript
// apps/jobs-cron/src/index.ts
if (pathname === '/workflows/my-workflow/start' && request.method === 'POST') {
  const body = await request.json()
  const instance = await env.MY_WORKFLOW.create({
    id: body.id,
    params: body,
  })
  return Response.json({ success: true, instanceId: instance.id })
}
```

## Comparison with Trigger.dev

| Feature                    | jobs-cron (Cloudflare)    | Trigger.dev              |
| -------------------------- | ------------------------- | ------------------------ |
| **Platform**               | Cloudflare Workers        | Node.js                  |
| **Scheduling**             | Native cron triggers      | Cron expressions         |
| **Long-running jobs**      | Workflows (durable)       | Background tasks         |
| **State management**       | Workflow state            | Database-backed          |
| **Cost**                   | Workers pricing (~$0)     | Usage-based              |
| **Setup complexity**       | Low (built-in)            | Medium (separate service)|
| **Local development**      | wrangler dev              | trigger.dev dev          |
| **Monitoring**             | Cloudflare dashboard      | Trigger.dev dashboard    |

## Monitoring and Observability

### Job Execution Logs

View logs in the Cloudflare dashboard:
1. Workers & Pages → jobs-cron → Logs
2. Filter by cron execution or workflow instance

### Health Checks

```bash
# Check jobs-cron health
curl https://jobs.menuza.com/health

# Response
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "service": "jobs-cron"
}
```

### Workflow Status

```bash
# Check workflow status
curl https://jobs.menuza.com/workflows/storage-migration/mig_123 \
  -H "Authorization: Bearer your-token"

# Response
{
  "success": true,
  "instanceId": "mig_123",
  "status": {
    "status": "running",
    "output": null
  }
}
```

## Error Handling

### Retries

Cron jobs don't automatically retry. Implement retry logic in the route handler:

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      if (i === maxRetries - 1) throw error
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)))
    }
  }
  throw new Error('Max retries exceeded')
}
```

### Dead Letter Queue

Failed jobs are logged. Implement a dead-letter pattern:

```typescript
// Store failed job for manual retry
await db.insert(FailedJob).values({
  jobName: 'audit-log-archival',
  error: error.message,
  payload: JSON.stringify(context),
  createdAt: new Date(),
})
```

## Best Practices

1. **Idempotency:** Jobs should be safe to run multiple times
2. **Timeouts:** Keep cron jobs under 30 seconds; use workflows for longer tasks
3. **Authentication:** Always require `INTERNAL_COMMAND_TOKEN` for job routes
4. **Logging:** Use structured logging for debugging
5. **Monitoring:** Set up alerts for job failures
6. **Testing:** Test jobs locally before deploying
7. **Secrets rotation:** Rotate `INTERNAL_COMMAND_TOKEN` periodically

## Related Documentation

- [Scheduled Jobs](./scheduled-jobs.md) - Original scheduling documentation
- [Deployment](./deployment.md) - Deployment procedures
- [Secrets](./secrets.md) - Secret management
- [Cloudflare Workflows](https://developers.cloudflare.com/workers/runtime-apis/workflows/) - Official Cloudflare docs
