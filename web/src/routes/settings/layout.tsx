import { LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { AccountMenu } from "@/components/app/account-menu";
import { Icon, IconButton, Sheet, SheetContent, SheetTitle, Wordmark } from "@/components/kit";
import { spatial } from "@/components/kit/motion";
import { cn } from "@/lib/cn";
import { SETTINGS_PAGES, type SettingsPage } from "./pages";

const GROUPS = [...new Set(SETTINGS_PAGES.map((p) => p.group))];

/** The settings shell: page list on the left, the page in a card. */
export function Component() {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  const current = SETTINGS_PAGES.find((p) => pathname.startsWith(`/settings/${p.path}`));

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-64 shrink-0 md:block">
        <LayoutGroup id="settings-fixed">
          <Nav instance="fixed" />
        </LayoutGroup>
      </aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">Settings</SheetTitle>
          <LayoutGroup id="settings-sheet">
            <Nav instance="sheet" onNavigate={() => setNavOpen(false)} />
          </LayoutGroup>
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 px-3 md:pl-1">
          <IconButton
            icon="menu"
            label="Open settings menu"
            className="md:hidden"
            onClick={() => setNavOpen(true)}
          />
          <h1 className="flex-1 truncate text-lg font-medium">{current?.title ?? "Settings"}</h1>
          <AccountMenu />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 md:pr-2 md:pl-0">
          <div className="mx-auto max-w-3xl px-2 py-4 md:px-6">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

function Nav({ instance, onNavigate }: { instance: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Wordmark />
      </div>
      <div className="px-3 pb-2">
        <Link
          to="/mail/all/inbox"
          onClick={onNavigate}
          className="flex h-10 items-center gap-3 rounded-full px-4 text-sm hover:bg-tonal"
        >
          <Icon name="arrow_back" /> Back to mail
        </Link>
      </div>
      <nav aria-label="Settings" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {GROUPS.map((group) => (
          <div key={group}>
            <h2 className="px-4 pt-5 pb-1.5 text-xs font-medium text-muted-foreground">{group}</h2>
            <ul className="space-y-0.5">
              {SETTINGS_PAGES.filter((p) => p.group === group).map((page) => (
                <li key={page.path}>
                  <Item page={page} pill={`${instance}-settings`} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

function Item({
  page,
  pill,
  onNavigate,
}: {
  page: SettingsPage;
  pill: string;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={`/settings/${page.path}`}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "relative isolate flex h-10 items-center gap-3 rounded-full px-4 text-sm outline-none focus-visible:outline-2 focus-visible:outline-ring",
          isActive ? "font-semibold" : "text-foreground/90 hover:bg-tonal",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId={pill}
              transition={spatial}
              className="absolute inset-0 -z-10 rounded-full bg-selected"
            />
          )}
          <Icon name={page.icon} filled={isActive} />
          {page.title}
        </>
      )}
    </NavLink>
  );
}
