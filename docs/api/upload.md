# Upload API

File upload handling and processing

This module contains **1 endpoints** for file upload handling and processing.

## Authentication

**Required**: All endpoints in this module require authentication.

## Endpoints

### POST /api/avatar

Return just the filename - frontend will construct the full URL

🔒 **Auth Required**

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/avatar', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
  },
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
