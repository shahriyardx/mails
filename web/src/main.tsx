import "./styles/app.css";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { AppUpdate, OfflineNote } from "@/components/app/offline";
import { Toaster, TooltipProvider } from "@/components/kit";
import { installSpringVars } from "@/components/kit/motion";
import { keys, queryClient } from "@/lib/api";
import { persistOptions } from "@/lib/offline";
import { installScrollbars } from "@/lib/scrollbars";
import { watchSystemTheme } from "@/lib/theme";
import { router } from "./router";

installSpringVars();
installScrollbars();
watchSystemTheme();

// Saved mail is back: run actions that waited offline, then check the
// session (the saved sign-in state is never trusted for long).
function restored() {
  void queryClient
    .resumePausedMutations()
    .then(() => queryClient.invalidateQueries({ queryKey: keys.auth }));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} {...persistOptions(restored)}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
          <OfflineNote />
          <AppUpdate />
        </TooltipProvider>
      </MotionConfig>
    </PersistQueryClientProvider>
  </StrictMode>,
);
