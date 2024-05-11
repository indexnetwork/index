"use client";

import { useAuth } from "@/context/AuthContext";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import Button from "./Button";

const AppHeader = () => {
  const router = useRouter();
  const query = useSearchParams();
  const { connect } = useAuth();

  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const allowedQueryParam = query.get("EnterTheVoid");

    if (allowedQueryParam === "yes") {
      localStorage.setItem("allowed", "true");
      setAllowed(true);
    } else {
      // Fallback to local storage
      const storedAllowed = localStorage.getItem("allowed") === "true";
      setAllowed(storedAllowed);
    }
  }, [query]);

  return (
    <header className="app-header">
      <div className="m-auto flex max-w-screen-lg flex-row justify-between p-4">
        <Image
          width={192}
          height={32}
          src="/images/logo-full-white.svg"
          alt="index network"
        />
        {allowed ? (
          <Button onClick={connect}>Connect</Button>
        ) : (
          <Button
            onClick={() => {
              router.push("https://sjxy3b643r8.typeform.com/to/phuRF52O");
            }}
          >
            Apply for Beta
          </Button>
        )}
      </div>
    </header>
  );
};

export default AppHeader;
