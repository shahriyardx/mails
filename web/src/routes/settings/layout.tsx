import { useState } from "react";
import { Outlet, useLocation } from "react-router";
import { AccountMenu } from "@/components/app/account-menu";
import { Icon, IconButton, Sheet, SheetContent, SheetTitle } from "@/components/kit";
import { NavGroup, NavRow, SidebarFrame } from "@/components/mail/sidebar";
import { SETTINGS_PAGES } from "./pages";
import { PageActionSlot } from "./parts";

const GROUPS = [...new Set(SETTINGS_PAGES.map((p) => p.group))];

/**
 * The settings shell: the sidebar swaps to the settings nav, and each page
 * sits in a centred column under a big title, its one-line description and
 * its primary action (pages put it there with <PageAction>).
 */
export function Component() {
  const [navOpen, setNavOpen] = useState(false);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const { pathname } = useLocation();
  const current = SETTINGS_PAGES.find((p) => pathname.startsWith(`/settings/${p.path}`));

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-58 shrink-0 border-r border-border md:block">
        <Nav pathname={pathname} />
      </aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">Settings</SheetTitle>
          <Nav pathname={pathname} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-190 px-4 pt-4 pb-16 sm:px-8 md:pt-12">
          <header className="mb-8 flex flex-wrap items-start gap-x-4 gap-y-3">
            <IconButton
              icon="menu"
              label="Open settings menu"
              className="-ml-2 md:hidden"
              onClick={() => setNavOpen(true)}
            />
            <div className="min-w-0 flex-1 basis-64">
              <h1 className="text-[28px] leading-tight font-bold sm:text-[30px]">
                {current?.title ?? "Settings"}
              </h1>
              {current?.description && (
                <p className="mt-1.5 text-muted-foreground">{current.description}</p>
              )}
            </div>
            <div
              ref={setSlot}
              className="flex shrink-0 items-center gap-2 empty:hidden sm:pt-1.5"
            />
          </header>
          <PageActionSlot.Provider value={slot}>
            <Outlet />
          </PageActionSlot.Provider>
        </div>
      </main>
    </div>
  );
}

function Nav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <SidebarFrame>
      <NavRow
        to="/mail/all/inbox"
        active={false}
        onClick={onNavigate}
        lead={<Icon name="arrow_back" size={18} className="text-muted-foreground" />}
        className="shrink-0"
      >
        Back to mail
      </NavRow>
      <nav aria-label="Settings" className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
        {GROUPS.map((group) => (
          <NavGroup key={group} title={group}>
            {SETTINGS_PAGES.filter((p) => p.group === group).map((page) => (
              <li key={page.path}>
                <NavRow
                  to={`/settings/${page.path}`}
                  active={pathname.startsWith(`/settings/${page.path}`)}
                  onClick={onNavigate}
                >
                  {page.title}
                </NavRow>
              </li>
            ))}
            {group === "Developers" && (
              <li>
                <NavRow to="/docs" active={false} onClick={onNavigate}>
                  Docs
                </NavRow>
              </li>
            )}
          </NavGroup>
        ))}
      </nav>
      <div className="-mx-1 flex shrink-0 items-center justify-end px-1">
        <AccountMenu />
      </div>
    </SidebarFrame>
  );
}
