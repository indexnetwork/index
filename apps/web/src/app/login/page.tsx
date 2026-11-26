import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { protocolOrigin } from "@/lib/protocol-origin";
import { SiteSignInCard, SiteSignInPage } from "@/components/SiteSignIn";
import { useSignInReason } from "@/lib/sign-in-reason";

/** A same-origin path to resume after login. Anything else returns home. */
function resumePath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

/** Browser login, returning the owner to the app. */
function LoginPage() {
  const [sessionChecked, setSessionChecked] = useState(false);
  // The mailed link finishes sign-in in its own tab; this one stays on "check your email".
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  // The MCP plugin passes the original authorize query to /login. The API
  // validates it again; no client-provided redirect URL is navigated to here.
  const isMcpLogin = new URLSearchParams(window.location.search).has('client_id');
  const authorizeURL = `${protocolOrigin() || window.location.origin}/api/auth/mcp/authorize${window.location.search}`;
  const destination = isMcpLogin ? authorizeURL : resumePath();
  const finishLogin = () => window.location.replace(destination);
  // Whatever link sent them here, the page says so: the network, the person, the chat.
  const reason = useSignInReason(isMcpLogin ? "/" : destination);

  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      if (!data?.session) setSessionChecked(true);
      else window.location.replace(destination);
    }).catch(() => {
      // Network error — show login form rather than blank screen.
      setSessionChecked(true);
    });
  }, [destination]);

  if (!sessionChecked) return null;

  return (
    <SiteSignInPage
      title={reason.title}
      meta={<p className="site-p">{reason.meta}</p>}
    >
      {['INVALID_TOKEN', 'EXPIRED_TOKEN'].includes(new URLSearchParams(window.location.search).get('error') || '') && (
        <p className="site-p" role="alert">this sign-in link has expired or was already used. send yourself a new one below.</p>
      )}
      {new URLSearchParams(window.location.search).get('error') === 'OTHER_BROWSER' && (
        <p className="site-p" role="alert">this sign-in link was asked for in another browser. open it there, or send a new one below to sign in here.</p>
      )}
      <SiteSignInCard
        bar="sign in"
        sentTo={linkSentTo}
        sentNote="open the link in the email and you're in. it expires in 10 minutes."
        callbackURL={isMcpLogin ? window.location.href : window.location.origin + destination}
        onAuthenticated={() => {
          authClient.getSession().then(({ data }) => {
            if (data?.session) finishLogin();
          });
        }}
        onMagicLinkSent={setLinkSentTo}
        onBack={() => setLinkSentTo(null)}
      />
    </SiteSignInPage>
  );
}

export const Component = LoginPage;
