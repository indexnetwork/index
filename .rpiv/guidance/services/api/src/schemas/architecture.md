# Backend Schemas

## Responsibility
Canonical database contract layer for Drizzle tables, enums, relations, and inferred row/insert types. All backend persistence should import schema from here.

## Dependencies
- **Drizzle pg-core/relations**: table, enum, index, relation definitions.
- **Zod where needed**: runtime validation for selected schema-adjacent contracts.

## Consumers
- **Adapters/services/queues/tests**: import tables, enums, relations, and inferred types.
- **Drizzle Kit**: generates SQL migrations from this file.

## Module Structure
```
schemas/
├── database.schema.ts       # canonical table/enums/relations/types
├── conversation.schema.ts   # conversation/task schema split where present
└── migrations via drizzle/  # generated SQL lives outside this folder
```

## Drizzle Table Contract
```ts
export const widgetStatus = pgEnum('widget_status', ['active', 'archived']);

export const widgets = pgTable('widgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  status: widgetStatus('status').notNull().default('active'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Widget = typeof widgets.$inferSelect;
export type NewWidget = typeof widgets.$inferInsert;
```

## Relation Definition Pattern
```ts
export const widgetsRelations = relations(widgets, ({ one }) => ({
  owner: one(users, { fields: [widgets.ownerId], references: [users.id] }),
}));
```

## Boundary Rules
- Do not create alternate schema modules in `lib/schema` or feature folders.
- Prefer soft-delete columns (`deletedAt`) over hard deletion where domain data may be referenced.
- Keep schema changes paired with generated migrations and journal updates.

<important if="you are changing schema">
1. Edit `services/api/src/schemas/database.schema.ts` or the owning canonical schema file.
2. Run `cd services/api && bun run db:generate`.
3. Rename generated SQL to `{NNNN}_{action}_{target}.sql` and update `_journal.json` tag.
4. Run `bun run db:migrate` and verify a second generate has no diff.
</important>
