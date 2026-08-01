import { Frame } from '../components/Frame';

/**
 * Shown when a user is authenticated but their account is not @index.network.
 *
 * This is distinct from the sign-in screen (401) and must not suggest signing in
 * again — that would be a loop. The domain check runs server-side and is
 * fail-closed, so the browser never learns why it was refused beyond the
 * requirement named here.
 */
export function NotPermitted() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md p-4">
        <Frame label="not permitted">
          <div className="flex flex-col gap-4 py-4">
            <p className="text-term-red font-bold">
              Access Denied
            </p>
            <p className="text-term-fg">
              The eval ops site is restricted to <span className="text-term-cyan">@index.network</span> accounts.
            </p>
            <p className="text-term-dim text-sm">
              Your account does not have permission to access this tool.
            </p>
          </div>
        </Frame>
      </div>
    </div>
  );
}
