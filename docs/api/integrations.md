# Integrations API

External service integrations

This module contains **4 endpoints** for external service integrations.

## Authentication

**Required**: All endpoints in this module require authentication.

## Endpoints

### GET /api/

Get user's current integrations from database

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

### POST /api/connect/:integrationType

Check if already connected

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `integrationType` | string | integrationType parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **409**: HTTP 409
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/connect/:integrationType', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### GET /api/status/:connectionRequestId

Get integration record

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `connectionRequestId` | string (UUID) | connectionRequestId parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/status/:connectionRequestId', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### DELETE /api/:integrationType

First, disconnect from Composio

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `integrationType` | string | integrationType parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/:integrationType', {
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
