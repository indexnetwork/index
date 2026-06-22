import { useLocation, useSearchParams, useNavigate } from "react-router";
import { Link } from "react-router";
import { useAuthContext } from '@/contexts/AuthContext';
import { useEffect, useState, useRef } from 'react';

interface HeaderProps {
  showHeaderButtons?: boolean;
  forcePublicView?: boolean;
}

export default function Header({ showHeaderButtons = true, forcePublicView = false }: HeaderProps) {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, isReady, openLoginModal } = useAuthContext();
  const [isAlpha, setIsAlpha] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const alphaParam = searchParams.get('alpha');

  useEffect(() => {
    if (alphaParam !== null) {
      localStorage.setItem('alpha', alphaParam);
      setIsAlpha(alphaParam === 'true');
    } else {
      const storedAlpha = localStorage.getItem('alpha');
      setIsAlpha(storedAlpha === 'true');
    }
  }, [alphaParam, pathname]);

  const loginInitiatedRef = useRef(false);

  const handleLogin = () => {
    loginInitiatedRef.current = true;
    openLoginModal();
  };

  useEffect(() => {
    if (isAuthenticated && loginInitiatedRef.current) {
      loginInitiatedRef.current = false;
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  if (!isReady) {
    return (
      <header className="w-full py-4 px-4 flex justify-between items-center">
        <Link to="/">
          <img
            src="/logos/logo-black-full.svg"
            alt="Index Network"
            width={200}
            height={36}
            className="object-contain"
          />
        </Link>
        <div className="animate-pulse bg-gray-200 h-10 w-20 rounded"></div>
      </header>
    );
  }

  const ctaButton = isAuthenticated ? (
    <button
      onClick={() => navigate('/')}
      className="bg-[#041729] text-white rounded-[2px] px-3 sm:px-5 py-2 sm:py-3 font-semibold text-sm inline-flex items-center gap-2 transition-all hover:bg-[#0a2d4a] hover:-translate-y-[1px] uppercase tracking-wider cursor-pointer"
    >
      Go to App
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
    </button>
  ) : isAlpha ? (
    <button
      onClick={handleLogin}
      className="bg-[#041729] text-white rounded-[2px] px-3 sm:px-5 py-2 sm:py-3 font-semibold text-sm inline-flex items-center gap-2 transition-all hover:bg-[#0a2d4a] hover:-translate-y-[1px] uppercase tracking-wider cursor-pointer"
    >
      Login
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
    </button>
  ) : (
    <button
      onClick={() => {
        if ((pathname === '/' && !isAuthenticated) || pathname?.startsWith('/blog') || pathname === '/found-in-translation') {
          window.dispatchEvent(new CustomEvent('openWaitlistModal'));
        } else {
          window.open("https://forms.gle/nTNBKYC2gZZMnujh9", "_blank");
        }
      }}
      className="bg-[#041729] text-white rounded-[2px] px-3 sm:px-5 py-2 sm:py-3 font-semibold text-sm inline-flex items-center gap-2 transition-all hover:bg-[#0a2d4a] hover:-translate-y-[1px] uppercase tracking-wider cursor-pointer"
    >
      <span className="sm:hidden">Join</span>
      <span className="hidden sm:inline">Join the waitlist</span>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
    </button>
  );

  return (
    <div className="relative">
      <header className="w-full pt-4 pb-4 flex justify-between items-center">
        <Link to="/">
          <img
            src="/logos/logo-black-full.svg"
            alt="Index Network"
            width={200}
            height={36}
            className="object-contain w-[140px] sm:w-[180px] md:w-[200px]"
          />
        </Link>

        {showHeaderButtons && (
          <div className="flex items-center gap-3 sm:gap-8 md:gap-12">
            {/* Desktop nav links */}
            <Link to="/blog" className="hidden sm:block font-sans text-sm text-black hover:text-gray-600 transition-colors font-medium uppercase">
              Blog
            </Link>
            <Link to="/about" className="hidden sm:block font-sans text-sm text-black hover:text-gray-600 transition-colors font-medium uppercase">
              About
            </Link>

            {ctaButton}

            {/* Mobile hamburger */}
            <button
              className="sm:hidden p-1 text-[#041729]"
              aria-label="Open menu"
              onClick={() => setMobileMenuOpen(o => !o)}
            >
              {mobileMenuOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        )}
      </header>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && showHeaderButtons && (
        <nav className="sm:hidden absolute top-full left-0 right-0 bg-white border-t border-gray-200 shadow-md z-50 flex flex-col py-2">
          <Link
            href="/blog"
            className="px-4 py-3 font-sans text-sm text-black hover:bg-gray-50 transition-colors font-medium uppercase"
            onClick={() => setMobileMenuOpen(false)}
          >
            Blog
          </Link>
          <Link
            href="/about"
            className="px-4 py-3 font-sans text-sm text-black hover:bg-gray-50 transition-colors font-medium uppercase"
            onClick={() => setMobileMenuOpen(false)}
          >
            About
          </Link>
        </nav>
      )}
    </div>
  );
}
