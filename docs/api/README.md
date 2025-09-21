# 📚 Index Network API Documentation

This directory contains comprehensive API documentation for the Index Network Protocol, automatically generated from the route definitions in the codebase.

## 📖 Documentation Files

### Main Documentation
- **[API.md](API.md)** - Complete API overview with all 64 endpoints across 15 modules
- **[index.html](index.html)** - Interactive Swagger UI documentation viewer
- **[openapi.json](openapi.json)** - OpenAPI 3.0.3 specification (machine-readable)
- **[openapi.yaml](openapi.yaml)** - OpenAPI spec in YAML format (human-readable)

### Module-Specific Documentation
| Module | Endpoints | Description | Documentation |
|--------|-----------|-------------|---------------|
| **Agents** | 5 | AI agent management and operations | [agents.md](agents.md) |
| **Auth** | 4 | Authentication and user session management | [auth.md](auth.md) |
| **Connections** | 3 | User connections and networking | [connections.md](connections.md) |
| **Discover** | 2 | Discovery and search functionality | [discover.md](discover.md) |
| **Files** | 4 | File upload, storage, and management | [files.md](files.md) |
| **Indexes** | 21 | Index creation, management, and membership | [indexes.md](indexes.md) |
| **Integrations** | 3 | External service integrations | [integrations.md](integrations.md) |
| **Intents** | 6 | Intent creation, management, and discovery | [intents.md](intents.md) |
| **Links** | 3 | Link sharing and management | [links.md](links.md) |
| **Suggestions** | 1 | AI-generated suggestions and recommendations | [suggestions.md](suggestions.md) |
| **Sync** | 2 | Data synchronization and updates | [sync.md](sync.md) |
| **Synthesis** | 2 | AI-powered synthesis and insights generation | [synthesis.md](synthesis.md) |
| **Upload** | 1 | File upload handling and processing | [upload.md](upload.md) |
| **Users** | 3 | User profile and account management | [users.md](users.md) |
| **VibeCheck** | 4 | Compatibility analysis and vibe checking | [vibecheck.md](vibecheck.md) |

## 🚀 Quick Start

1. **Interactive Documentation**: Open `index.html` in your browser for Swagger UI interface
2. **Start with [API.md](API.md)** for a comprehensive overview
3. **Browse module documentation** for specific functionality
4. **Use the OpenAPI spec** with tools like Postman, Insomnia, or Swagger UI

## 🔧 Tools and Integration

### OpenAPI Compatible Tools
- **Swagger UI**: Import `openapi.json` for interactive documentation
- **Postman**: Import the OpenAPI spec to generate a collection
- **Insomnia**: Load the spec for API testing
- **Code Generators**: Generate SDKs in various languages

### Online Swagger UI
You can view the interactive documentation by:

**Option 1 - Local HTML Viewer:**
1. Open `docs/api/index.html` in your browser
2. The interactive documentation will load automatically

**Option 2 - Online Swagger Editor:**
1. Going to [swagger.io/tools/swagger-editor](https://swagger.io/tools/swagger-editor/)
2. Importing the `openapi.yaml` file
3. Exploring the interactive documentation

## 📝 Documentation Generation

The documentation is automatically generated from the Express.js route definitions using our custom documentation generator.

### Regenerating Documentation

To regenerate the API documentation after making changes to the routes:

```bash
# From the protocol directory
cd protocol
npm run docs:api

# Or from the root directory
node scripts/generate-api-docs.js
```

### What Gets Generated

The generator analyzes route files and extracts:
- ✅ **HTTP Methods**: GET, POST, PUT, DELETE, PATCH
- ✅ **Route Paths**: Including parameter patterns
- ✅ **Authentication Requirements**: Detected from middleware usage
- ✅ **Parameters**: Path, query, and body parameters with types
- ✅ **Validation**: Inferred from express-validator usage
- ✅ **Response Schemas**: Basic structure from res.json patterns
- ✅ **Examples**: Generated with realistic sample data

## 📋 API Overview

### Base URLs
- **Production**: `https://api.index.network/api`
- **Development**: `http://localhost:3001/api`

### Authentication
Most endpoints require Bearer token authentication:
```http
Authorization: Bearer YOUR_API_TOKEN
```

### Response Format
All endpoints return JSON responses with consistent error handling:
```json
{
  "error": "Error message",
  "errors": [{ "field": "name", "message": "Field is required" }]
}
```

### Status Codes
- `200` Success
- `201` Created
- `400` Bad Request (validation errors)
- `401` Unauthorized
- `403` Forbidden
- `404` Not Found
- `500` Internal Server Error

## 🔗 Related Documentation

- **[Integration Guide](../INTEGRATION_GUIDE.md)** - Detailed integration examples
- **[How It Works](../../HOWITWORKS.md)** - Technical architecture overview
- **[README](../../README.md)** - Project overview and setup

## 🤝 Contributing

When adding new endpoints or modifying existing ones:

1. **Add route documentation** in the route file using comments
2. **Use express-validator** for parameter validation (helps with auto-documentation)
3. **Follow consistent response patterns** 
4. **Regenerate documentation** using `npm run docs:api`
5. **Update integration examples** if needed

## 📊 Statistics

- **Total Endpoints**: 64
- **Total Modules**: 15
- **Authentication Required**: ~90% of endpoints
- **Generated Files**: 18 documentation files
- **Last Updated**: Auto-generated timestamp in each file

---

*This documentation is automatically generated from route definitions. For the most up-to-date information, always refer to the generated files.*