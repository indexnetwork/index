"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import Button from "./Button";

const AppHeader = () => {
  const router = useRouter();
  const query = useSearchParams();
  const [allowed, setAllowed] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const scrollIntoSection = (id: string) => {
    const elem = document.getElementById(id);
    console.log(elem);
    elem?.scrollIntoView({ behavior: "smooth" });
    setIsMenuOpen(false);
  };

  useEffect(() => {
    const allowedQueryParam = query.get("surf");

    if (allowedQueryParam === "yesplease") {
      localStorage.setItem("allowed", "true");
      setAllowed(true);
    } else {
      // Fallback to local storage
      const storedAllowed = localStorage.getItem("allowed") === "true";
      setAllowed(storedAllowed);
    }
  }, [query]);

  return (
    <header
      className={`absolute  top-0 right-0 left-0 z-20 px-4 py-4 md:py-8 ${isMenuOpen ? "bg-mainDark" : ""}`}
    >
      <div className="container mx-auto flex justify-between items-center">
        <Image
          width={192}
          height={32}
          src="/images/logo-full-white.svg"
          alt="index network"
        />
        <div className="hidden md:flex gap-24 items-center">
          <ul className="flex md:gap-4 lg:gap-12 text-white text-sm">
            <li>
              <a href="https://index.network" className="hover:underline">
                HOME
              </a>
            </li>

            <li>
              <a
                target="_blank"
                href="https://blog.index.network"
                className="hover:underline"
              >
                BLOG
              </a>
            </li>
            <li>
              <a
                target="_blank"
                href="https://docs.index.network"
                className="hover:underline"
              >
                DOCUMENTATION
              </a>
            </li>
          </ul>
          <Button onClick={() => {
              router.push("https://testflight.apple.com/join/e6sekS5x");
            }}>Download Beta App</Button>
        </div>

        <div className="md:hidden flex flex-row gap-4 items-center">
          <Button onClick={() => {
              router.push("https://testflight.apple.com/join/e6sekS5x");
            }}>Download Beta App</Button>
          <button
            className="text-white"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 6h16M4 12h16m-7 6h7"
              ></path>
            </svg>
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <div className="md:hidden ">
          <ul className="flex flex-col gap-4 text-white text-sm px-4 py-8">
            <li>
              <a href="https://index.network" className="hover:underline">
                HOME
              </a>
            </li>

            <li>
              <a href="https://blog.index.network" className="hover:underline">
                BLOG
              </a>
            </li>
            <li>
              <a href="https://index.network" className="hover:underline">
                DOCUMENTATION
              </a>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
};

export default AppHeader;
