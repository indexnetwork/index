import { useEffect } from "react";
import InviteForm from "./InviteForm";

/**
 * "Request your invite" dialog opened from the navbar. Same form as the hero,
 * plus a note that signing up also subscribes you to the newsletter.
 */
export default function InviteModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="site-modal" role="dialog" aria-modal="true" aria-labelledby="site-modal-title" onClick={onClose}>
      <div className="site-modal-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="site-modal-close" aria-label="Close" onClick={onClose}>
          &times;
        </button>
        <h2 id="site-modal-title" className="site-col-title">Request your invite</h2>
        <p className="site-p">Index is opening in cycles. Leave your email and we&rsquo;ll reach out when there&rsquo;s a spot for you.</p>
        <InviteForm autoFocus />
        <p className="site-modal-note">You&rsquo;re also subscribing to our newsletter. Unsubscribe anytime.</p>
      </div>
    </div>
  );
}
