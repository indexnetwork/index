# Frontend Services

## Responsibility
Typed HTTP wrappers around the frontend API client. Services construct URLs/query strings, normalize response envelopes, and provide stable methods to contexts/pages/components.

## Dependencies
- **Authenticated API client**: central `get/post/patch/delete` boundary.
- **TypeScript DTOs**: request/response shapes shared with UI code.
- **URLSearchParams**: optional query construction.

## Consumers
- **APIContext**: instantiates service factories.
- **Contexts/components/pages**: call services through context hooks.

## Module Structure
```
services/
├── *.ts                # one service factory per backend resource/capability
├── shared DTO types    # colocated interfaces per service
└── small caches/maps   # only for dedupe or in-flight request sharing
```

## Service Factory Pattern
```ts
export interface FeatureItem { id: string; title: string }
export interface ListOptions { networkId?: string; limit?: number }

export const createFeatureService = (api: APIClient) => ({
  async list(options: ListOptions = {}): Promise<FeatureItem[]> {
    const params = new URLSearchParams();
    if (options.networkId) params.set('networkId', options.networkId);
    if (options.limit) params.set('limit', String(options.limit));

    const qs = params.toString();
    const res = await api.get<{ items: FeatureItem[] }>(qs ? `/features?${qs}` : '/features');
    return res.items ?? [];
  },

  async update(id: string, input: Partial<FeatureItem>): Promise<FeatureItem> {
    const res = await api.patch<{ item: FeatureItem }>(`/features/${id}`, input);
    return res.item;
  },
});
```

## APIContext Registration Pattern
```tsx
const services = useMemo(() => ({
  features: createFeatureService(api),
  networks: createNetworkService(api),
}), [api]);
```

## Boundary Rules
- Components should not hand-build API URLs when a service method exists.
- Throw `APIError`/propagate API client errors; UI layers decide presentation.
- Keep services mostly stateless; only cache/dedupe when there is a clear UX need.

<important if="you are adding a service method">
1. Add typed request/response interfaces.
2. Build optional query params with `URLSearchParams`.
3. Normalize backend envelopes before returning.
4. Register new service factories in `APIContext` if consumers need hook access.
5. Add tests/mocks for error and success paths when behavior is non-trivial.
</important>
