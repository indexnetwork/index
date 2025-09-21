# Vibecheck API

Compatibility analysis and vibe checking

This module contains **2 endpoints** for compatibility analysis and vibe checking.

## Authentication

**Not Required**: All endpoints in this module are public.

## Endpoints

### POST /api/intent-suggestion

Must have either files or payload

🔓 **Public**

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `payload` | string | ❌ No | Content or description |
| `indexCode` | string | ❌ No | indexCode parameter |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "payload": {
      "type": "string",
      "description": "Content or description"
    },
    "indexCode": {
      "type": "string",
      "description": "indexCode parameter"
    }
  }
}
```

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/intent-suggestion', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',

  },
  body: JSON.stringify({
  "payload": "example-payload",
  "indexCode": "example-indexCode"
})
})
```

---

### GET /api/temp/:fileId

Set proper content type based on file extension

🔓 **Public**

**Responses**:

❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/temp/:fileId', {
  method: 'GET',

})
```

---

## Module Summary

- **Total Endpoints**: 2
- **Authentication Required**: 0
- **Public Endpoints**: 2
- **Methods**: POST, GET

[← Back to API Documentation](API.md)

---

*Generated automatically from route definitions - Last updated: 2025-09-21*
