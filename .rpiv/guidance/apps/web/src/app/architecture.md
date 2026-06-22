# Frontend App Routes

## Responsibility
Lazy route modules for the React Router SPA. Route folders describe URL shape, while `routes.tsx` maps those modules into actual paths.

## Dependencies
- **React Router lazy routes**: page modules loaded through `lazy: () => import(...)`.
- **React components/contexts/services**: route modules compose application UI.

## Consumers
- **`src/routes.tsx`**: imports page modules lazily.
- **`ClientWrapper`**: determines app/public/bare shell behavior by pathname.

## Module Structure
```
app/
├── page.tsx                       # root chat/home route
├── d/[id]/, u/[id]/, s/[token]/   # dynamic route folders; Router uses :id/:token
├── settings/, networks/, agents/  # authenticated feature pages
├── landing/, login/, l/[code]/    # public/bare flows
└── */page.tsx                     # route module convention
```

## Lazy Route Module Pattern
```tsx
// src/app/features/[id]/page.tsx
export function Component() {
  const { id } = useParams();
  return <FeaturePage id={id!} />;
}

export default Component;

// src/routes.tsx
{
  path: '/features/:id',
  lazy: () => import('@/app/features/[id]/page'),
}
```

## Shell Classification Pattern
```tsx
// ClientWrapper owns layout selection, not each page.
const bareRoutes = ['/login', '/cli-auth'];
const publicPrefixes = ['/s/', '/l/'];

return isBare ? <Outlet /> : isPublic ? <PublicLayout /> : <ClientLayout />;
```

## Boundary Rules
- Folder `[id]` is a naming convention only; React Router path uses `:id`.
- Update `ClientWrapper` when a new route needs bare/public/authenticated shell behavior.
- Keep heavy shared state in contexts, not duplicated across pages.

<important if="you are adding a route">
1. Create `src/app/<route>/page.tsx` with `Component` and default export.
2. Register the path in `src/routes.tsx` with `lazy` import.
3. If shell behavior differs, update `ClientWrapper` route lists.
4. Add route tests for auth/public/bare behavior if classification changes.
</important>
