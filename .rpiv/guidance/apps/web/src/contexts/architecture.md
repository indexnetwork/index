# Frontend Contexts

## Responsibility
Typed React providers for cross-route state: auth, API service injection, chat/session state, networks, filters, conversations, notifications, questions, and save-bar behavior.

## Dependencies
- **React Context/hooks**: provider + guarded hook pattern.
- **Services/API client**: contexts orchestrate data loading and mutations.
- **React Router/browser APIs**: navigation, redirects, storage, polling/SSE where needed.

## Consumers
- **Components/pages**: use exported `use*` hooks.
- **Provider tree**: registers contexts around app routes.

## Module Structure
```
contexts/
├── *Context.tsx          # provider + use hook + state orchestration
├── APIContext.tsx        # service factory injection
├── AuthContext.tsx       # auth/session and global auth modal
└── tests/                # provider/hook behavior tests where present
```

## Guarded Context Pattern
```tsx
interface FeatureContextValue {
  items: Item[];
  refresh(): Promise<void>;
}

const FeatureContext = createContext<FeatureContextValue | null>(null);

export function FeatureProvider({ children }: { children: ReactNode }) {
  const { featureService } = useAPI();
  const [items, setItems] = useState<Item[]>([]);

  const refresh = useCallback(async () => {
    setItems(await featureService.list());
  }, [featureService]);

  return <FeatureContext.Provider value={{ items, refresh }}>{children}</FeatureContext.Provider>;
}

export function useFeature() {
  const value = useContext(FeatureContext);
  if (!value) throw new Error('useFeature must be used within FeatureProvider');
  return value;
}
```

## Provider Composition Pattern
```tsx
<APIProvider>
  <AuthProvider>
    <NetworksProvider>
      <ConversationProvider>{children}</ConversationProvider>
    </NetworksProvider>
  </AuthProvider>
</APIProvider>
```

## Boundary Rules
- Contexts own shared state and side effects; leaf components should not duplicate global fetching.
- Keep service construction in `APIContext`; feature contexts consume those services.
- Clean up polling/SSE subscriptions in effects.

<important if="you are adding a context">
1. Define a narrow value interface.
2. Export provider and guarded `useX` hook from the same file.
3. Load/mutate through services from `APIContext`.
4. Register provider only as high as necessary in the tree.
5. Add tests or mocks for provider behavior if it owns async state.
</important>
