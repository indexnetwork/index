import { RouterProvider } from 'react-router';
import { router } from './routes';

export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--color-term-rule)] px-4 py-2">
        <h1 className="text-sm">index eval ops</h1>
      </header>
      <main className="flex-1">
        <RouterProvider router={router} />
      </main>
    </div>
  );
}
