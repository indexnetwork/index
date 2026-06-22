# Web App

## Responsibility
Vite + React Router SPA for chat, discovery, settings, profiles, networks, and public/shared flows. It consumes the API service's `/api` endpoints through typed services and app-wide contexts.

## Dependencies
- **React 19**: functional components and hooks.
- **React Router v7**: lazy route modules and navigation.
- **Tailwind CSS/Radix UI**: styling and accessible primitives.
- **Vite**: dev server/build and API proxy.

## Consumers
- **Users/browser**: primary UI.
- **API service**: served/API-proxied against `services/api` in development.

## Module Structure
```
apps/web/
├── src/routes.tsx, main.tsx      # router/provider bootstrap
├── src/app/                      # lazy route page modules
├── src/components/               # app shell, feature UI, primitives
├── src/contexts/                 # global state/service providers
├── src/services/                 # typed API-service wrappers
└── src/lib/                      # API client and UI utilities
```

## Provider + Router Bootstrap
```tsx
const router = createBrowserRouter([
  {
    element: <ClientWrapper />,
    children: [{ path: '/', lazy: () => import('@/app/page') }],
  },
]);

createRoot(root).render(
  <TooltipProvider>
    <RouterProvider router={router} />
  </TooltipProvider>,
);
```

## API Consumption Boundary
```tsx
function FeatureContainer() {
  const { networks } = useAPI();
  const [items, setItems] = useState<Network[]>([]);

  useEffect(() => {
    void networks.list().then(setItems);
  }, [networks]);

  return <NetworkList items={items} />; // leaf receives props
}
```

## Boundary Rules
- Containers/pages/contexts may call services; reusable leaf components and `components/ui` should be prop-driven.
- Keep route registration in `routes.tsx`; folder names may be Next-style but paths are React Router paths.
- Service functions should own URL/query construction, not components.

<important if="you are adding web app capability">
1. Add/extend service methods in `src/services/`.
2. Add context state only if multiple routes/components share it.
3. Add page under `src/app/**/page.tsx` and lazy route in `routes.tsx`.
4. Build UI from container components plus prop-driven leaf/UI components.
</important>
