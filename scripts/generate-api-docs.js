const fs = require('fs');
const path = require('path');

class APIDocGenerator {
  constructor(routesDir, outputDir) {
    this.routesDir = routesDir;
    this.outputDir = outputDir;
  }

  async generateDocs() {
    console.log('🔍 Scanning route files...');
    
    const routeFiles = fs.readdirSync(this.routesDir)
      .filter(file => file.endsWith('.ts'))
      .sort();

    const modules = [];
    
    for (const file of routeFiles) {
      console.log(`📄 Processing ${file}...`);
      const module = await this.parseRouteFile(path.join(this.routesDir, file));
      if (module.endpoints.length > 0) {
        modules.push(module);
      }
    }

    console.log('📝 Generating documentation...');
    await this.generateMarkdownDocs(modules);
    await this.generateOpenAPISpec(modules);
    
    console.log(`✅ API documentation generated in ${this.outputDir}`);
    console.log(`📊 Total modules: ${modules.length}`);
    console.log(`📊 Total endpoints: ${modules.reduce((sum, m) => sum + m.endpoints.length, 0)}`);
  }

  async parseRouteFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath, '.ts');
    
    const module = {
      name: fileName,
      description: this.extractModuleDescription(fileName),
      endpoints: []
    };

    // Extract router methods (GET, POST, PUT, DELETE, etc.)
    const routerMethods = content.match(/router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]*?)['"`]/g) || [];
    
    for (const match of routerMethods) {
      const methodMatch = match.match(/router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]*?)['"`]/);
      if (methodMatch) {
        const method = methodMatch[1].toUpperCase();
        const routePath = methodMatch[2];
        
        const endpoint = this.extractEndpointInfo(content, method, routePath, match);
        module.endpoints.push(endpoint);
      }
    }

    return module;
  }

  extractModuleDescription(fileName) {
    const descriptions = {
      'auth': 'Authentication and user session management',
      'users': 'User profile and account management', 
      'indexes': 'Index creation, management, and membership',
      'intents': 'Intent creation, management, and discovery',
      'files': 'File upload, storage, and management',
      'connections': 'User connections and networking',
      'vibecheck': 'Compatibility analysis and vibe checking',
      'synthesis': 'AI-powered synthesis and insights generation',
      'integrations': 'External service integrations',
      'discover': 'Discovery and search functionality',
      'links': 'Link sharing and management',
      'suggestions': 'AI-generated suggestions and recommendations',
      'upload': 'File upload handling and processing',
      'sync': 'Data synchronization and updates',
      'agents': 'AI agent management and operations'
    };
    
    return descriptions[fileName] || `${fileName.charAt(0).toUpperCase() + fileName.slice(1)} operations`;
  }

  extractEndpointInfo(content, method, routePath, matchStr) {
    const startIndex = content.indexOf(matchStr);
    const endIndex = this.findEndOfRoute(content, startIndex);
    const routeContent = content.substring(startIndex, endIndex);
    
    const endpoint = {
      method,
      path: this.normalizePath(routePath),
      description: this.extractDescription(routeContent, routePath),
      authentication: this.hasAuthentication(routeContent),
      parameters: this.extractParameters(routeContent),
      responses: this.extractResponses(routeContent),
    };

    // Add request body schema for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      endpoint.requestBody = this.extractRequestBody(routeContent);
    }

    endpoint.example = this.generateExample(endpoint);

    return endpoint;
  }

  findEndOfRoute(content, startIndex) {
    let braceCount = 0;
    let inRoute = false;
    
    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      
      if (char === '(' && !inRoute) {
        inRoute = true;
      } else if (inRoute) {
        if (char === '{') braceCount++;
        if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            return i + 1;
          }
        }
      }
    }
    
    return Math.min(startIndex + 1000, content.length); // fallback
  }

  normalizePath(path) {
    return path.startsWith('/') ? `/api${path}` : `/api/${path}`;
  }

  extractDescription(content, routePath) {
    // Look for comments above the route
    const lines = content.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line.startsWith('//') && !line.includes('router.')) {
        return line.replace('//', '').trim();
      }
    }
    
    // Generate description based on patterns
    if (content.includes('Get all') || routePath === '/') return 'Get all items with pagination';
    if (content.includes('Get single') || content.includes('Get ') || routePath.includes(':id')) return 'Get single item by ID';
    if (content.includes('Create') || routePath.includes('/create')) return 'Create a new item';
    if (content.includes('Update') || content.includes('PUT') || content.includes('PATCH')) return 'Update an existing item';
    if (content.includes('Delete') || content.includes('DELETE')) return 'Delete an item';
    if (routePath.includes('/search')) return 'Search items';
    if (routePath.includes('/members')) return 'Manage members';
    if (routePath.includes('/suggestions')) return 'Get suggestions';
    if (routePath.includes('/share')) return 'Access via share code';
    
    return 'API endpoint operation';
  }

  hasAuthentication(content) {
    return content.includes('authenticatePrivy') || 
           content.includes('AuthRequest') ||
           content.includes('req.user');
  }

  extractParameters(content) {
    const parameters = [];
    
    // Extract path parameters
    const pathParams = content.match(/param\(['"`]([^'"`]+)['"`]\)/g) || [];
    for (const param of pathParams) {
      const name = param.match(/param\(['"`]([^'"`]+)['"`]\)/)?.[1];
      if (name) {
        parameters.push({
          name,
          type: this.guessParameterType(content, name),
          required: true,
          description: `${name} parameter`,
          in: 'path'
        });
      }
    }
    
    // Extract query parameters
    const queryParams = content.match(/query\(['"`]([^'"`]+)['"`]\)/g) || [];
    for (const param of queryParams) {
      const name = param.match(/query\(['"`]([^'"`]+)['"`]\)/)?.[1];
      if (name) {
        parameters.push({
          name,
          type: this.guessParameterType(content, name),
          required: !content.includes(`query('${name}').optional`),
          description: this.getParameterDescription(name),
          in: 'query'
        });
      }
    }

    // Extract body parameters
    const bodyParams = content.match(/body\(['"`]([^'"`]+)['"`]\)/g) || [];
    for (const param of bodyParams) {
      const name = param.match(/body\(['"`]([^'"`]+)['"`]\)/)?.[1];
      if (name) {
        parameters.push({
          name,
          type: this.guessParameterType(content, name),
          required: !content.includes(`body('${name}').optional`),
          description: this.getParameterDescription(name),
          in: 'body'
        });
      }
    }
    
    return parameters;
  }

  getParameterDescription(paramName) {
    const descriptions = {
      'id': 'Unique identifier',
      'userId': 'User ID',
      'indexId': 'Index ID', 
      'intentId': 'Intent ID',
      'page': 'Page number for pagination (default: 1)',
      'limit': 'Number of items per page (1-100, default: 10)',
      'archived': 'Include archived items',
      'title': 'Title of the item',
      'payload': 'Content or description',
      'isIncognito': 'Whether to hide user identity',
      'name': 'Name of the item',
      'email': 'Email address',
      'avatar': 'Avatar URL',
      'intro': 'Introduction text',
      'permissions': 'Array of permission strings',
      'code': 'Share code for access',
      'query': 'Search query string',
      'tags': 'Array of tags'
    };
    
    return descriptions[paramName] || `${paramName} parameter`;
  }

  guessParameterType(content, paramName) {
    if (content.includes(`${paramName}').isUUID`)) return 'string (UUID)';
    if (content.includes(`${paramName}').isInt`)) return 'integer';
    if (content.includes(`${paramName}').isBoolean`)) return 'boolean';
    if (content.includes(`${paramName}').isArray`)) return 'array';
    if (content.includes(`${paramName}').isEmail`)) return 'string (email)';
    if (paramName.includes('Id') || paramName === 'id') return 'string (UUID)';
    if (paramName === 'page' || paramName === 'limit') return 'integer';
    if (paramName === 'archived' || paramName.includes('is')) return 'boolean';
    
    return 'string';
  }

  extractResponses(content) {
    const responses = [];
    
    // Look for status codes in the content
    const statusMatches = content.match(/res\.status\((\d+)\)/g) || [];
    const statuses = [...new Set(statusMatches.map(match => 
      parseInt(match.match(/res\.status\((\d+)\)/)?.[1] || '200')
    ))];
    
    if (statuses.length === 0) {
      statuses.push(200); // Default success
    }
    
    for (const status of statuses) {
      responses.push({
        status,
        description: this.getStatusDescription(status),
        schema: status === 200 || status === 201 ? this.extractSuccessSchema(content) : undefined
      });
    }
    
    return responses;
  }

  getStatusDescription(status) {
    const descriptions = {
      200: 'Success',
      201: 'Created',
      400: 'Bad Request - Invalid parameters or validation failed',
      401: 'Unauthorized - Authentication required',
      403: 'Forbidden - Insufficient permissions',
      404: 'Not Found - Resource does not exist',
      500: 'Internal Server Error'
    };
    
    return descriptions[status] || `HTTP ${status}`;
  }

  extractSuccessSchema(content) {
    // Try to infer response structure from res.json calls
    if (content.includes('res.json({ user:')) return { type: 'object', properties: { user: { type: 'object', description: 'User object' } } };
    if (content.includes('res.json({ users:')) return { type: 'object', properties: { users: { type: 'array', description: 'Array of user objects' } } };
    if (content.includes('res.json({ index:')) return { type: 'object', properties: { index: { type: 'object', description: 'Index object' } } };
    if (content.includes('res.json({ indexes:')) return { type: 'object', properties: { indexes: { type: 'array', description: 'Array of index objects' } } };
    if (content.includes('res.json({ intent:')) return { type: 'object', properties: { intent: { type: 'object', description: 'Intent object' } } };
    if (content.includes('res.json({ intents:')) return { type: 'object', properties: { intents: { type: 'array', description: 'Array of intent objects' } } };
    if (content.includes('res.json({ message:')) return { type: 'object', properties: { message: { type: 'string', description: 'Success message' } } };
    if (content.includes('pagination')) return { 
      type: 'object', 
      properties: { 
        data: { type: 'array', description: 'Array of items' },
        pagination: { type: 'object', description: 'Pagination information' }
      } 
    };
    
    return { type: 'object', properties: { success: { type: 'boolean', description: 'Operation success' } } };
  }

  extractRequestBody(content) {
    const bodyParams = this.extractParameters(content).filter(p => p.in === 'body');
    if (bodyParams.length === 0) return undefined;
    
    const properties = {};
    const required = [];
    
    for (const param of bodyParams) {
      properties[param.name] = {
        type: param.type.split(' ')[0], // Remove description part like "(UUID)"
        description: param.description
      };
      if (param.required) {
        required.push(param.name);
      }
    }
    
    return { 
      type: 'object', 
      properties,
      required: required.length > 0 ? required : undefined
    };
  }

  generateExample(endpoint) {
    const hasAuth = endpoint.authentication;
    const authHeader = hasAuth ? "    'Authorization': 'Bearer YOUR_API_TOKEN'," : '';
    
    let pathExample = endpoint.path;
    const pathParams = endpoint.parameters.filter(p => p.in === 'path');
    for (const param of pathParams) {
      pathExample = pathExample.replace(`{${param.name}}`, this.getExampleValue(param.name));
    }
    
    const queryParams = endpoint.parameters.filter(p => p.in === 'query');
    if (queryParams.length > 0) {
      const queryString = queryParams.map(p => `${p.name}=${this.getExampleValue(p.name)}`).join('&');
      pathExample += `?${queryString}`;
    }
    
    if (['POST', 'PUT', 'PATCH'].includes(endpoint.method) && endpoint.requestBody) {
      const bodyExample = this.generateBodyExample(endpoint.requestBody);
      return `fetch('${pathExample}', {
  method: '${endpoint.method}',
  headers: {
    'Content-Type': 'application/json',
${authHeader}
  },
  body: JSON.stringify(${bodyExample})
})`;
    }
    
    const headers = hasAuth ? `  headers: {\n${authHeader}\n  },` : '';
    return `fetch('${pathExample}', {
  method: '${endpoint.method}',
${headers}
})`;
  }

  getExampleValue(paramName) {
    const examples = {
      'id': 'uuid-12345678-1234-1234-1234-123456789abc',
      'userId': 'user-12345678-1234-1234-1234-123456789abc',
      'indexId': 'index-12345678-1234-1234-1234-123456789abc',
      'intentId': 'intent-12345678-1234-1234-1234-123456789abc',
      'code': 'abc123def456',
      'page': '1',
      'limit': '10',
      'query': 'search term'
    };
    
    return examples[paramName] || `example-${paramName}`;
  }

  generateBodyExample(bodySchema) {
    if (!bodySchema.properties) return '{}';
    
    const example = {};
    for (const [key, schema] of Object.entries(bodySchema.properties)) {
      if (schema.type === 'string') {
        example[key] = this.getExampleValue(key);
      } else if (schema.type === 'integer') {
        example[key] = key === 'page' ? 1 : key === 'limit' ? 10 : 1;
      } else if (schema.type === 'boolean') {
        example[key] = false;
      } else if (schema.type === 'array') {
        example[key] = [];
      } else {
        example[key] = this.getExampleValue(key);
      }
    }
    
    return JSON.stringify(example, null, 2);
  }

  async generateMarkdownDocs(modules) {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    
    const markdown = this.generateMainApiDoc(modules);
    
    // Write main API documentation
    fs.writeFileSync(path.join(this.outputDir, 'API.md'), markdown);
    
    // Generate individual module docs
    for (const module of modules) {
      const moduleDoc = this.generateModuleDoc(module);
      fs.writeFileSync(path.join(this.outputDir, `${module.name}.md`), moduleDoc);
    }
  }

  generateMainApiDoc(modules) {
    const totalEndpoints = modules.reduce((sum, m) => sum + m.endpoints.length, 0);
    
    let markdown = `# Index Network API Documentation

## Overview

The Index Network API provides a comprehensive REST interface for building applications on top of the Index Protocol. This documentation covers **${totalEndpoints} endpoints** across **${modules.length} modules**.

## Authentication

Most endpoints require authentication using a Bearer token obtained from the authentication endpoints:

\`\`\`http
Authorization: Bearer YOUR_API_TOKEN
\`\`\`

To get an API token, use the auth endpoints or integrate with Privy authentication.

## Base URL

All API requests should be made to:

**Production**: \`https://api.index.network/api\`  
**Development**: \`http://localhost:3001/api\`

## Quick Start

1. **Authenticate** and get your API token
2. **Create or join an index** to organize your intents
3. **Create intents** to express what you're looking for
4. **Discover matches** and connect with others

## API Modules

`;

    for (const module of modules) {
      markdown += `### 📁 ${module.name.charAt(0).toUpperCase() + module.name.slice(1)}\n\n`;
      markdown += `${module.description}\n\n`;
      markdown += `**Endpoints**: ${module.endpoints.length} | `;
      markdown += `**Auth Required**: ${module.endpoints.filter(e => e.authentication).length}/${module.endpoints.length} | `;
      markdown += `**Documentation**: [${module.name}.md](${module.name}.md)\n\n`;
      
      // Quick reference table - show most important endpoints
      const importantEndpoints = module.endpoints.slice(0, 5);
      if (importantEndpoints.length > 0) {
        markdown += `| Method | Endpoint | Description |\n`;
        markdown += `|--------|----------|-------------|\n`;
        
        for (const endpoint of importantEndpoints) {
          const path = endpoint.path.length > 40 ? endpoint.path.substring(0, 37) + '...' : endpoint.path;
          const desc = endpoint.description.length > 50 ? endpoint.description.substring(0, 47) + '...' : endpoint.description;
          markdown += `| ${endpoint.method} | \`${path}\` | ${desc} |\n`;
        }
        
        if (module.endpoints.length > 5) {
          markdown += `| ... | ... | [View all ${module.endpoints.length} endpoints](${module.name}.md) |\n`;
        }
      }
      
      markdown += '\n';
    }

    markdown += `## Error Handling

All endpoints return standard HTTP status codes with JSON error responses:

### Status Codes
- **200**: Success
- **201**: Created  
- **400**: Bad Request (validation errors)
- **401**: Unauthorized (invalid/missing token)
- **403**: Forbidden (insufficient permissions)
- **404**: Not Found
- **500**: Internal Server Error

### Error Response Format
\`\`\`json
{
  "error": "Error message",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
\`\`\`

## Pagination

List endpoints support pagination with query parameters:

- \`page\`: Page number (default: 1)
- \`limit\`: Items per page (1-100, default: 10)

**Response includes pagination info**:
\`\`\`json
{
  "data": [...],
  "pagination": {
    "current": 1,
    "total": 5,
    "count": 10,
    "totalCount": 45
  }
}
\`\`\`

## Rate Limiting

API requests are rate limited per API token:
- **Development**: 100 requests per minute
- **Production**: 1000 requests per minute

Check response headers:
- \`X-RateLimit-Limit\`: Request limit per window
- \`X-RateLimit-Remaining\`: Remaining requests  
- \`X-RateLimit-Reset\`: Reset time (Unix timestamp)

## Data Types

### Common Objects

**User Object**:
\`\`\`json
{
  "id": "uuid",
  "name": "string",
  "email": "string",
  "avatar": "string (URL)",
  "intro": "string",
  "createdAt": "ISO 8601 date",
  "updatedAt": "ISO 8601 date"
}
\`\`\`

**Index Object**:
\`\`\`json
{
  "id": "uuid", 
  "title": "string",
  "prompt": "string",
  "linkPermissions": {
    "code": "string",
    "permissions": ["array of strings"]
  },
  "user": "User object",
  "members": ["array of User objects"],
  "_count": {
    "members": "number",
    "intents": "number"
  }
}
\`\`\`

**Intent Object**:
\`\`\`json
{
  "id": "uuid",
  "payload": "string", 
  "summary": "string",
  "isIncognito": "boolean",
  "createdAt": "ISO 8601 date",
  "updatedAt": "ISO 8601 date",
  "userId": "uuid",
  "indexes": ["array of Index objects"]
}
\`\`\`

## SDK and Integration Examples

### JavaScript/TypeScript
\`\`\`javascript
// Using fetch
const response = await fetch('https://api.index.network/api/intents', {
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
  },
  method: 'POST',
  body: JSON.stringify({
    payload: 'Looking for ML researchers to collaborate on neural networks',
    isIncognito: false,
    indexIds: ['index-uuid']
  })
});

const result = await response.json();
\`\`\`

### cURL
\`\`\`bash
curl -X POST https://api.index.network/api/intents \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "payload": "Looking for ML researchers to collaborate on neural networks",
    "isIncognito": false,
    "indexIds": ["index-uuid"]
  }'
\`\`\`

## Support and Resources

- **Documentation**: [docs.index.network](https://docs.index.network)
- **GitHub**: [github.com/indexnetwork/index](https://github.com/indexnetwork/index)
- **Discord**: [discord.gg/wvdxP6XvYu](https://discord.gg/wvdxP6XvYu)
- **Twitter**: [@indexnetwork_](https://x.com/indexnetwork_)
- **Website**: [index.network](https://index.network)

## Changelog

- **v1.0.0** - Initial API release with full authentication, index, intent, and discovery functionality
- See [GitHub releases](https://github.com/indexnetwork/index/releases) for detailed version history

---

*Generated automatically from route definitions - Last updated: ${new Date().toISOString().split('T')[0]}*
`;

    return markdown;
  }

  generateModuleDoc(module) {
    let markdown = `# ${module.name.charAt(0).toUpperCase() + module.name.slice(1)} API

${module.description}

This module contains **${module.endpoints.length} endpoints** for ${module.description.toLowerCase()}.

## Authentication

`;
    const authRequired = module.endpoints.filter(e => e.authentication).length;
    const authOptional = module.endpoints.length - authRequired;
    
    if (authRequired > 0 && authOptional > 0) {
      markdown += `**Mixed**: ${authRequired} endpoints require authentication, ${authOptional} are public.\n\n`;
    } else if (authRequired === module.endpoints.length) {
      markdown += `**Required**: All endpoints in this module require authentication.\n\n`;
    } else {
      markdown += `**Not Required**: All endpoints in this module are public.\n\n`;
    }

    markdown += `## Endpoints

`;

    for (const endpoint of module.endpoints) {
      markdown += `### ${endpoint.method} ${endpoint.path}

${endpoint.description}

`;

      // Authentication badge
      const authBadge = endpoint.authentication ? '🔒 **Auth Required**' : '🔓 **Public**';
      markdown += `${authBadge}\n\n`;

      // Parameters
      if (endpoint.parameters.length > 0) {
        const pathParams = endpoint.parameters.filter(p => p.in === 'path');
        const queryParams = endpoint.parameters.filter(p => p.in === 'query');  
        const bodyParams = endpoint.parameters.filter(p => p.in === 'body');

        if (pathParams.length > 0) {
          markdown += `**Path Parameters**:\n\n`;
          markdown += `| Name | Type | Description |\n|------|------|-------------|\n`;
          for (const param of pathParams) {
            markdown += `| \`${param.name}\` | ${param.type} | ${param.description} |\n`;
          }
          markdown += '\n';
        }

        if (queryParams.length > 0) {
          markdown += `**Query Parameters**:\n\n`;
          markdown += `| Name | Type | Required | Description |\n|------|------|----------|-------------|\n`;
          for (const param of queryParams) {
            const required = param.required ? '✅ Yes' : '❌ No';
            markdown += `| \`${param.name}\` | ${param.type} | ${required} | ${param.description} |\n`;
          }
          markdown += '\n';
        }

        if (bodyParams.length > 0) {
          markdown += `**Request Body Parameters**:\n\n`;
          markdown += `| Name | Type | Required | Description |\n|------|------|----------|-------------|\n`;
          for (const param of bodyParams) {
            const required = param.required ? '✅ Yes' : '❌ No';
            markdown += `| \`${param.name}\` | ${param.type} | ${required} | ${param.description} |\n`;
          }
          markdown += '\n';
        }
      }

      // Request Body Schema
      if (endpoint.requestBody && endpoint.requestBody.properties) {
        markdown += `**Request Body Schema**:\n\`\`\`json\n${JSON.stringify(endpoint.requestBody, null, 2)}\n\`\`\`\n\n`;
      }

      // Responses
      markdown += `**Responses**:\n\n`;
      for (const response of endpoint.responses) {
        const statusEmoji = response.status >= 200 && response.status < 300 ? '✅' : 
                           response.status >= 400 && response.status < 500 ? '❌' : '💥';
        markdown += `${statusEmoji} **${response.status}**: ${response.description}\n`;
        if (response.schema) {
          markdown += `\`\`\`json\n${JSON.stringify(response.schema, null, 2)}\n\`\`\`\n`;
        }
      }

      // Example
      markdown += `\n**Example Request**:\n\`\`\`javascript\n${endpoint.example}\n\`\`\`\n\n`;
      
      markdown += '---\n\n';
    }

    markdown += `## Module Summary

- **Total Endpoints**: ${module.endpoints.length}
- **Authentication Required**: ${module.endpoints.filter(e => e.authentication).length}
- **Public Endpoints**: ${module.endpoints.filter(e => !e.authentication).length}
- **Methods**: ${[...new Set(module.endpoints.map(e => e.method))].join(', ')}

[← Back to API Documentation](API.md)

---

*Generated automatically from route definitions - Last updated: ${new Date().toISOString().split('T')[0]}*
`;

    return markdown;
  }

  async generateOpenAPISpec(modules) {
    const spec = {
      openapi: '3.0.3',
      info: {
        title: 'Index Network API',
        description: 'Comprehensive REST API for the Index Network Protocol - enabling private, intent-driven discovery through a network of autonomous agents.',
        version: '1.0.0',
        contact: {
          name: 'Index Network',
          url: 'https://index.network',
          email: 'support@index.network'
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT'
        }
      },
      servers: [
        {
          url: 'https://api.index.network/api',
          description: 'Production server'
        },
        {
          url: 'http://localhost:3001/api',
          description: 'Development server'
        }
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'Authentication token obtained from the auth endpoint'
          }
        },
        schemas: {
          Error: {
            type: 'object',
            properties: {
              error: { type: 'string', description: 'Error message' },
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string' },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          User: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
              avatar: { type: 'string', format: 'uri' },
              intro: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' }
            }
          }
        }
      },
      paths: {},
      tags: modules.map(module => ({
        name: module.name,
        description: module.description
      }))
    };

    for (const module of modules) {
      for (const endpoint of module.endpoints) {
        const path = endpoint.path.replace(/\/api/, '').replace(/:([^/]+)/g, '{$1}');
        if (!spec.paths[path]) {
          spec.paths[path] = {};
        }
        
        spec.paths[path][endpoint.method.toLowerCase()] = {
          tags: [module.name],
          summary: endpoint.description,
          operationId: `${module.name}_${endpoint.method.toLowerCase()}_${path.replace(/[{}\/]/g, '_')}`,
          security: endpoint.authentication ? [{ BearerAuth: [] }] : [],
          parameters: endpoint.parameters.filter(p => p.in !== 'body').map(param => ({
            name: param.name,
            in: param.in === 'path' ? 'path' : 'query',
            required: param.required,
            description: param.description,
            schema: { 
              type: this.convertToOpenAPIType(param.type),
              ...(param.type.includes('UUID') && { format: 'uuid' })
            }
          })),
          requestBody: endpoint.requestBody ? {
            required: true,
            content: {
              'application/json': {
                schema: endpoint.requestBody
              }
            }
          } : undefined,
          responses: endpoint.responses.reduce((acc, response) => {
            acc[response.status] = {
              description: response.description,
              content: response.schema ? {
                'application/json': {
                  schema: response.schema
                }
              } : undefined
            };
            return acc;
          }, {})
        };
      }
    }

    fs.writeFileSync(
      path.join(this.outputDir, 'openapi.json'), 
      JSON.stringify(spec, null, 2)
    );

    // Also create a YAML version for better readability
    const yamlContent = this.convertJsonToYaml(spec);
    fs.writeFileSync(
      path.join(this.outputDir, 'openapi.yaml'),
      yamlContent
    );
  }

  convertToOpenAPIType(type) {
    if (type.includes('integer')) return 'integer';
    if (type.includes('boolean')) return 'boolean';
    if (type.includes('array')) return 'array';
    return 'string';
  }

  convertJsonToYaml(obj, indent = 0) {
    const spaces = '  '.repeat(indent);
    let yaml = '';

    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === 'object') {
          yaml += `${spaces}- ${this.convertJsonToYaml(item, indent + 1).trim()}\n`;
        } else {
          yaml += `${spaces}- ${item}\n`;
        }
      }
    } else if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'object' && value !== null) {
          yaml += `${spaces}${key}:\n${this.convertJsonToYaml(value, indent + 1)}`;
        } else {
          yaml += `${spaces}${key}: ${JSON.stringify(value)}\n`;
        }
      }
    }

    return yaml;
  }
}

// Main execution
const routesDir = path.join(__dirname, '..', 'protocol', 'src', 'routes');
const outputDir = path.join(__dirname, '..', 'docs', 'api');

console.log('🚀 Starting API documentation generation...');
console.log(`📂 Routes directory: ${routesDir}`);
console.log(`📁 Output directory: ${outputDir}`);

new APIDocGenerator(routesDir, outputDir).generateDocs()
  .then(() => {
    console.log('🎉 Documentation generation completed successfully!');
  })
  .catch((error) => {
    console.error('❌ Error generating documentation:', error);
    process.exit(1);
  });