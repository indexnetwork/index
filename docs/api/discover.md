# Discover API

Discovery and search functionality

This module contains **2 endpoints** for discovery and search functionality.

## Authentication

**Required**: All endpoints in this module require authentication.

## Endpoints

### POST /api/filter

API endpoint operation

🔒 **Auth Required**

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `intentIds` | string (UUID) | ❌ No | intentIds parameter |
| `intentIds.*` | string (UUID) | ❌ No | intentIds.* parameter |
| `userIds` | string (UUID) | ❌ No | userIds parameter |
| `userIds.*` | string (UUID) | ❌ No | userIds.* parameter |
| `indexIds` | string (UUID) | ❌ No | indexIds parameter |
| `indexIds.*` | string (UUID) | ❌ No | indexIds.* parameter |
| `sources` | string | ❌ No | sources parameter |
| `sources.*.type` | string | ❌ No | sources.*.type parameter |
| `sources.*.id` | string | ❌ No | sources.*.id parameter |
| `excludeDiscovered` | boolean | ❌ No | excludeDiscovered parameter |
| `page` | integer | ❌ No | Page number for pagination (default: 1) |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "intentIds": {
      "type": "string",
      "description": "intentIds parameter"
    },
    "intentIds.*": {
      "type": "string",
      "description": "intentIds.* parameter"
    },
    "userIds": {
      "type": "string",
      "description": "userIds parameter"
    },
    "userIds.*": {
      "type": "string",
      "description": "userIds.* parameter"
    },
    "indexIds": {
      "type": "string",
      "description": "indexIds parameter"
    },
    "indexIds.*": {
      "type": "string",
      "description": "indexIds.* parameter"
    },
    "sources": {
      "type": "string",
      "description": "sources parameter"
    },
    "sources.*.type": {
      "type": "string",
      "description": "sources.*.type parameter"
    },
    "sources.*.id": {
      "type": "string",
      "description": "sources.*.id parameter"
    },
    "excludeDiscovered": {
      "type": "boolean",
      "description": "excludeDiscovered parameter"
    },
    "page": {
      "type": "integer",
      "description": "Page number for pagination (default: 1)"
    }
  }
}
```

**Responses**:

✅ **200**: Success
```json
{
  "type": "object",
  "properties": {
    "success": {
      "type": "boolean",
      "description": "Operation success"
    }
  }
}
```

**Example Request**:
```javascript
fetch('/api/filter', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "intentIds": "example-intentIds",
  "intentIds.*": "example-intentIds.*",
  "userIds": "example-userIds",
  "userIds.*": "example-userIds.*",
  "indexIds": "example-indexIds",
  "indexIds.*": "example-indexIds.*",
  "sources": "example-sources",
  "sources.*.type": "example-sources.*.type",
  "sources.*.id": "example-sources.*.id",
  "excludeDiscovered": false,
  "page": 1
})
})
```

---

### GET /api/index/share/:code/by-user

Check access to the shared index

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `code` | string (UUID) | code parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **403**: Forbidden - Insufficient permissions
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/index/share/:code/by-user', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

## Module Summary

- **Total Endpoints**: 2
- **Authentication Required**: 2
- **Public Endpoints**: 0
- **Methods**: POST, GET

[← Back to API Documentation](API.md)

---

*Generated automatically from route definitions - Last updated: 2025-09-21*
