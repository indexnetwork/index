import { Link, useLocation, useSearchParams } from 'react-router';

const TABS = [
  { key: 'profile', label: 'Profile Settings', to: '/settings' },
  { key: 'notifications', label: 'Notification Settings', to: '/settings?tab=notifications' },
  { key: 'access', label: 'Access', to: '/settings?tab=access' },
  { key: 'agents', label: 'Agents', to: '/agents' },
] as const;

/**
 * Tab row for the account screens. Shared by the settings panes and the agents
 * list, which lives on its own route but reads as the tab next to Access.
 */
export default function SettingsTabs() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  const active = pathname.startsWith('/agents')
    ? 'agents'
    : tab === 'notifications' || tab === 'access'
      ? tab
      : 'profile';

  return (
    <div className="flex flex-wrap gap-x-1 border-b border-gray-200 mb-8">
      {TABS.map(({ key, label, to }) => (
        <Link
          key={key}
          to={to}
          className={`px-4 py-2 text-sm border-b-2 outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 ${
            key === active
              ? 'border-black text-black font-bold'
              : 'border-transparent text-gray-600'
          }`}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
