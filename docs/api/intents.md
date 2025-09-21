# Intents API

Intent creation, management, and discovery

This module contains **8 endpoints** for intent creation, management, and discovery.

## Authentication

**Required**: All endpoints in this module require authentication.

## Endpoints

### POST /api/list

API endpoint operation

🔒 **Auth Required**

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `page` | integer | ❌ No | Page number for pagination (default: 1) |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
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
fetch('/api/list', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "page": 1
})
})
```

---

### GET /api/library

Get single item by ID

🔒 **Auth Required**

**Responses**:

💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/library', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### GET /api/:id

Check access permissions

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
❌ **403**: Forbidden - Insufficient permissions
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
fetch('/api/', {
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
| `payload` | string | ❌ No | Content or description |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "payload": {
      "type": "string",
      "description": "Content or description"
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
  "payload": "example-payload"
})
})
```

---

### PATCH /api/:id/archive

Check if intent exists and user owns it

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
❌ **403**: Forbidden - Insufficient permissions
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id/archive', {
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### PATCH /api/:id/unarchive

Check if intent exists and user owns it

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | string (UUID) | id parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
❌ **403**: Forbidden - Insufficient permissions
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:id/unarchive', {
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### POST /api/suggest-tags

API endpoint operation

🔒 **Auth Required**

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `prompt` | string | ❌ No | prompt parameter |
| `indexId` | string (UUID) | ❌ No | Index ID |
| `maxSuggestions` | string | ❌ No | maxSuggestions parameter |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "prompt parameter"
    },
    "indexId": {
      "type": "string",
      "description": "Index ID"
    },
    "maxSuggestions": {
      "type": "string",
      "description": "maxSuggestions parameter"
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
fetch('/api/suggest-tags', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "prompt": "example-prompt",
  "indexId": "index-12345678-1234-1234-1234-123456789abc",
  "maxSuggestions": "example-maxSuggestions"
})
})
```

---

## Module Summary

- **Total Endpoints**: 8
- **Authentication Required**: 8
- **Public Endpoints**: 0
- **Methods**: POST, GET, PUT, PATCH

[← Back to API Documentation](API.md)

---

*Generated automatically from route definitions - Last updated: 2025-09-21*
