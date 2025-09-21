#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

interface EndpointInfo {
  method: string;
  path: string;
  description: string;
  authentication: boolean;
  parameters: Parameter[];
  requestBody?: any;
  responses: Response[];
  example?: string;
}

interface Parameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  in: 'path' | 'query' | 'body';
}

interface Response {
  status: number;
  description: string;
  schema?: any;
}

interface RouteModule {
  name: string;
  description: string;
  endpoints: EndpointInfo[];
}

class APIDocGenerator {
  private routesDir: string;
  private outputDir: string;
  
  constructor(routesDir: string, outputDir: string) {
    this.routesDir = routesDir;
    this.outputDir = outputDir;
  }

  async generateDocs() {
    console.log('🔍 Scanning route files...');
    
    const routeFiles = fs.readdirSync(this.routesDir)
      .filter(file => file.endsWith('.ts'))
      .sort();

    const modules: RouteModule[] = [];
    
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
  }

  private async parseRouteFile(filePath: string): Promise<RouteModule> {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath, '.ts');
    
    const module: RouteModule = {
      name: fileName,
      description: this.extractModuleDescription(content),
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

  private extractModuleDescription(content: string): string {
    const descriptions: { [key: string]: string } = {
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

    const fileName = content.match(/\/\/ (.+)\.ts/)?.[1] || 
                    Object.keys(descriptions).find(key => content.includes(key)) || 
                    'API operations';
    
    return descriptions[fileName] || `${fileName.charAt(0).toUpperCase() + fileName.slice(1)} operations`;
  }

  private extractEndpointInfo(content: string, method: string, routePath: string, matchStr: string): EndpointInfo {
    const startIndex = content.indexOf(matchStr);
    const endIndex = this.findEndOfRoute(content, startIndex);
    const routeContent = content.substring(startIndex, endIndex);
    
    const endpoint: EndpointInfo = {
      method,
      path: this.normalizePath(routePath),
      description: this.extractDescription(routeContent),
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

  private findEndOfRoute(content: string, startIndex: number): number {
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
    
    return startIndex + 500; // fallback
  }

  private normalizePath(path: string): string {
    return path.startsWith('/') ? `/api${path}` : `/api/${path}`;
  }

  private extractDescription(content: string): string {
    // Look for comments above the route
    const commentMatch = content.match(/\/\/ (.+)/);
    if (commentMatch) return commentMatch[1];
    
    // Extract from validation messages or obvious patterns
    if (content.includes('Get all')) return 'Get all items with pagination';
    if (content.includes('Get single') || content.includes('Get ')) return 'Get single item by ID';
    if (content.includes('Create')) return 'Create a new item';
    if (content.includes('Update')) return 'Update an existing item';
    if (content.includes('Delete')) return 'Delete an item';
    
    return 'Endpoint operation';
  }

  private hasAuthentication(content: string): boolean {
    return content.includes('authenticatePrivy') || 
           content.includes('AuthRequest') ||
           content.includes('req.user');
  }

  private extractParameters(content: string): Parameter[] {
    const parameters: Parameter[] = [];
    
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
          description: `${name} query parameter`,
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
          description: `${name} in request body`,
          in: 'body'
        });
      }
    }
    
    return parameters;
  }

  private guessParameterType(content: string, paramName: string): string {
    if (content.includes(`${paramName}').isUUID`)) return 'string (UUID)';
    if (content.includes(`${paramName}').isInt`)) return 'integer';
    if (content.includes(`${paramName}').isBoolean`)) return 'boolean';
    if (content.includes(`${paramName}').isArray`)) return 'array';
    if (content.includes(`${paramName}').isEmail`)) return 'string (email)';
    if (paramName.includes('Id')) return 'string (UUID)';
    if (paramName === 'page' || paramName === 'limit') return 'integer';
    
    return 'string';
  }

  private extractResponses(content: string): Response[] {
    const responses: Response[] = [];
    
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
        schema: status === 200 ? this.extractSuccessSchema(content) : undefined
      });
    }
    
    return responses;
  }

  private getStatusDescription(status: number): string {
    const descriptions: { [key: number]: string } = {
      200: 'Success',
      201: 'Created',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      500: 'Internal Server Error'
    };
    
    return descriptions[status] || `HTTP ${status}`;
  }

  private extractSuccessSchema(content: string): any {
    // Try to infer response structure from res.json calls
    if (content.includes('res.json({ user:')) return { user: 'User object' };
    if (content.includes('res.json({ users:')) return { users: 'Array of user objects' };
    if (content.includes('res.json({ index:')) return { index: 'Index object' };
    if (content.includes('res.json({ indexes:')) return { indexes: 'Array of index objects' };
    if (content.includes('res.json({ intent:')) return { intent: 'Intent object' };
    if (content.includes('res.json({ intents:')) return { intents: 'Array of intent objects' };
    if (content.includes('res.json({ message:')) return { message: 'Success message' };
    
    return { success: true };
  }

  private extractRequestBody(content: string): any {
    const bodyParams = this.extractParameters(content).filter(p => p.in === 'body');
    if (bodyParams.length === 0) return undefined;
    
    const body: any = {};
    for (const param of bodyParams) {
      body[param.name] = {
        type: param.type,
        required: param.required,
        description: param.description
      };
    }
    
    return { type: 'object', properties: body };
  }

  private generateExample(endpoint: EndpointInfo): string {
    const hasAuth = endpoint.authentication;
    const authHeader = hasAuth ? "\n  headers: {\n    'Authorization': 'Bearer YOUR_API_TOKEN'\n  }," : '';
    
    let pathExample = endpoint.path;
    const pathParams = endpoint.parameters.filter(p => p.in === 'path');
    for (const param of pathParams) {
      pathExample = pathExample.replace(`{${param.name}}`, `example-${param.name}`);
    }
    
    const queryParams = endpoint.parameters.filter(p => p.in === 'query');
    if (queryParams.length > 0) {
      const queryString = queryParams.map(p => `${p.name}=example-value`).join('&');
      pathExample += `?${queryString}`;
    }
    
    if (['POST', 'PUT', 'PATCH'].includes(endpoint.method) && endpoint.requestBody) {
      const bodyExample = this.generateBodyExample(endpoint.requestBody);
      return `fetch('${pathExample}', {
  method: '${endpoint.method}',${authHeader}${hasAuth ? '\n  headers: {\n    \'Content-Type\': \'application/json\',\n    \'Authorization\': \'Bearer YOUR_API_TOKEN\'\n  },' : '\n  headers: {\n    \'Content-Type\': \'application/json\'\n  },'}
  body: JSON.stringify(${bodyExample})
})`;
    }
    
    return `fetch('${pathExample}', {
  method: '${endpoint.method}',${authHeader}
})`;
  }

  private generateBodyExample(bodySchema: any): string {
    if (!bodySchema.properties) return '{}';
    
    const example: any = {};
    for (const [key, schema] of Object.entries(bodySchema.properties as any)) {
      const schemaObj = schema as any;
      if (schemaObj.type?.includes('string')) {
        example[key] = `example-${key}`;
      } else if (schemaObj.type?.includes('integer')) {
        example[key] = 1;
      } else if (schemaObj.type?.includes('boolean')) {
        example[key] = true;
      } else {
        example[key] = `example-${key}`;
      }
    }
    
    return JSON.stringify(example, null, 2);
  }

  private async generateMarkdownDocs(modules: RouteModule[]) {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    
    let markdown = this.generateMainApiDoc(modules);
    
    // Write main API documentation
    fs.writeFileSync(path.join(this.outputDir, 'API.md'), markdown);
    
    // Generate individual module docs
    for (const module of modules) {
      const moduleDoc = this.generateModuleDoc(module);
      fs.writeFileSync(path.join(this.outputDir, `${module.name}.md`), moduleDoc);
    }
  }

  private generateMainApiDoc(modules: RouteModule[]): string {
    const totalEndpoints = modules.reduce((sum, m) => sum + m.endpoints.length, 0);
    
    let markdown = `# Index Network API Documentation

## Overview

The Index Network API provides a comprehensive REST interface for building applications on top of the Index Protocol. This documentation covers all ${totalEndpoints} endpoints across ${modules.length} modules.

## Authentication

Most endpoints require authentication using a Bearer token:

\`\`\`http
Authorization: Bearer YOUR_API_TOKEN
\`\`\`

## Base URL

All API requests should be made to:
\`\`\`
https://api.index.network/api
\`\`\`

## API Modules

`;

    for (const module of modules) {
      markdown += `### ${module.name.charAt(0).toUpperCase() + module.name.slice(1)}\n\n`;
      markdown += `${module.description}\n\n`;
      markdown += `- **Endpoints**: ${module.endpoints.length}\n`;
      markdown += `- **Documentation**: [${module.name}.md](${module.name}.md)\n\n`;
      
      // Quick reference table
      markdown += `| Method | Endpoint | Description |\n`;
      markdown += `|--------|----------|-------------|\n`;
      
      for (const endpoint of module.endpoints.slice(0, 5)) { // Show first 5
        markdown += `| ${endpoint.method} | \`${endpoint.path}\` | ${endpoint.description} |\n`;
      }
      
      if (module.endpoints.length > 5) {
        markdown += `| ... | ... | [View all ${module.endpoints.length} endpoints](${module.name}.md) |\n`;
      }
      
      markdown += '\n';
    }

    markdown += `
## Error Handling

All endpoints return standard HTTP status codes:

- **200**: Success
- **201**: Created  
- **400**: Bad Request (validation errors)
- **401**: Unauthorized (invalid/missing token)
- **403**: Forbidden (insufficient permissions)
- **404**: Not Found
- **500**: Internal Server Error

Error responses include details:
\`\`\`json
{
  "error": "Error message",
  "details": "Additional error information"
}
\`\`\`

## Rate Limiting

API requests are rate limited. Check response headers:
- \`X-RateLimit-Limit\`: Request limit per window
- \`X-RateLimit-Remaining\`: Remaining requests
- \`X-RateLimit-Reset\`: Reset time

## Support

- **Documentation**: [docs.index.network](https://docs.index.network)
- **GitHub**: [github.com/indexnetwork/index](https://github.com/indexnetwork/index)
- **Discord**: [discord.gg/wvdxP6XvYu](https://discord.gg/wvdxP6XvYu)
`;

    return markdown;
  }

  private generateModuleDoc(module: RouteModule): string {
    let markdown = `# ${module.name.charAt(0).toUpperCase() + module.name.slice(1)} API

${module.description}

## Endpoints

`;

    for (const endpoint of module.endpoints) {
      markdown += `### ${endpoint.method} ${endpoint.path}

${endpoint.description}

**Authentication**: ${endpoint.authentication ? 'Required' : 'Not required'}

`;

      // Parameters
      if (endpoint.parameters.length > 0) {
        markdown += `**Parameters**:

| Name | Type | Required | Location | Description |
|------|------|----------|----------|-------------|
`;
        for (const param of endpoint.parameters) {
          markdown += `| ${param.name} | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${param.in} | ${param.description} |\n`;
        }
        markdown += '\n';
      }

      // Request Body
      if (endpoint.requestBody) {
        markdown += `**Request Body**:
\`\`\`json
${JSON.stringify(endpoint.requestBody, null, 2)}
\`\`\`

`;
      }

      // Responses
      markdown += `**Responses**:

`;
      for (const response of endpoint.responses) {
        markdown += `- **${response.status}**: ${response.description}\n`;
        if (response.schema) {
          markdown += `  \`\`\`json\n  ${JSON.stringify(response.schema, null, 2)}\n  \`\`\`\n`;
        }
      }

      // Example
      markdown += `
**Example**:
\`\`\`javascript
${endpoint.example}
\`\`\`

---

`;
    }

    return markdown;
  }

  private async generateOpenAPISpec(modules: RouteModule[]) {
    const spec = {
      openapi: '3.0.3',
      info: {
        title: 'Index Network API',
        description: 'Comprehensive API documentation for the Index Network Protocol',
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
        }
      },
      paths: {} as any,
      tags: modules.map(module => ({
        name: module.name,
        description: module.description
      }))
    };

    for (const module of modules) {
      for (const endpoint of module.endpoints) {
        const path = endpoint.path.replace(/\/api/, ''); // Remove /api prefix for OpenAPI
        if (!spec.paths[path]) {
          spec.paths[path] = {};
        }
        
        spec.paths[path][endpoint.method.toLowerCase()] = {
          tags: [module.name],
          summary: endpoint.description,
          security: endpoint.authentication ? [{ BearerAuth: [] }] : [],
          parameters: endpoint.parameters.filter(p => p.in !== 'body').map(param => ({
            name: param.name,
            in: param.in === 'path' ? 'path' : 'query',
            required: param.required,
            description: param.description,
            schema: { type: this.convertToOpenAPIType(param.type) }
          })),
          requestBody: endpoint.requestBody ? {
            required: true,
            content: {
              'application/json': {
                schema: this.convertToOpenAPISchema(endpoint.requestBody)
              }
            }
          } : undefined,
          responses: endpoint.responses.reduce((acc, response) => {
            acc[response.status] = {
              description: response.description,
              content: response.schema ? {
                'application/json': {
                  schema: this.convertToOpenAPISchema(response.schema)
                }
              } : undefined
            };
            return acc;
          }, {} as any)
        };
      }
    }

    fs.writeFileSync(
      path.join(this.outputDir, 'openapi.json'), 
      JSON.stringify(spec, null, 2)
    );
  }

  private convertToOpenAPIType(type: string): string {
    if (type.includes('integer')) return 'integer';
    if (type.includes('boolean')) return 'boolean';
    if (type.includes('array')) return 'array';
    return 'string';
  }

  private convertToOpenAPISchema(schema: any): any {
    if (typeof schema === 'object' && schema.type) {
      return schema;
    }
    
    // Simple conversion for basic schemas
    return {
      type: 'object',
      additionalProperties: true
    };
  }
}

// Main execution
const routesDir = path.join(__dirname, '..', 'protocol', 'src', 'routes');
const outputDir = path.join(__dirname, '..', 'docs', 'api');

new APIDocGenerator(routesDir, outputDir).generateDocs();