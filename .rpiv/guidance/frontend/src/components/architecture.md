# Frontend Components

## Responsibility
React UI layer for app shell, chat rendering, settings panels, modals, domain widgets, and low-level primitives. Feature containers may use contexts/services; reusable leaf components should stay prop-driven.

## Dependencies
- **React hooks/components**: component state and rendering.
- **React Router**: navigation in shell/route-aware components.
- **Radix UI/Tailwind**: modals, tabs, tooltips, and styling primitives.
- **Context hooks/services**: allowed in containers, not low-level primitives.

## Consumers
- **Route pages**: compose feature components.
- **Contexts**: may render global modals/questions.
- **Components**: compose primitives and feature widgets.

## Module Structure
```
components/
├── *.tsx                         # shell/domain widgets and containers
├── chat/                         # streamed chat cards/timeline/trace renderers
├── settings/, modals/            # workflow UI grouped by feature
├── PendingQuestions/, InjectedQuestions/, DecisionQuestions/
└── ui/, layout/                  # prop-driven primitives and layout helpers
```

## Container vs Leaf Component Pattern
```tsx
export function NetworkSettingsContainer({ networkId }: { networkId: string }) {
  const { networks } = useAPI();
  const [network, setNetwork] = useState<Network | null>(null);
  useEffect(() => { void networks.get(networkId).then(setNetwork); }, [networks, networkId]);
  return network ? <NetworkSettingsPanel network={network} onSave={networks.update} /> : null;
}

export function NetworkSettingsPanel(props: {
  network: Network;
  onSave(id: string, input: UpdateNetworkInput): Promise<void>;
}) {
  return <SettingsTab network={props.network} onSave={props.onSave} />;
}
```

## UI Primitive Pattern
```tsx
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant }), className)} {...props} />
  ),
);
```

## Boundary Rules
- `components/ui` and reusable leaf widgets should not fetch data or import services.
- Chat renderers must preserve backend/protocol streamed fenced block contracts.
- Controlled modals receive open/submission state from parents unless they are global context modals.

<important if="you are adding a component">
1. Decide whether it is a container or reusable leaf.
2. Containers may use context/service hooks; leaves take typed props/callbacks.
3. Use existing `ui/` primitives and `cn` for styling composition.
4. Add tests for non-trivial behavior, parsing, or state transitions.
</important>
