import { Link, Outlet } from 'react-router';

const LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/', label: 'overview' },
  { to: '/launch', label: 'launch' },
  { to: '/compare', label: 'compare' },
  { to: '/profiles', label: 'profiles' },
  { to: '/fixture', label: 'fixture' },
];

/**
 * The application shell. Every route an operator needs is reachable from here by
 * mouse: these are real links with real hrefs, not keyboard shortcuts.
 */
export function Shell() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--color-term-rule)] px-4 py-2 flex items-baseline gap-4">
        <h1 className="text-sm">index eval ops</h1>
        <nav className="flex gap-4 text-sm">
          {LINKS.map((link) => (
            <Link key={link.to} to={link.to} className="text-term-blue hover:underline">
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
