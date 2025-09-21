# Suggestions API

AI-generated suggestions and recommendations

This module contains **1 endpoints** for ai-generated suggestions and recommendations.

## Authentication

**Required**: All endpoints in this module require authentication.

## Endpoints

### GET /api/intents

Check access

🔒 **Auth Required**

**Path Parameters**:

| Name | Type | Description |
|------|------|-------------|
| `indexId` | string (UUID) | indexId parameter |

**Responses**:

❌ **400**: Bad Request - Invalid parameters or validation failed
❌ **404**: Not Found - Resource does not exist
💥 **500**: Internal Server Error

**Example Request**:
```javascript
fetch('/api/intents', {
  method: 'GET',
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
- **Methods**: GET

[← Back to API Documentation](API.md)

---

*Generated automatically from route definitions - Last updated: 2025-09-21*
