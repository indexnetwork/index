# Sync API

Data synchronization and updates

This module contains **1 endpoints** for data synchronization and updates.

## Authentication

**Required**: All endpoints in this module require authentication.

## Endpoints

### POST /api/now

Fire and forget async sync

🔒 **Auth Required**

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `provider` | string | ✅ Yes | provider parameter |
| `params` | string | ❌ No | params parameter |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "provider": {
      "type": "string",
      "description": "provider parameter"
    },
    "params": {
      "type": "string",
      "description": "params parameter"
    }
  },
  "required": [
    "provider"
  ]
}
```

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
✅ **202**: HTTP 202
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/now', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "provider": "example-provider",
  "params": "example-params"
})
})
```

---

## Module Summary

- **Total Endpoints**: 1
- **Authentication Required**: 1
- **Public Endpoints**: 0
- **Methods**: POST

[← Back to API Documentation](API.md)

---

*Generated automatically from route definitions - Last updated: 2025-09-21*
