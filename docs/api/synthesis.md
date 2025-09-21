# Synthesis API

AI-powered synthesis and insights generation

This module contains **1 endpoints** for ai-powered synthesis and insights generation.

## Authentication

**Required**: All endpoints in this module require authentication.

## Endpoints

### POST /api/vibecheck

Prevent self-synthesis

🔒 **Auth Required**

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `targetUserId` | string (UUID) | ✅ Yes | targetUserId parameter |
| `intentIds` | string (UUID) | ❌ No | intentIds parameter |
| `intentIds.*` | string (UUID) | ❌ No | intentIds.* parameter |
| `indexIds` | string (UUID) | ❌ No | indexIds parameter |
| `indexIds.*` | string (UUID) | ❌ No | indexIds.* parameter |
| `options` | string | ❌ No | options parameter |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "targetUserId": {
      "type": "string",
      "description": "targetUserId parameter"
    },
    "intentIds": {
      "type": "string",
      "description": "intentIds parameter"
    },
    "intentIds.*": {
      "type": "string",
      "description": "intentIds.* parameter"
    },
    "indexIds": {
      "type": "string",
      "description": "indexIds parameter"
    },
    "indexIds.*": {
      "type": "string",
      "description": "indexIds.* parameter"
    },
    "options": {
      "type": "string",
      "description": "options parameter"
    }
  },
  "required": [
    "targetUserId"
  ]
}
```

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/vibecheck', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "targetUserId": "example-targetUserId",
  "intentIds": "example-intentIds",
  "intentIds.*": "example-intentIds.*",
  "indexIds": "example-indexIds",
  "indexIds.*": "example-indexIds.*",
  "options": "example-options"
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
