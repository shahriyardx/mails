import { useRegisterSW } from "virtual:pwa-register/react";
import { onlineManager, useMutationState } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { Icon, toast } from "@/components/kit";

const subscribe = (listener: () => void) => onlineManager.subscribe(listener);
const isOnline = () => onlineManager.isOnline();

/** True while the browser has a network connection. */
export function useOnline() {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}

/**
 * A small note at the bottom while offline ("showing saved mail"), and while
 * mail actions made offline still wait to be sent.
 */
export function OfflineNote() {
  const online = useOnline();
  const waiting = useMutationState({ filters: { predicate: (m) => m.state.isPaused } }).length;
  if (online && waiting === 0) return null;
  const changes = waiting === 1 ? "1 change waits" : `${waiting} changes wait`;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      <p className="flex items-center gap-2 rounded-full bg-inverse px-3.5 py-1.5 text-[13px] text-inverse-foreground shadow-lg">
        <Icon name={online ? "sync" : "cloud_off"} size={16} />
        {online ? `Back online · ${changes}` : "Offline · showing saved mail"}
        {!online && waiting > 0 && <span className="opacity-70">· {changes}</span>}
      </p>
    </div>
  );
}

/**
 * Registers the service worker (src/sw.ts) and offers "Reload" when a new
 * version is ready. Nothing reloads by itself in the middle of work.
 */
export function AppUpdate() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    if (!needRefresh) return;
    toast("A new version of Mails is ready", {
      id: "app-update",
      duration: Number.POSITIVE_INFINITY,
      action: { label: "Reload", onClick: () => void updateServiceWorker(true) },
    });
  }, [needRefresh, updateServiceWorker]);
  return null;
}
