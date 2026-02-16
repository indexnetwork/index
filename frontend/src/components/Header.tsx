'use client';

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState, useRef } from 'react';

interface HeaderProps {
  showHeaderButtons?: boolean;
  forcePublicView?: boolean;
}

export default function Header({ showHeaderButtons = true, forcePublicView = false }: HeaderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { login, authenticated, ready } = usePrivy();
  const [isAlpha, setIsAlpha] = useState(false);

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
    login();
  };

  useEffect(() => {
    if (authenticated && loginInitiatedRef.current) {
      loginInitiatedRef.current = false;
      router.push('/');
    }
  }, [authenticated, router]);

  if (!ready) {
    return (
      <header className="w-full py-4 px-4 flex justify-between items-center">
        <Link href="/">
          <Image
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

  return (
    <header className="w-full pt-4 pb-4 flex justify-between items-center">
      <Link href="/">
        <Image
          src="/logos/logo-black-full.svg"
          alt="Index Network"
          width={200}
          height={36}
          className="object-contain"
        />
      </Link>

      {showHeaderButtons && (
        authenticated ? (
          <div className="flex items-center gap-12">
            <Link
              href="/blog"
              className="font-sans text-sm text-black hover:text-gray-600 transition-colors font-medium uppercase"
            >
              Blog
            </Link>
            <Link
              href="/pages/about"
              className="font-sans text-sm text-black hover:text-gray-600 transition-colors font-medium uppercase"
            >
              About
            </Link>
            <button
              onClick={() => router.push('/')}
              className="bg-[#041729] text-white rounded-[2px] px-5 py-3 font-semibold text-sm inline-flex items-center gap-2 transition-all hover:bg-[#0a2d4a] hover:-translate-y-[1px] uppercase tracking-wider cursor-pointer"
            >
              Go to App
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </div>
        ) : isAlpha ? (
          <div className="flex items-center gap-12">
            <Link
              href="/blog"
              className="font-sans text-sm text-black hover:text-gray-600 transition-colors font-medium uppercase"
            >
              Blog
            </Link>
            <Link
              href="/pages/about"
              className="font-sans text-sm text-black hover:text-gray-600 transition-colors font-medium uppercase"
            >
              About
            </Link>
            <button
              onClick={handleLogin}
              className="bg-[#041729] text-white rounded-[2px] px-5 py-3 font-semibold text-sm inline-flex items-center gap-2 transition-all hover:bg-[#0a2d4a] hover:-translate-y-[1px] uppercase tracking-wider cursor-pointer"
            >
              Login
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-12">
            <Link
              href="/blog"
              className="font-sans text-sm text-black hover:text-gray-600 transition-colors font-medium uppercase"
            >
              Blog
            </Link>
            <Link
              href="/pages/about"
              className="font-sans text-sm text-black hover:text-gray-600 transition-colors font-medium uppercase"
            >
              About
            </Link>
            <button
              onClick={() => {
                if ((pathname === '/' && !authenticated) || pathname?.startsWith('/blog')) {
                  window.dispatchEvent(new CustomEvent('openWaitlistModal'));
                } else {
                  window.open("https://forms.gle/nTNBKYC2gZZMnujh9", "_blank");
                }
              }}
              className="bg-[#041729] text-white rounded-[2px] px-5 py-3 font-semibold text-sm inline-flex items-center gap-2 transition-all hover:bg-[#0a2d4a] hover:-translate-y-[1px] uppercase tracking-wider cursor-pointer"
            >
              <span className="lg:hidden">Join</span>
              <span className="hidden lg:inline">Join the waitlist</span>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </div>
        )
      )}
    </header>
  );
}
