# Links API

Link sharing and management

This module contains **4 endpoints** for link sharing and management.

## Authentication

**Required**: All endpoints in this module require authentication.

## Endpoints

### GET /api/

Get all items with pagination

🔒 **Auth Required**

**Responses**:

💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### POST /api/

Get all items with pagination

🔒 **Auth Required**

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `url` | string | ✅ Yes | url parameter |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "url parameter"
    }
  },
  "required": [
    "url"
  ]
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
fetch('/api/', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "url": "example-url"
})
})
```

---

### DELETE /api/:linkId

Delete an item

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `linkId` | string (UUID) | linkId parameter |

**Responses**:

💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:linkId', {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### GET /api/:linkId/content

Get single item by ID

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `linkId` | string (UUID) | linkId parameter |

**Responses**:

❌ **404**: Not Found - Resource does not exist
✅ **202**: HTTP 202
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:linkId/content', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

## Module Summary

- **Total Endpoints**: 4
- **Authentication Required**: 4
- **Public Endpoints**: 0
- **Methods**: GET, POST, DELETE

[← Back to API Documentation](API.md)

---

*Generated automatically from route definitions - Last updated: 2025-09-21*
