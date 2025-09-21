# Index Network API Documentation

## Overview

The Index Network API provides a comprehensive REST interface for building applications on top of the Index Protocol. This documentation covers **64 endpoints** across **15 modules**.

## Authentication

Most endpoints require authentication using a Bearer token obtained from the authentication endpoints:

```http
Authorization: Bearer YOUR_API_TOKEN
```

To get an API token, use the auth endpoints or integrate with Privy authentication.

## Base URL

All API requests should be made to:

**Production**: `https://api.index.network/api`  
**Development**: `http://localhost:3001/api`

## Quick Start

1. **Authenticate** and get your API token
2. **Create or join an index** to organize your intents
3. **Create intents** to express what you're looking for
4. **Discover matches** and connect with others

## API Modules

### 📁 Agents

AI agent management and operations

**Endpoints**: 5 | **Auth Required**: 5/5 | **Documentation**: [agents.md](agents.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/` | Get all items with pagination |
| GET | `/api/:id` | Get single item by ID |
| POST | `/api/` | Get all items with pagination |
| PUT | `/api/:id` | Get single item by ID |
| DELETE | `/api/:id` | Get single item by ID |

### 📁 Auth

Authentication and user session management

**Endpoints**: 4 | **Auth Required**: 4/4 | **Documentation**: [auth.md](auth.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/me` | Get single item by ID |
| PATCH | `/api/profile` | Update an existing item |
| GET | `/api/privy-user` | Get single item by ID |
| DELETE | `/api/account` | Delete an item |

### 📁 Connections

User connections and networking

**Endpoints**: 3 | **Auth Required**: 3/3 | **Documentation**: [connections.md](connections.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/by-user` | API endpoint operation |
| POST | `/api/actions` | Prevent self-connections |
| GET | `/api/status/:targetUserId` | Get latest connection event between these users |

### 📁 Discover

Discovery and search functionality

**Endpoints**: 2 | **Auth Required**: 2/2 | **Documentation**: [discover.md](discover.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/filter` | API endpoint operation |
| GET | `/api/index/share/:code/by-user` | Check access to the shared index |

### 📁 Files

File upload, storage, and management

**Endpoints**: 4 | **Auth Required**: 4/4 | **Documentation**: [files.md](files.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/` | Get all items with pagination |
| GET | `/api/:fileId` | Get single item by ID |
| POST | `/api/` | Get all items with pagination |
| DELETE | `/api/:fileId` | Check if file exists and user has access |

### 📁 Indexes

Index creation, management, and membership

**Endpoints**: 21 | **Auth Required**: 20/21 | **Documentation**: [indexes.md](indexes.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/` | Get all items with pagination |
| GET | `/api/search-users` | Search items |
| GET | `/api/:id` | Get related data |
| POST | `/api/` | Get all items with pagination |
| PUT | `/api/:id` | Get single item by ID |
| ... | ... | [View all 21 endpoints](indexes.md) |

### 📁 Integrations

External service integrations

**Endpoints**: 4 | **Auth Required**: 4/4 | **Documentation**: [integrations.md](integrations.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/` | Get user's current integrations from database |
| POST | `/api/connect/:integrationType` | Check if already connected |
| GET | `/api/status/:connectionRequestId` | Get integration record |
| DELETE | `/api/:integrationType` | First, disconnect from Composio |

### 📁 Intents

Intent creation, management, and discovery

**Endpoints**: 8 | **Auth Required**: 8/8 | **Documentation**: [intents.md](intents.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/list` | API endpoint operation |
| GET | `/api/library` | Get single item by ID |
| GET | `/api/:id` | Check access permissions |
| POST | `/api/` | Get all items with pagination |
| PUT | `/api/:id` | Get single item by ID |
| ... | ... | [View all 8 endpoints](intents.md) |

### 📁 Links

Link sharing and management

**Endpoints**: 4 | **Auth Required**: 4/4 | **Documentation**: [links.md](links.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/` | Get all items with pagination |
| POST | `/api/` | Get all items with pagination |
| DELETE | `/api/:linkId` | Delete an item |
| GET | `/api/:linkId/content` | Get single item by ID |

### 📁 Suggestions

AI-generated suggestions and recommendations

**Endpoints**: 1 | **Auth Required**: 1/1 | **Documentation**: [suggestions.md](suggestions.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/intents` | Check access |

### 📁 Sync

Data synchronization and updates

**Endpoints**: 1 | **Auth Required**: 1/1 | **Documentation**: [sync.md](sync.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/now` | Fire and forget async sync |

### 📁 Synthesis

AI-powered synthesis and insights generation

**Endpoints**: 1 | **Auth Required**: 1/1 | **Documentation**: [synthesis.md](synthesis.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/vibecheck` | Prevent self-synthesis |

### 📁 Upload

File upload handling and processing

**Endpoints**: 1 | **Auth Required**: 1/1 | **Documentation**: [upload.md](upload.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/avatar` | Return just the filename - frontend will constr... |

### 📁 Users

User profile and account management

**Endpoints**: 3 | **Auth Required**: 3/3 | **Documentation**: [users.md](users.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/:id` | Get single item by ID |
| PUT | `/api/:id` | Get single item by ID |
| DELETE | `/api/:id` | Get single item by ID |

### 📁 Vibecheck

Compatibility analysis and vibe checking

**Endpoints**: 2 | **Auth Required**: 0/2 | **Documentation**: [vibecheck.md](vibecheck.md)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/intent-suggestion` | Must have either files or payload |
| GET | `/api/temp/:fileId` | Set proper content type based on file extension |

## Error Handling

All endpoints return standard HTTP status codes with JSON error responses:

### Status Codes
- **200**: Success
- **201**: Created  
- **400**: Bad Request (validation errors)
- **401**: Unauthorized (invalid/missing token)
- **403**: Forbidden (insufficient permissions)
- **404**: Not Found
- **500**: Internal Server Error

### Error Response Format
```json
{
  "error": "Error message",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

## Pagination

List endpoints support pagination with query parameters:

- `page`: Page number (default: 1)
- `limit`: Items per page (1-100, default: 10)

**Response includes pagination info**:
```json
{
  "data": [...],
  "pagination": {
    "current": 1,
    "total": 5,
    "count": 10,
    "totalCount": 45
  }
}
```

## Rate Limiting

API requests are rate limited per API token:
- **Development**: 100 requests per minute
- **Production**: 1000 requests per minute

Check response headers:
- `X-RateLimit-Limit`: Request limit per window
- `X-RateLimit-Remaining`: Remaining requests  
- `X-RateLimit-Reset`: Reset time (Unix timestamp)

## Data Types

### Common Objects

**User Object**:
```json
{
  "id": "uuid",
  "name": "string",
  "email": "string",
  "avatar": "string (URL)",
  "intro": "string",
  "createdAt": "ISO 8601 date",
  "updatedAt": "ISO 8601 date"
}
```

**Index Object**:
```json
{
  "id": "uuid", 
  "title": "string",
  "prompt": "string",
  "linkPermissions": {
    "code": "string",
    "permissions": ["array of strings"]
  },
  "user": "User object",
  "members": ["array of User objects"],
  "_count": {
    "members": "number",
    "intents": "number"
  }
}
```

**Intent Object**:
```json
{
  "id": "uuid",
  "payload": "string", 
  "summary": "string",
  "isIncognito": "boolean",
  "createdAt": "ISO 8601 date",
  "updatedAt": "ISO 8601 date",
  "userId": "uuid",
  "indexes": ["array of Index objects"]
}
```

## SDK and Integration Examples

### JavaScript/TypeScript
```javascript
// Using fetch
const response = await fetch('https://api.index.network/api/intents', {
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
  },
  method: 'POST',
  body: JSON.stringify({
    payload: 'Looking for ML researchers to collaborate on neural networks',
    isIncognito: false,
    indexIds: ['index-uuid']
  })
});

const result = await response.json();
```

### cURL
```bash
curl -X POST https://api.index.network/api/intents \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payload": "Looking for ML researchers to collaborate on neural networks",
    "isIncognito": false,
    "indexIds": ["index-uuid"]
  }'
```

## Support and Resources

- **Documentation**: [docs.index.network](https://docs.index.network)
- **GitHub**: [github.com/indexnetwork/index](https://github.com/indexnetwork/index)
- **Discord**: [discord.gg/wvdxP6XvYu](https://discord.gg/wvdxP6XvYu)
- **Twitter**: [@indexnetwork_](https://x.com/indexnetwork_)
- **Website**: [index.network](https://index.network)

## Changelog

- **v1.0.0** - Initial API release with full authentication, index, intent, and discovery functionality
- See [GitHub releases](https://github.com/indexnetwork/index/releases) for detailed version history

---

*Generated automatically from route definitions - Last updated: 2025-09-21*
