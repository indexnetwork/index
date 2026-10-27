-- Give every network without a key one made from its title, so each has an
-- index.network/<key> link. Keys share that root with usernames (users.key),
-- so a candidate is free only if neither table holds it. Mirrors
-- toKebabKey/generateUniqueKey in src/lib/keys.ts; the reserved words are
-- that file's list at the time of this migration.
DO $$
DECLARE
  n record;
  base text;
  candidate text;
  i int;
  reserved text[] := ARRAY['me', 'new', 'edit', 'delete', 'settings', 'admin', 'api', 'auth', 'login', 'logout', 'signup', 'register', 'profile', 'index', 'about', 'agents', 'blog', 'chat', 'cli-auth', 'download', 'found-in-translation', 'hermes', 'mcp', 'negotiations', 'networks', 'onboarding', 'opportunities', 'pages', 'protocol', 'setup', 'waitlist', 'site', 'landing', 'logos', 'media', 'fonts', 'dataroom', 'dataroom-demo', 'dataroom-overview', 'overview', 'roadmap', 'edge-city-metrics', '9db20a5fbe', 'help', 'support', 'docs', 'status', 'home', 'explore', 'search', 'invite', 'join', 'privacy', 'terms', 'legal', 'security', 'pricing', 'contact', 'assets', 'static', 'www', 'mail', 'app', 'apps', 'network', 'user', 'users', 'notifications', 'discover'];
BEGIN
  FOR n IN SELECT id, title FROM networks WHERE key IS NULL ORDER BY created_at, id LOOP
    base := left(trim(both '-' from regexp_replace(regexp_replace(lower(n.title), '[^a-z0-9\s-]', '', 'g'), '[\s-]+', '-', 'g')), 60);
    base := trim(both '-' from base);
    IF length(base) < 3 OR base = ANY(reserved) THEN
      base := trim(both '-' from concat_ws('-', nullif(base, ''), 'network'));
    END IF;
    candidate := base;
    i := 2;
    WHILE EXISTS (SELECT 1 FROM networks WHERE key = candidate)
       OR EXISTS (SELECT 1 FROM users WHERE key = candidate)
       OR candidate = ANY(reserved) LOOP
      candidate := base || '-' || i;
      i := i + 1;
    END LOOP;
    UPDATE networks SET key = candidate WHERE id = n.id;
  END LOOP;
END $$;
