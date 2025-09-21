# Connections API

User connections and networking

This module contains **3 endpoints** for user connections and networking.

## Authentication

**Required**: All endpoints in this module require authentication.

## Endpoints

### POST /api/by-user

API endpoint operation

🔒 **Auth Required**

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `type` | string | ❌ No | type parameter |
| `page` | integer | ❌ No | Page number for pagination (default: 1) |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "description": "type parameter"
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
fetch('/api/by-user', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "type": "example-type",
  "page": 1
})
})
```

---

### POST /api/actions

Prevent self-connections

🔒 **Auth Required**

**Request Body Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `targetUserId` | string (UUID) | ✅ Yes | targetUserId parameter |
| `action` | string | ✅ Yes | action parameter |

**Request Body Schema**:
```json
{
  "type": "object",
  "properties": {
    "targetUserId": {
      "type": "string",
      "description": "targetUserId parameter"
    },
    "action": {
      "type": "string",
      "description": "action parameter"
    }
  },
  "required": [
    "targetUserId",
    "action"
  ]
}
```

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/actions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
  body: JSON.stringify({
  "targetUserId": "example-targetUserId",
  "action": "example-action"
})
})
```

---

### GET /api/status/:targetUserId

Get latest connection event between these users

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `targetUserId` | string (UUID) | targetUserId parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/status/:targetUserId', {
  method: 'GET',
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
- **Methods**: POST, GET

[← Back to API Documentation](API.md)

---

*Generated automatically from route definitions - Last updated: 2025-09-21*
