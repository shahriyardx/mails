import { useQuery } from "@tanstack/react-query";
import {
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Markdown, { type Components } from "react-markdown";
import { Link, useLocation } from "react-router";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { AccountMenu } from "@/components/app/account-menu";
import { CodeBlock } from "@/components/app/copy";
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  Input,
  Sheet,
  SheetContent,
  SheetTitle,
  Skeleton,
} from "@/components/kit";
import { NavGroup, NavRow, SidebarFrame } from "@/components/mail/sidebar";
import navData from "@/docs/nav.json";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  type Callout,
  calloutKind,
  docFile,
  docHref,
  docPathFromUrl,
  linkKind,
  type NavSection,
  neighbours,
} from "@/lib/docs";
import { useDocumentTitle } from "@/lib/title";

const NAV = navData as NavSection[];

/** Every page under src/docs, loaded on demand as raw markdown. */
const LOADERS = new Map(
  Object.entries(
    import.meta.glob<string>("../docs/**/*.md", { query: "?raw", import: "default" }),
  ).map(([key, load]) => [key.replace("../docs/", ""), load]),
);
const FILES = new Set(LOADERS.keys());

/** /docs and /docs/*: the markdown in src/docs with nav.json as the sidebar. */
export function Component() {
  const { pathname, hash } = useLocation();
  const path = docPathFromUrl(pathname);
  const file = docFile(path, FILES);
  const [navOpen, setNavOpen] = useState(false);
  const main = useRef<HTMLDivElement>(null);
  const title = NAV.flatMap((s) => s.pages).find((p) => p.path === path)?.title;
  const page = useQuery({
    queryKey: ["doc", file],
    queryFn: () => LOADERS.get(file!)!(),
    enabled: file !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useDocumentTitle(title ?? "Docs");

  // New page: back to the top. A #hash: scroll to that heading once it exists.
  useEffect(() => {
    if (!page.data) return;
    const target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target) target.scrollIntoView();
    else main.current?.scrollTo(0, 0);
  }, [page.data, hash]);

  const { prev, next } = neighbours(NAV, path);

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-58 shrink-0 border-r border-border md:block">
        <DocsNav current={path} />
      </aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">Docs pages</SheetTitle>
          <DocsNav current={path} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        <div ref={main} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-190 px-4 pt-4 pb-16 sm:px-8 md:pt-12">
            <IconButton
              icon="menu"
              label="Open docs pages"
              className="-ml-2 mb-2 md:hidden"
              onClick={() => setNavOpen(true)}
            />
            <article>
              {file === null ? (
                <EmptyState
                  icon="menu_book"
                  title="No such page"
                  body="It may have moved. The contents on the left list every page."
                  action={
                    <Button render={<Link to="/docs" />} nativeButton={false}>
                      Docs home
                    </Button>
                  }
                />
              ) : page.isPending ? (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-9 w-2/3" />
                  <Skeleton className="h-4" />
                  <Skeleton className="h-4" />
                  <Skeleton className="h-4 w-4/5" />
                </div>
              ) : page.isError ? (
                <EmptyState
                  icon="error"
                  title="Could not load this page"
                  body={errorMessage(page.error)}
                  action={<Button onClick={() => page.refetch()}>Try again</Button>}
                />
              ) : (
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeSlug]}
                  components={COMPONENTS}
                >
                  {page.data}
                </Markdown>
              )}

              {file !== null && (prev || next) && (
                <nav
                  aria-label="Next and previous page"
                  className="mt-12 grid gap-3 sm:grid-cols-2"
                >
                  {prev ? <PageLink page={prev} dir="prev" /> : <span />}
                  {next && <PageLink page={next} dir="next" />}
                </nav>
              )}
            </article>
          </div>
        </div>
      </main>
    </div>
  );
}

function PageLink({ page, dir }: { page: { path: string; title: string }; dir: "prev" | "next" }) {
  return (
    <Link
      to={docHref(page.path)}
      className={cn(
        "flex flex-col gap-0.5 rounded-xl border border-border bg-surface px-4 py-3 outline-none transition-colors hover:border-input focus-visible:outline-2 focus-visible:outline-ring",
        dir === "next" && "text-right sm:col-start-2",
      )}
    >
      <span className="text-xs text-muted-foreground">{dir === "prev" ? "Previous" : "Next"}</span>
      <span className="text-sm font-semibold text-accent">{page.title}</span>
    </Link>
  );
}

function DocsNav({ current, onNavigate }: { current: string; onNavigate?: () => void }) {
  const [query, setQuery] = useState("");
  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return NAV;
    return NAV.map((s) => ({
      ...s,
      pages: s.pages.filter((p) => p.title.toLowerCase().includes(needle)),
    })).filter((s) => s.pages.length > 0);
  }, [query]);

  return (
    <SidebarFrame>
      <div className="flex shrink-0 flex-col gap-2">
        <NavRow
          to="/mail/all/inbox"
          active={false}
          onClick={onNavigate}
          lead={<Icon name="arrow_back" size={18} className="text-muted-foreground" />}
        >
          Back to mail
        </NavRow>
        <div className="relative">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Find a page"
            placeholder="Find a page"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      <nav aria-label="Docs" className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
        {sections.map((section) => (
          <NavGroup key={section.title} title={section.title}>
            {section.pages.map((p) => (
              <li key={p.path}>
                <NavRow to={docHref(p.path)} active={p.path === current} onClick={onNavigate}>
                  {p.title}
                </NavRow>
              </li>
            ))}
          </NavGroup>
        ))}
        {sections.length === 0 && (
          <p className="px-2.5 py-2 text-[13px] text-muted-foreground">No page by that name.</p>
        )}
      </nav>
      <div className="-mx-1 flex shrink-0 items-center justify-end px-1">
        <AccountMenu settings docs={false} />
      </div>
    </SidebarFrame>
  );
}

// ---- Markdown elements -----------------------------------------------------

const heading = "scroll-mt-6 font-display font-semibold tracking-[-0.02em] text-foreground";

const CALLOUT: Record<Callout, { icon: string; className: string }> = {
  tip: { icon: "info", className: "border border-border bg-surface" },
  warning: {
    icon: "warning",
    className: "border border-[color-mix(in_srgb,#d9a54a_45%,var(--border))] bg-surface",
  },
  danger: {
    icon: "error",
    className: "bg-destructive-soft [&_strong:first-child]:text-destructive",
  },
};

/** The text of a fenced block: react-markdown hands `pre` one <code> child. */
function codeOf(children: ReactNode) {
  const code = Array.isArray(children) ? children[0] : children;
  if (!isValidElement(code)) return { text: String(children ?? ""), lang: undefined };
  const props = (code as ReactElement<{ className?: string; children?: ReactNode }>).props;
  return {
    text: String(props.children ?? "").replace(/\n$/, ""),
    lang: /language-(\S+)/.exec(props.className ?? "")?.[1],
  };
}

const COMPONENTS: Components = {
  h1: ({ node: _, ...props }) => (
    <h1 className={cn(heading, "mb-5 text-[30px] leading-tight font-bold")} {...props} />
  ),
  h2: ({ node: _, ...props }) => <h2 className={cn(heading, "mt-10 mb-3 text-xl")} {...props} />,
  h3: ({ node: _, ...props }) => <h3 className={cn(heading, "mt-8 mb-2 text-lg")} {...props} />,
  h4: ({ node: _, ...props }) => <h4 className={cn(heading, "mt-6 mb-2 text-base")} {...props} />,
  p: ({ node: _, ...props }) => (
    <p className="my-3 text-[15px] leading-7 text-soft-foreground" {...props} />
  ),
  ul: ({ node: _, ...props }) => (
    <ul
      className="my-3 list-disc space-y-1.5 pl-6 text-[15px] leading-7 text-soft-foreground"
      {...props}
    />
  ),
  ol: ({ node: _, ...props }) => (
    <ol
      className="my-3 list-decimal space-y-1.5 pl-6 text-[15px] leading-7 text-soft-foreground"
      {...props}
    />
  ),
  li: ({ node: _, ...props }) => <li className="pl-1 marker:text-muted-foreground" {...props} />,
  hr: () => <hr className="my-8 border-border" />,
  strong: ({ node: _, ...props }) => (
    <strong className="font-semibold text-foreground" {...props} />
  ),
  a: ({ node: _, href = "", children, ...props }) =>
    linkKind(href) === "external" ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent underline decoration-[color-mix(in_srgb,var(--accent)_40%,transparent)] underline-offset-2 hover:decoration-current"
        {...props}
      >
        {children}
      </a>
    ) : (
      <Link
        to={href}
        className="text-accent underline decoration-[color-mix(in_srgb,var(--accent)_40%,transparent)] underline-offset-2 hover:decoration-current"
      >
        {children}
      </Link>
    ),
  code: ({ node: _, className, ...props }) => (
    <code
      className={cn(
        "rounded-[5px] border border-border bg-tonal px-1 py-px font-mono text-[0.85em] text-foreground break-words",
        className,
      )}
      {...props}
    />
  ),
  pre: ({ children }) => {
    const { text, lang } = codeOf(children);
    return <CodeBlock title={lang} text={text} className="my-4" />;
  },
  blockquote: ({ node, children }) => {
    const kind = calloutKind(node);
    if (!kind) {
      return (
        <blockquote className="my-4 border-l-2 border-input pl-4 text-muted-foreground">
          {children}
        </blockquote>
      );
    }
    const { icon, className } = CALLOUT[kind];
    return (
      <aside
        className={cn(
          "my-5 flex gap-3 rounded-xl px-4 py-1 [&_p]:my-2 [&_p]:text-sm [&_p]:leading-6",
          className,
        )}
      >
        <Icon name={icon} size={18} className="mt-3 shrink-0" />
        <div className="min-w-0">{children}</div>
      </aside>
    );
  },
  table: ({ node: _, ...props }) => (
    <div className="my-5 overflow-x-auto rounded-xl border border-border">
      {/* A header row of empty cells (a key/value table) is hidden. */}
      <table
        className="w-full min-w-lg border-collapse text-left text-[13px] [&_thead:not(:has(th:not(:empty)))]:hidden [&_thead:not(:has(th:not(:empty)))+tbody_tr:first-child_td]:border-t-0"
        {...props}
      />
    </div>
  ),
  th: ({ node: _, ...props }) => (
    <th
      className="bg-surface px-3.5 py-2.5 align-bottom text-xs font-semibold whitespace-nowrap text-soft-foreground"
      {...props}
    />
  ),
  td: ({ node: _, ...props }) => (
    <td className="border-t border-border px-3.5 py-2.5 align-top" {...props} />
  ),
  img: ({ node: _, alt = "", ...props }) => (
    <img
      alt={alt}
      loading="lazy"
      className="my-4 max-w-full rounded-xl border border-border"
      {...props}
    />
  ),
};
