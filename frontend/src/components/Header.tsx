'use client';

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { ThemeToggle } from './ThemeToggle';

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
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

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

  // Redirect to app from blog pages after login
  useEffect(() => {
    if (authenticated && (pathname === '/blog' || pathname?.startsWith('/blog/'))) {
      router.push('/');
    }
  }, [authenticated, pathname, router]);

  const logoSrc = mounted && resolvedTheme === 'dark' 
    ? "/logos/logo-white-full.svg" 
    : "/logos/logo-black-full.svg";

  if (!ready) {
    return (
      <header className="w-full py-4 px-4 flex justify-between items-center">
        <Link href="/">
          <Image
            src={logoSrc}
            alt="Index Network"
            width={200}
            height={36}
            className="object-contain"
          />
        </Link>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <div className="animate-pulse bg-muted h-10 w-20 rounded"></div>
        </div>
      </header>
    );
  }

  return (
    <header className="w-full pt-4 pb-4 flex justify-between items-center">
      <Link href="/">
        <Image
          src={logoSrc}
          alt="Index Network"
          width={200}
          height={36}
          className="object-contain"
        />
      </Link>

      <div className="flex items-center gap-4">
        <ThemeToggle />
        {showHeaderButtons && (
          isAlpha ? (
            <div className="flex items-center gap-12">
              <Link 
                href="/blog" 
                className="font-hanken text-sm text-foreground hover:text-muted-foreground transition-colors font-medium uppercase"
              >
                Blog
              </Link>
              <button
                onClick={login}
                className="bg-primary text-primary-foreground rounded-[2px] px-5 py-3 font-semibold text-sm inline-flex items-center gap-2 transition-all hover:opacity-90 hover:-translate-y-[1px] uppercase tracking-wider cursor-pointer"
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
                className="font-hanken text-sm text-foreground hover:text-muted-foreground transition-colors font-medium uppercase"
              >
                Blog
              </Link>
              <button
                onClick={() => {
                  if ((pathname === '/' && !authenticated) || pathname?.startsWith('/blog')) {
                    window.dispatchEvent(new CustomEvent('openWaitlistModal'));
                  } else {
                    window.open("https://forms.gle/nTNBKYC2gZZMnujh9", "_blank");
                  }
                }}
                className="bg-primary text-primary-foreground rounded-[2px] px-5 py-3 font-semibold text-sm inline-flex items-center gap-2 transition-all hover:opacity-90 hover:-translate-y-[1px] uppercase tracking-wider cursor-pointer"
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
      </div>
    </header>
  );
}
