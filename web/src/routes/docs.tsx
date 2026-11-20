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

  useEffect(() => {
    document.title = `${title ?? "Docs"} · Mails`;
  }, [title]);

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
      <aside className="hidden w-64 shrink-0 md:block">
        <DocsNav current={path} />
      </aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">Docs pages</SheetTitle>
          <DocsNav current={path} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 px-3 md:pl-1">
          <IconButton
            icon="menu"
            label="Open docs pages"
            className="md:hidden"
            onClick={() => setNavOpen(true)}
          />
          <p className="flex-1 truncate text-lg font-medium">{title ?? "Docs"}</p>
          <AccountMenu />
        </header>
        <div ref={main} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 md:pr-2 md:pl-0">
          <div className="min-h-full rounded-3xl bg-surface">
            <article className="mx-auto max-w-3xl px-5 py-6 md:px-10 md:py-10">
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
        "flex flex-col gap-0.5 rounded-2xl bg-box px-4 py-3 outline-none hover:bg-tonal focus-visible:outline-2 focus-visible:outline-ring",
        dir === "next" && "text-right sm:col-start-2",
      )}
    >
      <span className="text-xs text-muted-foreground">{dir === "prev" ? "Previous" : "Next"}</span>
      <span className="text-sm font-medium">{page.title}</span>
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2 px-5 text-base font-medium">
        <Icon name="menu_book" /> Docs
      </div>
      <div className="flex flex-col gap-2 px-3 pb-2">
        <Link
          to="/mail/all/inbox"
          onClick={onNavigate}
          className="flex h-10 items-center gap-3 rounded-full px-4 text-sm hover:bg-tonal"
        >
          <Icon name="arrow_back" /> Back to mail
        </Link>
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
      <nav aria-label="Docs" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {sections.map((section) => (
          <div key={section.title}>
            <h2 className="px-4 pt-5 pb-1.5 text-xs font-medium text-muted-foreground">
              {section.title}
            </h2>
            <ul className="space-y-0.5">
              {section.pages.map((p) => (
                <li key={p.path}>
                  <Link
                    to={docHref(p.path)}
                    onClick={onNavigate}
                    aria-current={p.path === current ? "page" : undefined}
                    className={cn(
                      "flex min-h-9 items-center rounded-full px-4 py-1.5 text-sm outline-none focus-visible:outline-2 focus-visible:outline-ring",
                      p.path === current
                        ? "bg-selected font-semibold"
                        : "text-foreground/90 hover:bg-tonal",
                    )}
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {sections.length === 0 && (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">No page by that name.</p>
        )}
      </nav>
    </div>
  );
}

// ---- Markdown elements -----------------------------------------------------

const heading = "scroll-mt-6 font-medium text-foreground";

const CALLOUT: Record<Callout, { icon: string; className: string }> = {
  tip: { icon: "info", className: "bg-box" },
  warning: { icon: "warning", className: "bg-box" },
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
  h1: ({ node: _, ...props }) => <h1 className={cn(heading, "mb-5 text-3xl")} {...props} />,
  h2: ({ node: _, ...props }) => <h2 className={cn(heading, "mt-10 mb-3 text-xl")} {...props} />,
  h3: ({ node: _, ...props }) => <h3 className={cn(heading, "mt-8 mb-2 text-lg")} {...props} />,
  h4: ({ node: _, ...props }) => <h4 className={cn(heading, "mt-6 mb-2 text-base")} {...props} />,
  p: ({ node: _, ...props }) => <p className="my-3 text-[15px] leading-7" {...props} />,
  ul: ({ node: _, ...props }) => (
    <ul className="my-3 list-disc space-y-1.5 pl-6 text-[15px] leading-7" {...props} />
  ),
  ol: ({ node: _, ...props }) => (
    <ol className="my-3 list-decimal space-y-1.5 pl-6 text-[15px] leading-7" {...props} />
  ),
  li: ({ node: _, ...props }) => <li className="pl-1 marker:text-muted-foreground" {...props} />,
  hr: () => <hr className="my-8 border-border" />,
  strong: ({ node: _, ...props }) => <strong className="font-semibold" {...props} />,
  a: ({ node: _, href = "", children, ...props }) =>
    linkKind(href) === "external" ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground"
        {...props}
      >
        {children}
      </a>
    ) : (
      <Link
        to={href}
        className="underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground"
      >
        {children}
      </Link>
    ),
  code: ({ node: _, className, ...props }) => (
    <code
      className={cn(
        "rounded-md bg-tonal px-1.5 py-0.5 font-mono text-[0.85em] break-words",
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
          "my-5 flex gap-3 rounded-2xl px-4 py-1 [&_p]:my-2 [&_p]:text-sm [&_p]:leading-6",
          className,
        )}
      >
        <Icon name={icon} size={18} className="mt-3 shrink-0" />
        <div className="min-w-0">{children}</div>
      </aside>
    );
  },
  table: ({ node: _, ...props }) => (
    <div className="my-5 overflow-x-auto rounded-2xl bg-box">
      <table className="w-full min-w-lg border-collapse text-left text-[13px]" {...props} />
    </div>
  ),
  th: ({ node: _, ...props }) => (
    <th className="px-3.5 py-2.5 align-bottom font-medium whitespace-nowrap" {...props} />
  ),
  td: ({ node: _, ...props }) => (
    <td className="border-t border-border px-3.5 py-2.5 align-top" {...props} />
  ),
  img: ({ node: _, alt = "", ...props }) => (
    <img alt={alt} loading="lazy" className="my-4 max-w-full rounded-2xl" {...props} />
  ),
};
