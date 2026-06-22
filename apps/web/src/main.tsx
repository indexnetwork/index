import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { TooltipProvider } from "@/components/ui/Tooltip";
import { router } from "@/routes";

import "./app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <RouterProvider router={router} />
    </TooltipProvider>
  </StrictMode>,
);
