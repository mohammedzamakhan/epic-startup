# Storage Configuration

Menuza uses S3-compatible object storage for brand assets, menu imagery, and media files. The storage layer supports both Cloudflare R2 (default) and custom S3-compatible providers.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Storage Architecture                       │
└─────────────────────────────────────────────────────────────┘

Application Layer
  ├── Upload API (@repo/storage)
  └── URL Generation & Signing

Storage Layer
  ├── Default: Cloudflare R2 (S3-compatible)
  └── Custom: Per-organization S3 buckets
      ├── AWS S3
      ├── DigitalOcean Spaces
      ├── MinIO
      └── Any S3-compatible provider

Database Layer (SQLite/D1)
  ├── Storage metadata (object keys, relationships)
  └── Encrypted S3 credentials (per-org)
```

## Default Storage: Cloudflare R2

Menuza uses **Cloudflare R2** by default - an S3-compatible object storage service with:

- **Zero egress fees**: No bandwidth charges
- **S3 API compatibility**: Works with AWS SDK
- **Global distribution**: Cloudflare's edge network
- **Automatic integration**: Works with Cloudflare Workers

### Configuration

```bash
# .env (automatically configured)
AWS_ACCESS_KEY_ID="your-r2-access-key"
AWS_SECRET_ACCESS_KEY="your-r2-secret-key"
AWS_REGION="auto"
AWS_ENDPOINT_URL_S3="https://<account-id>.r2.cloudflarestorage.com"
BUCKET_NAME="menuza-media"
```

**Local Development:**
The `.env` file includes mock credentials, and MSW mocks the S3 API for offline development.

## Per-Organization S3 Storage

Restaurants can configure their own S3-compatible storage for:
- Menu images
- Brand assets (logos, banners)
- Restaurant photos
- Media files

### Features

✅ **Secure Storage**: S3 credentials encrypted with AES-256-GCM  
✅ **Flexible Providers**: AWS S3, DigitalOcean, MinIO, etc.  
✅ **Connection Testing**: Verify credentials before saving  
✅ **Automatic Fallback**: Default storage if custom config unavailable  
✅ **Background Migration**: Migrate existing media to new bucket  

### Setup

1. **Navigate to Organization Settings**
   - Go to `/app/{org-slug}/settings`
   - Find "Storage Configuration" section

2. **Enable Custom Storage**
   - Toggle "Enable Custom S3 Storage"
   - Fill in S3 configuration:
     - **Endpoint URL**: `https://s3.amazonaws.com` (or provider URL)
     - **Region**: `us-east-1` (or preferred region)
     - **Bucket Name**: Your S3 bucket name
     - **Access Key ID**: S3 access key
     - **Secret Access Key**: S3 secret key

3. **Test Connection**
   - Click "Test Connection" to verify
   - System will attempt to list bucket and upload a test object

4. **Save Configuration**
   - Optionally enable "Migrate existing org media"
   - Save to activate custom storage

### Security

**Encryption:**
- Secret keys encrypted with AES-256-GCM before storage
- Encryption key: `SSO_ENCRYPTION_KEY` (64 hex chars, 32 bytes)
- Same key used for SSO IdP secrets

**IAM Permissions:**
Recommended minimal S3 policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ]
    }
  ]
}
```

## Supported File Types

All upload functions support organization-specific storage:

| Asset Type            | Upload Function             | Use Case                           |
| --------------------- | --------------------------- | ---------------------------------- |
| Profile images        | `uploadProfileImage`        | User avatars                       |
| Organization logos    | `uploadOrganizationImage`   | Restaurant branding                |
| Menu item images      | `uploadNoteImage`           | Menu item photos                   |
| Comment images        | `uploadCommentImage`        | Customer feedback, reviews         |
| Video media           | `uploadNoteVideo`           | Promotional videos, menu demos     |
| Video thumbnails      | `uploadVideoThumbnail`      | Video preview images               |
| Site icons            | `uploadSiteIcon`            | Favicon, app icons                 |
| Website assets        | `uploadWebsiteAsset`        | General website media              |
| SEO images            | `uploadWebsiteSeoImage`     | Open Graph, Twitter cards          |
| Custom fonts          | `uploadSiteFont`            | Brand typography                   |

## Storage Migration

When switching storage providers, existing media can be migrated in the background.

### Automatic Migration

1. **Enable** in Organization Settings:
   - Check **"Migrate existing org media after saving"**
   - Or click **"Migrate existing media"** button

2. **Background Process:**
   - App creates `StorageMigration` record
   - Triggers `storage-migration` workflow on `apps/jobs-cron`
   - Copies files in batches to new bucket
   - Deletes from source after successful copy
   - Updates progress in database

3. **Monitor Progress:**
   - View migration status in Organization Settings
   - Check progress percentage
   - See completed/failed file counts

### Manual Migration (Break-glass)

For local operations or troubleshooting:

```bash
# scripts/transfer-s3-files.ts
npx tsx scripts/transfer-s3-files.ts \
  --source-bucket old-bucket \
  --dest-bucket new-bucket \
  --source-endpoint https://old-provider.com \
  --dest-endpoint https://new-provider.com \
  --source-access-key ... \
  --source-secret-key ... \
  --dest-access-key ... \
  --dest-secret-key ... \
  [--keep-source] # Don't delete from source
```

See [Background Jobs](./background-jobs.md#storage-migration-workflow) for workflow details.

## API Usage

### Upload Example

```typescript
import { uploadNoteImage } from '@repo/storage'

// Upload menu item image
const result = await uploadNoteImage({
  request, // FormData request with 'image' field
  noteId: 'note_abc123',
  organizationId: 'org_xyz789', // Routes to org's S3 if configured
})

// Result
{
  id: 'img_def456',
  altText: 'Grilled Salmon Plate',
  objectKey: 'org_xyz789/notes/note_abc123/img_def456.jpg',
}
```

### Storage Client

```typescript
import { createStorageClient } from '@repo/storage'

// Create S3 client
const s3Client = await createStorageClient({
  organizationId: 'org_xyz789',
  getOrganizationConfig: async (orgId) => {
    // Fetch org's S3 config from database
    return await db.query.organizationS3Config.findFirst({
      where: eq(organizationS3Config.organizationId, orgId),
    })
  },
  decrypt: async (encryptedValue) => {
    // Decrypt secret access key
    return decryptData(encryptedValue, SSO_ENCRYPTION_KEY)
  },
})

// Upload file
await s3Client.send(new PutObjectCommand({
  Bucket: 'bucket-name',
  Key: 'path/to/file.jpg',
  Body: fileStream,
  ContentType: 'image/jpeg',
}))
```

## Media Transformations

Menu item images and videos support on-demand transformations via Cloudflare Media Transformations.

### Video Posters and Previews

Automatic video poster generation:

```typescript
import { getVideoPosterUrl } from '@repo/common'

// Generate poster URL for video
const posterUrl = getVideoPosterUrl(objectKey, {
  width: 800,
  height: 450,
  fit: 'cover',
  time: '5s', // Frame at 5 seconds
})

// Hover preview clip (first 3 seconds, no audio)
const previewUrl = getVideoPreviewUrl(objectKey, {
  width: 400,
  duration: 3,
  audio: false,
})
```

**Requirements:**
- Set `MEDIA_TRANSFORM_BASE_URL=https://app.menuza.com` on App
- Enable Media Transformations on Cloudflare zone
- App hostname must be Cloudflare-proxied (orange cloud)

**Local Development:**
Leave `MEDIA_TRANSFORM_BASE_URL` empty; UI falls back to direct source URLs.

## Database Schema

### Organization S3 Config

```typescript
export const OrganizationS3Config = sqliteTable('OrganizationS3Config', {
  id: text().primaryKey().$defaultFn(() => createId()),
  isEnabled: integer({ mode: 'boolean' }).notNull().default(false),
  endpoint: text().notNull(),
  bucketName: text().notNull(),
  accessKeyId: text().notNull(),
  secretAccessKey: text().notNull(), // Encrypted with SSO_ENCRYPTION_KEY
  region: text().notNull(),
  organizationId: text().notNull().unique(),
  createdAt: integer({ mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  updatedAt: integer({ mode: 'timestamp_ms' }).$onUpdate(() => new Date()),
})
```

### Storage Migration

```typescript
export const StorageMigration = sqliteTable('StorageMigration', {
  id: text().primaryKey().$defaultFn(() => createId()),
  organizationId: text().notNull(),
  status: text({ enum: ['pending', 'in_progress', 'completed', 'failed'] }),
  totalFiles: integer().notNull().default(0),
  completedFiles: integer().notNull().default(0),
  failedFiles: integer().notNull().default(0),
  startedAt: integer({ mode: 'timestamp_ms' }),
  completedAt: integer({ mode: 'timestamp_ms' }),
  errorMessage: text(),
  createdAt: integer({ mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})
```

## Troubleshooting

### Connection Test Fails

**Symptoms:** Test connection button returns error

**Solutions:**
1. Verify S3 credentials are correct
2. Ensure bucket exists and is accessible
3. Check IAM user has necessary permissions
4. Verify S3 endpoint URL for your provider
5. Check firewall/network rules allow S3 access

### Files Not Uploading

**Symptoms:** Upload fails with error

**Solutions:**
1. Check organization's S3 config is enabled
2. Verify bucket has write permissions
3. Check server logs for detailed errors
4. Ensure `SSO_ENCRYPTION_KEY` is set
5. Verify bucket CORS policy allows uploads

### Migration Stuck

**Symptoms:** Migration shows "in_progress" indefinitely

**Solutions:**
1. Check `apps/jobs-cron` logs for workflow errors
2. Verify `JOBS_CRON_WORKER_URL` is set on App
3. Check `INTERNAL_COMMAND_TOKEN` matches between App and jobs-cron
4. Manually trigger batch: `POST /resources/storage/migration/{id}/batch`
5. Reset migration status in database if needed

### Encryption Issues

**Symptoms:** Can't decrypt stored credentials

**Solutions:**
1. Ensure `SSO_ENCRYPTION_KEY` is set and consistent
2. Verify encryption key is 64 hex characters (32 bytes)
3. Generate new key: `openssl rand -hex 32`
4. Don't change encryption key after storing credentials
5. Re-configure S3 settings if key was rotated

## Best Practices

1. **Regional Placement**
   - Use S3 buckets in the same region as your app
   - For KSA/UAE: Bahrain (`me-south-1`) or UAE (`me-central-1`)

2. **Cost Optimization**
   - Use Cloudflare R2 for zero egress fees
   - Enable S3 lifecycle policies for old media
   - Compress images before upload

3. **Security**
   - Rotate S3 access keys periodically
   - Use minimal IAM permissions
   - Enable bucket encryption at rest
   - Use HTTPS for all S3 endpoints

4. **Performance**
   - Enable CloudFront or CDN for S3 buckets
   - Use appropriate image formats (WebP, AVIF)
   - Implement lazy loading for images

5. **Backup**
   - Enable S3 versioning for critical buckets
   - Configure cross-region replication
   - Automate daily backups to separate bucket

## Environment Variables

| Variable                   | App  | Admin | Required | Purpose                              |
| -------------------------- | ---- | ----- | -------- | ------------------------------------ |
| `AWS_ACCESS_KEY_ID`        | ✅   | ✅    | Yes      | Default R2 access key                |
| `AWS_SECRET_ACCESS_KEY`    | ✅   | ✅    | Yes      | Default R2 secret key                |
| `AWS_REGION`               | ✅   | ✅    | Yes      | R2 region (usually "auto")           |
| `AWS_ENDPOINT_URL_S3`      | ✅   | ✅    | Yes      | R2 endpoint URL                      |
| `BUCKET_NAME`              | ✅   | ✅    | Yes      | Default R2 bucket name               |
| `SSO_ENCRYPTION_KEY`       | ✅   | ✅    | Yes      | Encrypt org S3 credentials (64 hex)  |
| `MEDIA_TRANSFORM_BASE_URL` | ✅   | ❌    | No       | Cloudflare hostname for video transforms |
| `JOBS_CRON_WORKER_URL`     | ✅   | ❌    | Yes      | jobs-cron URL for migration workflow |

## Related Documentation

- [Background Jobs](./background-jobs.md) - Storage migration workflow
- [Image Storage](./image-storage.md) - Image-specific storage details
- [Organization S3 Storage](./organization-s3-storage.md) - Original per-org S3 docs
- [Scheduled Jobs](./scheduled-jobs.md) - Video transformation details
