# API v1 Documentation

Menuza exposes a versioned JSON API namespace at `/api/v1` for mobile clients and external integrations.

## Architecture

The v1 API follows REST principles and returns JSON responses. All endpoints are versioned to ensure backward compatibility as the platform evolves.

**Base URL:** `https://app.menuza.com/api/v1` (production) or `http://localhost:3001/api/v1` (development)

## Endpoints

### Root
- `GET /api/v1` - API information and available endpoints

### Health
- `GET /api/v1/health` - Health check endpoint for monitoring

### Authentication (Placeholder)
- `POST /api/v1/auth/login` - User authentication (returns JWT token)

### Menus (Placeholder)
- `GET /api/v1/menus` - List restaurant menus
- `GET /api/v1/menus/:id` - Get specific menu details
- `POST /api/v1/menus` - Create new menu (authenticated)
- `PATCH /api/v1/menus/:id` - Update menu (authenticated)
- `DELETE /api/v1/menus/:id` - Delete menu (authenticated)

### Orders (Placeholder)
- `GET /api/v1/orders` - List orders (authenticated)
- `GET /api/v1/orders/:id` - Get order details (authenticated)
- `POST /api/v1/orders` - Create new order
- `PATCH /api/v1/orders/:id/status` - Update order status (authenticated)

### Restaurants (Placeholder)
- `GET /api/v1/restaurants` - List restaurants
- `GET /api/v1/restaurants/:id` - Get restaurant details
- `POST /api/v1/restaurants` - Create restaurant (authenticated, admin)
- `PATCH /api/v1/restaurants/:id` - Update restaurant (authenticated)

## Authentication

The v1 API uses JWT (JSON Web Token) authentication for protected endpoints.

1. Obtain a token via `POST /api/v1/auth/login`
2. Include the token in subsequent requests:
   ```
   Authorization: Bearer <token>
   ```

## Response Format

All API responses follow a consistent JSON structure:

### Success Response
```json
{
  "success": true,
  "data": { ... }
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "details": { ... }
}
```

## HTTP Status Codes

- `200 OK` - Successful request
- `201 Created` - Resource created successfully
- `400 Bad Request` - Invalid request data
- `401 Unauthorized` - Authentication required
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `422 Unprocessable Entity` - Validation error
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error
- `501 Not Implemented` - Endpoint not yet implemented

## Rate Limiting

API endpoints are rate-limited to prevent abuse:
- Unauthenticated: 10 requests/minute
- Authenticated: 100 requests/minute
- Admin: 1000 requests/minute

## Versioning

The API is versioned via URL path (`/api/v1`, `/api/v2`, etc.). Breaking changes will result in a new API version. Non-breaking changes may be added to existing versions.

## Implementation Status (WO-1)

As of WO-1, the v1 API namespace has been scaffolded with:
- ✅ Root information endpoint
- ✅ Health check endpoint
- ⏳ Authentication endpoints (placeholder)
- ⏳ Menu endpoints (placeholder)
- ⏳ Order endpoints (placeholder)
- ⏳ Restaurant endpoints (placeholder)

Domain logic and database integration will be implemented in future work orders.

## Related Documentation

- [Authentication](./authentication.md)
- [Database](./database.md)
- [Testing](./testing.md)
