# Service Implementation Guide

Services are the core business logic layer of the application. They handle data access, complex business rules, and orchestration between different parts of the system (DB, Agents, Queues).

## Location & Naming
- **File**: `src/services/<domain>.service.ts` (e.g., `user.service.ts`, `stake.service.ts`)
- **Class**: PascalCase, ending in `Service` (e.g., `UserService`)
- **Instance**: camelCase, same name as file (e.g., `userService`)

## Architectural Role

Services sit between controllers and infrastructure, with adapters providing protocol interface implementations:

```
┌─────────────────────────────────────┐
│     Controller Layer (HTTP)         │
│  - Request/response handling        │
│  - Calls services & graph factories │
└──────────┬──────────────────┬───────┘
           │                  │
           ↓                  ↓
┌──────────────────┐  ┌─────────────────────┐
│  Service Layer   │  │   Adapter Layer     │
│  - Business      │  │   (src/adapters/)   │
│    logic         │  │  - Protocol         │
│  - CRUD ops      │  │    interfaces       │
│  - Direct DB     │  │  - Graph deps       │
└────────┬─────────┘  └────────┬────────────┘
         │                     │
         ↓                     ↓
┌─────────────────────────────────────┐
│         Infrastructure              │
│  - Database (Drizzle ORM)           │
│  - Queue (BullMQ)                   │
│  - Embedder (OpenAI)                │
│  - Scraper (Parallels)              │
│  - Cache (Redis)                    │
└─────────────────────────────────────┘
```

### Layer Responsibilities

**Services are responsible for:**
- CRUD operations on database entities
- Business logic and data validation
- Complex queries and data aggregation
- Coordinating multiple database operations
- Queue job creation for async operations
- **Direct access to database via Drizzle**
- Called by controllers for data needs

**Controllers are responsible for:**
- HTTP request/response handling
- Input validation and parsing
- Calling services for data operations
- Calling graphs/factories for protocol operations
- Passing adapters to graph factories
- **Never importing `db` directly**

**Adapters are responsible for:**
- Implementing protocol interfaces from `src/lib/protocol/interfaces/`
- Being passed to graph factories by controllers
- Wrapping infrastructure (database, embedder, scraper, cache, queue)
- Providing testable interfaces for protocol layer
- Defined in `src/adapters/` directory

### Services MUST Use Database Adapters

**ALL services must use database adapters** from `src/adapters/` for data access. Services should NEVER import `db` directly.

**Two Types of Adapters:**

1. **Database Adapters** (for data access) - **REQUIRED for all services**
   - `FileDatabaseAdapter` - File operations
   - `UserDatabaseAdapter` - User operations  
   - `ChatDatabaseAdapter` - Chat session operations
   - Located in `src/adapters/{domain}.adapter.ts`

2. **Protocol Adapters** (for graphs/agents) - **Used when service creates graphs**
   - `ChatDatabaseAdapter` (from `database.adapter.ts`) - Protocol interface for graphs
   - `EmbedderAdapter` - Vector embeddings
   - `ScraperAdapter` - Web scraping
   - `RedisCacheAdapter` - Caching

**Example: Service with Database Adapter (Standard Pattern)**
```typescript
import { userDatabaseAdapter } from '../adapters/user.adapter';
import { log } from '../lib/log';

export class UserService {
  constructor(private db = userDatabaseAdapter) {}

  async findById(userId: string) {
    // Use database adapter - NO direct Drizzle access in services
    return this.db.findById(userId);
  }

  async update(userId: string, data: Partial<User>) {
    return this.db.update(userId, data);
  }
}

export const userService = new UserService();
```

**Example: Service with Protocol Adapters (When Creating Graphs)**
```typescript
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ProfileGraphFactory } from '../lib/protocol/graphs/profile/profile.graph';

export class ProfileGenerationService {
  private db: Database;
  private embedder: Embedder;
  private factory: ProfileGraphFactory;

  constructor() {
    // Use protocol adapters to create graph factory
    this.db = new ChatDatabaseAdapter();
    this.embedder = new EmbedderAdapter();
    this.factory = new ProfileGraphFactory(this.db, this.embedder);
  }

  async generateProfile(userId: string) {
    const graph = this.factory.createGraph();
    return await graph.invoke({ userId });
  }
}
```

## Standard Template

All services should follow this structure using database adapters:

\`\`\`typescript
import { log } from '../lib/log';
import { myDatabaseAdapter } from '../adapters/my.adapter';

const logger = log.service.from("MyService");

/**
 * [ServiceName]
 * 
 * [Brief description of what this service does]
 * Uses MyDatabaseAdapter for all database operations.
 * 
 * RESPONSIBILITIES:
 * - [Responsibility 1]
 * - [Responsibility 2]
 */
export class MyService {
  constructor(private db = myDatabaseAdapter) {}

  /**
   * [Method Description]
   * 
   * @param id - [Param description]
   * @returns [Return description]
   */
  async getById(id: string) {
    logger.info('[MyService] Getting item', { id });
    
    // Use adapter method - NO direct database access
    return this.db.getById(id);
  }

  /**
   * Standard Create/Update operation
   */
  async createItem(data: { name: string; userId: string }) {
    try {
      logger.info('[MyService] Creating item', { userId: data.userId });

      // Use adapter method
      return this.db.createItem(data);
    } catch (error) {
      logger.error('[MyService] Failed to create item', { error, data });
      throw error; // Or handle gracefully depending on requirement
    }
  }
}

// Export a singleton instance
export const myService = new MyService();
\`\`\`

## Best Practices

### 1. Database Access

**CRITICAL: Services MUST use database adapters. Never import `db` directly.**

Services access the database through adapters in `src/adapters/`. Each domain has its own database adapter:

**Database Adapters (Required for ALL Services):**
```typescript
import { userDatabaseAdapter } from '../adapters/user.adapter';
import { fileDatabaseAdapter } from '../adapters/file.adapter';

export class UserService {
  constructor(private db = userDatabaseAdapter) {}

  async findById(userId: string) {
    // Use adapter method - NO direct db.select()
    return this.db.findById(userId);
  }

  async update(userId: string, data: Partial<User>) {
    // Use adapter method
    return this.db.update(userId, data);
  }
}
```

**Why Use Adapters:**
- ✅ **Testability**: Easy to mock adapters in tests
- ✅ **Separation of Concerns**: Database logic in adapters, business logic in services
- ✅ **Consistency**: All data access follows the same pattern
- ✅ **Type Safety**: Adapters provide typed interfaces

**Available Database Adapters:**
- `fileDatabaseAdapter` (`src/adapters/file.adapter.ts`) - File operations
- `userDatabaseAdapter` (`src/adapters/user.adapter.ts`) - User operations

**Available Protocol Adapters (for graphs):**
- `ChatDatabaseAdapter` (`src/adapters/database.adapter.ts`) - Protocol interface implementation
- `EmbedderAdapter` - Vector embeddings (wraps OpenAI)
- `ScraperAdapter` - Web scraping (wraps Parallels)
- `RedisCacheAdapter` - Caching (wraps Redis)
- `QueueAdapter` - Job queues (wraps BullMQ)

**Using Protocol Adapters (When Creating Graphs):**
```typescript
import type { Database } from '../lib/protocol/interfaces/database.interface';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ProfileGraphFactory } from '../lib/protocol/graphs/profile/profile.graph';

export class ProfileService {
  private db: Database;
  private embedder: Embedder;
  private factory: ProfileGraphFactory;

  constructor() {
    // Use protocol adapters to create graph factory
    this.db = new ChatDatabaseAdapter();
    this.embedder = new EmbedderAdapter();
    this.factory = new ProfileGraphFactory(this.db, this.embedder);
  }

  async generateProfile(userId: string) {
    const graph = this.factory.createGraph();
    return await graph.invoke({ userId });
  }
}
```

**General Rules:**
- ✅ Services → Use database adapters from `src/adapters/`
- ✅ Adapters → Use Drizzle directly (`db.select()`, `db.insert()`, etc.)
- ❌ Services → Never import `db` from `../lib/drizzle/drizzle`
- ❌ Services → Never import Drizzle operators directly
- ✅ Constructor injection: `constructor(private db = adapter)` for testability

### 2. Logging
- Use standard logger: \`import { log } from '../lib/log';\`.
- Structure logs with the service name prefix: \`[MyService] ...\`.
- Log important state changes and errors.
- Pass metadata objects as the second argument to \`log.info/error\`.

### 3. Dependencies
- Services should be standalone where possible.
- If a service needs another service, import the **class** and instantiate it or use the exported singleton, but be wary of circular dependencies.
- **Circular Dependency Rule**: If Service A needs Service B, and Service B needs Service A, consider refactoring shared logic into a \`lib/\` utility or a third service.
- **Agents**: Import agents directly from \`../agents/...\`.

### 4. Code Style
- **JSDoc**: Every public method must have a JSDoc comment explaining "Why" and "What".
- **Types**: Use inferred types from Drizzle where possible (\`typeof myTable.$inferSelect\`), or explicit interfaces if passing complex DTOs.
- **Return Values**: 
  - For "Get" methods: return \`null\` if not found (don't throw).
  - For "Action" methods: throw detailed errors if the action fails (to catch in the controller/worker).

### 5. Singleton Pattern
- Always export a \`const\` instance at the bottom of the file.
- This ensures a single connection/state across the application.
- Exception: If the service holds user-specific state (rare), export the class only.

## Anti-Patterns (Don't do this)
- ❌ **Direct SQL**: Avoid \`db.execute(sql\`...\`)\` unless absolutely necessary for performance. Use Drizzle's query builder.
- ❌ **Console Logs**: Use \`log.info/error\`, do not use \`console.log\`.
- ❌ **Global State**: Do not store request-specific state in the service class properties (since it's a singleton).
- ❌ **Controller Logic**: Services should not know about \`req\` and \`res\` objects. They should take pure data arguments.
- ❌ **Creating Adapters in Services**: Do not define adapter classes in service files. Import existing adapters from \`src/adapters/\`. If you need a new adapter, create it in \`src/adapters/\` directory.
- ❌ **Overusing Adapters**: Most services should use direct Drizzle access. Only use adapters when passing dependencies to protocol graphs/agents.

### 6. Queue Usage
- **Pattern**: Offload heavy/async work to queues (e.g., AI generation, notifications).
- **Import**: Import the queue instance from \`../queues/<domain>.queue.ts\`.
- **Usage**:
  \`\`\`typescript
  import { myQueue } from '../queues/my.queue';
  
  // Inside service method
  await myQueue.add('job_name', { userId: '123' }, { priority: 1 });
  \`\`\`
- **Definition**: Queues are defined in \`src/queues/\` using \`QueueFactory.createQueue\`.

### 7. Postgres Searcher Injection
- **Context**: If your service needs to perform vector search on its own entities using `pgvector`.
- **Pattern**: Implement a `searcher` method and inject it into the `IndexEmbedder`.
- **Example**:
  \`\`\`typescript
  import { IndexEmbedder } from '../lib/embedder';
  import { VectorStoreOption, VectorSearchResult } from '../agents/common/types';
  import { sql, isNotNull, desc } from 'drizzle-orm';
  
  export class MyService {
    private embedder: IndexEmbedder;
  
    constructor() {
      // Inject the local search method
      this.embedder = new IndexEmbedder({
        searcher: this.searchMyEntities.bind(this)
      });
    }
  
    /**
     * Implementation of the Searcher interface for 'my_table'
     */
    private async searchMyEntities<T>(vector: number[], collection: string, options?: VectorStoreOption<T>): Promise<VectorSearchResult<T>[]> {
      const limit = options?.limit || 10;
      const vectorString = JSON.stringify(vector);
  
      // Use pgvector operator <=> for cosine distance
      const results = await db.select({
        item: myTable,
        distance: sql<number>\`\${myTable.embedding} <=> \${vectorString}\`
      })
        .from(myTable)
        .where(isNotNull(myTable.embedding))
        .orderBy(sql\`\${myTable.embedding} <=> \${vectorString}\`)
        .limit(limit);
  
      return results.map(r => ({
        item: r.item as unknown as T,
        score: 1 - r.distance // Convert distance to similarity score
      }));
    }
  }
  \`\`\`


