# Indexes API

Index creation, management, and membership

This module contains **21 endpoints** for index creation, management, and membership.

## Authentication

**Mixed**: 20 endpoints require authentication, 1 are public.

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

### GET /api/search-users

Search items

🔒 **Auth Required**

**Query Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `q` | string | ✅ Yes | q parameter |

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
fetch('/api/search-users?q=example-q', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### GET /api/:id

Get related data

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
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

### POST /api/

Get all items with pagination

🔒 **Auth Required**

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `title` | string | ✅ Yes | Title of the item |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "Title of the item"
    }
  },
  "required": [
    "title"
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
  "title": "example-title"
})
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
| `title` | string | ❌ No | Title of the item |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "Title of the item"
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
  "title": "example-title"
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

### POST /api/:id/members

Validate user exists

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `userId` | string (UUID) | ✅ Yes | User ID |
| `permissions` | array | ✅ Yes | Array of permission strings |
| `permissions.*` | boolean | ✅ Yes | permissions.* parameter |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "userId": {
      "type": "string",
      "description": "User ID"
    },
    "permissions": {
      "type": "array",
      "description": "Array of permission strings"
    },
    "permissions.*": {
      "type": "boolean",
      "description": "permissions.* parameter"
    }
  },
  "required": [
    "userId",
    "permissions",
    "permissions.*"
  ]
}
```

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
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
fetch('/api/:id/members', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "userId": "user-12345678-1234-1234-1234-123456789abc",
  "permissions": [],
  "permissions.*": false
})
})
```

---

### DELETE /api/:id/members/:userId

Check if member exists

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |
| `userId` | string (UUID) | userId parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id/members/:userId', {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### POST /api/:id/leave

Check if user is a member

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
fetch('/api/:id/leave', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### PATCH /api/:id/members/:userId

Validate permissions

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |
| `userId` | string (UUID) | userId parameter |

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `permissions` | array | ✅ Yes | Array of permission strings |
| `permissions.*` | boolean | ✅ Yes | permissions.* parameter |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "permissions": {
      "type": "array",
      "description": "Array of permission strings"
    },
    "permissions.*": {
      "type": "boolean",
      "description": "permissions.* parameter"
    }
  },
  "required": [
    "permissions",
    "permissions.*"
  ]
}
```

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id/members/:userId', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "permissions": [],
  "permissions.*": false
})
})
```

---

### PATCH /api/:id/link-permissions

Validate link permissions

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `permissions` | array | ✅ Yes | Array of permission strings |
| `permissions.*` | boolean | ✅ Yes | permissions.* parameter |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "permissions": {
      "type": "array",
      "description": "Array of permission strings"
    },
    "permissions.*": {
      "type": "boolean",
      "description": "permissions.* parameter"
    }
  },
  "required": [
    "permissions",
    "permissions.*"
  ]
}
```

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id/link-permissions', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "permissions": [],
  "permissions.*": false
})
})
```

---

### GET /api/:id/members

Get single item by ID

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id/members', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### GET /api/:id/member-settings

Use existing access control method

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id/member-settings', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### PUT /api/:id/member-settings

Use existing access control method

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `prompt` | string | ❌ No | prompt parameter |
| `autoAssign` | string | ❌ No | autoAssign parameter |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "prompt parameter"
    },
    "autoAssign": {
      "type": "string",
      "description": "autoAssign parameter"
    }
  }
}
```

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id/member-settings', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "prompt": "example-prompt",
  "autoAssign": "example-autoAssign"
})
})
```

---

### GET /api/share/:code

Get single item by ID

🔓 **Public**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `code` | string (UUID) | code parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/share/:code', {
  method: 'GET',

})
```

---

### DELETE /api/:indexId/intents/:intentId

Check if intent exists

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `intentId` | string (UUID) | intentId parameter |
| `indexId` | string (UUID) | indexId parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:indexId/intents/:intentId', {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### POST /api/share/:code/intents

Access via share code

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `code` | string (UUID) | code parameter |

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `payload` | string | ✅ Yes | Content or description |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "payload": {
      "type": "string",
      "description": "Content or description"
    }
  },
  "required": [
    "payload"
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
fetch('/api/share/:code/intents', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "payload": "example-payload"
})
})
```

---

### GET /api/:indexId/intents

API endpoint operation

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `indexId` | string (UUID) | indexId parameter |

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
fetch('/api/:indexId/intents?page=1', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### GET /api/:id/member-intents

Use existing access control method

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id/member-intents', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### POST /api/:id/member-intents/:intentId

Use existing access control method

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |
| `intentId` | string (UUID) | intentId parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id/member-intents/:intentId', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### DELETE /api/:id/member-intents/:intentId

Use existing access control method

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |
| `intentId` | string (UUID) | intentId parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id/member-intents/:intentId', {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

## Module Summary

- **Total Endpoints**: 21
- **Authentication Required**: 20
- **Public Endpoints**: 1
- **Methods**: GET, POST, PUT, DELETE, PATCH

[← Back to API Documentation](API.md)

---

*Generated automatically from route definitions - Last updated: 2025-09-21*
