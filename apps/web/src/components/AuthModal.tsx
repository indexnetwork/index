import AuthForm from '@/components/AuthForm';
import './AuthModal.css';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Override the post-login redirect URL. Defaults to window.location.origin. */
  callbackURL?: string;
}

/** Dark overlay dialog wrapping the shared AuthForm. */
export default function AuthModal({ isOpen, onClose, callbackURL }: AuthModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="auth auth-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={onClose}
    >
      <div className="av-backdrop" aria-hidden="true" />
      <div className="av-card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="av-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <AuthForm callbackURL={callbackURL} onAuthenticated={onClose} />
      </div>
    </div>
  );
}
