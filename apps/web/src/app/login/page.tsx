import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import AuthModal from "@/components/AuthModal";

/** Browser login, returning the owner to the app. */
function LoginPage() {
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      if (!data?.session) {
        setSessionChecked(true);
      } else {
        // Already signed in with nothing to authorize — replace so Back does not return here.
        window.location.replace("/");
      }
    }).catch(() => {
      // Network error — show login form rather than blank screen
      setSessionChecked(true);
    });
  }, []);

  if (!sessionChecked) return null;


  return (
    <AuthModal
      isOpen={true}
      onClose={() => {}}
      callbackURL={window.location.origin}
    />
  );
}

export const Component = LoginPage;
