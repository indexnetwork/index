# Files API

File upload, storage, and management

This module contains **4 endpoints** for file upload, storage, and management.

## Authentication

**Required**: All endpoints in this module require authentication.

## Endpoints

### GET /api/

Get all items with pagination

🔒 **Auth Required**

**Query Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `page` | integer | ❌ No | Page number for pagination (default: 1) |

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
fetch('/api/?page=1', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### GET /api/:fileId

Get single item by ID

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `fileId` | string (UUID) | fileId parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:fileId', {
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

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
✅ **201**: Created
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
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### DELETE /api/:fileId

Check if file exists and user has access

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `fileId` | string (UUID) | fileId parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
❌ **403**: Forbidden - Insufficient permissions
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:fileId', {
  method: 'DELETE',
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
