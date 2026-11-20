import "./styles/app.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { Toaster, TooltipProvider } from "@/components/kit";
import { installSpringVars } from "@/components/kit/motion";
import { queryClient } from "@/lib/api";
import { watchSystemTheme } from "@/lib/theme";
import { router } from "./router";

installSpringVars();
watchSystemTheme();

// Web push needs a service worker; the Notifications settings page subscribes.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
