"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MVPPage() {
  const router = useRouter();

  useEffect(() => {
    router.push("/indexes");
  }, [router]);

  return null;
}
