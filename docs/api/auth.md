# Auth API

Authentication and user session management

This module contains **4 endpoints** for authentication and user session management.

## Authentication

**Required**: All endpoints in this module require authentication.

## Endpoints

### GET /api/me

Get single item by ID

🔒 **Auth Required**

**Responses**:

❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/me', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### PATCH /api/profile

Update an existing item

🔒 **Auth Required**

**Responses**:

❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/profile', {
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### GET /api/privy-user

Get single item by ID

🔒 **Auth Required**

**Responses**:

💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/privy-user', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
})
```

---

### DELETE /api/account

Delete an item

🔒 **Auth Required**

**Responses**:

💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/account', {
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
- **Methods**: GET, PATCH, DELETE

[← Back to API Documentation](API.md)

---

*Generated automatically from route definitions - Last updated: 2025-09-21*
