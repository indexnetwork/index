import { DiscoveryType } from "@/types";
import { usePathname } from "next/navigation";
import { useState, useEffect, useMemo } from "react";

export const useRouteParams = () => {
  const [id, setId] = useState("");
  const [path, setPath] = useState("");
  const nextPathname = usePathname();

  // Function to update the current ID and path
  const updateRouteParams = () => {
    // Get the pathname directly from the browser
    const currentPath = window.location.pathname;
    const currentId = decodeURIComponent(currentPath.split("/")[1]);

    setId(currentId);
    setPath(currentPath);

    // Log for debugging purposes
    console.log("Current pathname:", currentPath);
  };

  useEffect(() => {
    // Initialize the parameters when the component mounts
    updateRouteParams();

    // Handle `popstate` events (browser navigation)
    const handlePopState = () => {
      updateRouteParams();
    };

    window.addEventListener("popstate", handlePopState);

    // Cleanup event listener
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  // Update parameters when Next.js pathname changes
  useEffect(() => {
    updateRouteParams();
  }, [nextPathname]);

  // Determine whether it's a landing page
  const isLanding = useMemo(() => path === "/", [path]);

  // Determine the discovery type based on the current ID
  const discoveryType = useMemo(
    () => (id.includes("did:") ? DiscoveryType.DID : DiscoveryType.INDEX),
    [id],
  );

  // Flags based on the discovery type
  const isDID = useMemo(
    () => discoveryType === DiscoveryType.DID,
    [discoveryType],
  );
  const isIndex = useMemo(
    () => discoveryType === DiscoveryType.INDEX,
    [discoveryType],
  );

  return {
    id,
    isLanding,
    discoveryType,
    isDID,
    isIndex,
  };
};
