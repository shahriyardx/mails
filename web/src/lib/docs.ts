/**
 * Docs viewer logic: URL <-> markdown file, link kinds, callouts. The pages
 * live in src/docs (path "api/index" is src/docs/api/index.md, "/docs" is
 * index.md); src/docs/nav.json is the sidebar.
 */

export interface NavPage {
  path: string;
  title: string;
}

export interface NavSection {
  title: string;
  pages: NavPage[];
}

/** "/docs/api/index" -> "api/index"; "/docs" -> "index". */
export function docPathFromUrl(pathname: string) {
  const rest = pathname
    .replace(/^\/docs(?=\/|$)/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.md$/, "");
  return rest || "index";
}

/**
 * The file for a doc path, given the files that exist ("api/index.md"...).
 * "api" finds api.md, then api/index.md. Null when there is none.
 */
export function docFile(path: string, files: ReadonlySet<string>) {
  const clean = docPathFromUrl(`/docs/${path}`);
  for (const candidate of [`${clean}.md`, `${clean}/index.md`]) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

/** The URL of a doc path: "index" -> "/docs". */
export function docHref(path: string) {
  return path === "index" ? "/docs" : `/docs/${path}`;
}

export type LinkKind = "hash" | "internal" | "external";

/** In-page anchor, a route in this app, or anything else (new tab). */
export function linkKind(href: string): LinkKind {
  if (href.startsWith("#")) return "hash";
  if (href.startsWith("/") && !href.startsWith("//")) return "internal";
  return "external";
}

export type Callout = "tip" | "warning" | "danger";

/** The smallest slice of a hast node this needs (react-markdown's `node`). */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}

/**
 * A blockquote whose first paragraph starts with **Tip:**, **Warning:** or
 * **Danger:** is a callout of that kind.
 */
export function calloutKind(node: HastNode | undefined): Callout | null {
  const paragraph = node?.children?.find((c) => c.type === "element");
  if (paragraph?.tagName !== "p") return null;
  const strong = paragraph.children?.[0];
  if (strong?.tagName !== "strong") return null;
  const text = strong.children?.[0]?.value?.trim().toLowerCase();
  const match = /^(tip|warning|danger):?$/.exec(text ?? "");
  return (match?.[1] as Callout | undefined) ?? null;
}

/** The page before and after a path, in sidebar order. */
export function neighbours(nav: NavSection[], path: string) {
  const pages = nav.flatMap((s) => s.pages);
  const i = pages.findIndex((p) => p.path === path);
  return i === -1 ? {} : { prev: pages[i - 1], next: pages[i + 1] };
}
