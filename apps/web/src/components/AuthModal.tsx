import AuthForm from '@/components/AuthForm';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  callbackURL?: string;
}

/** Workbench sign-in window. Inline auth on public pages uses AuthForm directly. */
export default function AuthModal({ isOpen, onClose, callbackURL }: AuthModalProps) {
  if (!isOpen) return null;

  return (
    <div className="workbench mac-desktop wb-auth" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <div style={{ width: 420, maxWidth: "100%" }}>
        <div className="amiga-window">
          <div className="mac-titlebar">
            <span className="mac-close" role="button" tabIndex={0} aria-label="close" onClick={onClose} />
            <span className="mac-title"><span className="t">index</span></span>
          </div>
          <div className="wb-body" style={{ padding: "30px 30px 26px" }}>
            <AuthForm variant="product" callbackURL={callbackURL} onAuthenticated={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}
