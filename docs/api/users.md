# Users API

User profile and account management

This module contains **3 endpoints** for user profile and account management.

## Authentication

**Required**: All endpoints in this module require authentication.

## Endpoints

### GET /api/:id

Get single item by ID

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### PUT /api/:id

Get single item by ID

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | ❌ No | Name of the item |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Name of the item"
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
fetch('/api/:id', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "name": "example-name"
})
})
```

---

### DELETE /api/:id

Get single item by ID

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **403**: Forbidden - Insufficient permissions
❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id', {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

## Module Summary

- **Total Endpoints**: 3
- **Authentication Required**: 3
- **Public Endpoints**: 0
- **Methods**: GET, PUT, DELETE

[← Back to API Documentation](API.md)

---

*Generated automatically from route definitions - Last updated: 2025-09-21*
