import { modeLrgb, modeRgb, parse, useMode as registerMode, wcagLuminance } from "culori/fn";
import DOMPurify from "dompurify";

/**
 * Turning a stranger's HTML into something safe to draw in the thread view.
 * Ported from packages/extension/lib/sanitize.ts (keep the two in step).
 *
 * DOMPurify does the removing; this file decides the policy: no active
 * content, no remote fetch of any kind until the reader asks, every link
 * leaving in a new tab. Inline (cid:) images point at our own attachment
 * URL. The result is still rendered inside a sandboxed iframe with a CSP
 * (frameCsp), two layers because neither is worth betting a session on.
 */

// The modes parse() and wcagLuminance() need, registered once (tree-shaken culori).
registerMode(modeRgb);
registerMode(modeLrgb);

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Images embedded in the message itself: no request leaves the machine. */
const EMBEDDED_IMAGE = /^data:image\/(?:png|gif|jpeg|webp);base64,/i;
/** A URL the browser would fetch over the network, protocol-relative included. */
const NETWORK_URL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/** Attributes whose value the browser fetches. Links (a/area href) are not fetches. */
const FETCH_ATTRS = new Set([
  "src",
  "srcset",
  "background",
  "poster",
  "href",
  "xlink:href",
  "data",
  "action",
  "lowsrc",
  "dynsrc",
  "longdesc",
  "imagesrcset",
]);
const LINK_TAGS = new Set(["a", "area"]);
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * CSS that can make the browser fetch something. Run on text that has been
 * through `decodeCss`, so escapes such as `\75rl(` and comments are already
 * undone. A fragment reference such as `url(#gradient)` stays local.
 */
const CSS_FETCH =
  /@import|@font-face|(?:url|image|image-set|cross-fade|element|src)\s*\((?!\s*['"]?#)/i;

/** CSS with comments removed and escapes resolved, for matching only. */
export function decodeCss(css: string) {
  return css
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "")
    .replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\([\s\S])/gi, (_, hex: string, char: string) => {
      if (!hex) return char;
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
    });
}

const fetches = (css: string) => CSS_FETCH.test(decodeCss(css));

/**
 * Bodies past this are cut before parsing. Real mail is far smaller; the cap
 * bounds the work any pattern below can be made to do.
 */
export const MAX_HTML = 2_000_000;

/**
 * Layout a message could use to draw over its own content or imitate our UI
 * (a fake "show images" bar laid over the text): out-of-flow positioning,
 * transforms and negative margins. Mail clients strip these too.
 */
function redresses(name: string, value: string) {
  if (name === "position") return !/^\s*static\s*$/i.test(value);
  // Names come from the browser's parser, so CSS escapes are already decoded.
  if (["transform", "translate", "rotate", "scale", "zoom"].includes(name)) return true;
  return name.startsWith("margin") && value.includes("-");
}

/** Removes every declaration that fetches (unless allowed) or redresses. */
function stripDeclarations(style: CSSStyleDeclaration, allowRemote: boolean) {
  for (const name of Array.from(style)) {
    const value = style.getPropertyValue(name);
    if ((!allowRemote && fetches(value)) || redresses(name, value)) style.removeProperty(name);
  }
}

type RuleOwner = { cssRules: CSSRuleList; deleteRule(index: number): void };

/** Walks a sheet (or grouping rule), cleaning declarations and dropping fetching rules. */
function stripRules(owner: RuleOwner, allowRemote: boolean) {
  for (let index = owner.cssRules.length - 1; index >= 0; index -= 1) {
    const rule = owner.cssRules[index]!;
    if ("style" in rule) stripDeclarations(rule.style as CSSStyleDeclaration, allowRemote);
    if ("cssRules" in rule && "deleteRule" in rule)
      stripRules(rule as unknown as RuleOwner, allowRemote);
    // @import, @font-face and anything else still fetching goes whole.
    if (!allowRemote && fetches(rule.cssText)) owner.deleteRule(index);
  }
}

/**
 * A <style> block with every fetch (unless allowed) and every redressing
 * declaration removed, or "" when it cannot be cleaned with certainty.
 * Parsed by the browser's own CSS parser, then checked again as text: if
 * anything fetching survives, the whole block goes.
 */
export function cleanStylesheet(css: string, allowRemote = false) {
  // Always parsed: a quick text test can be dodged with CSS escapes.
  if (!css.trim()) return css;
  // CSS never needs "<". Written back into a <style> element, a "</style"
  // in a string or comment would end the element early when the result is
  // parsed again, and turn the rest into live markup (mutation XSS).
  if (css.includes("<")) return "";
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    stripRules(sheet, allowRemote);
    const out = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
    return out.includes("<") ? "" : !allowRemote && fetches(out) ? "" : out;
  } catch {
    return "";
  }
}

/** A colour too dark to read on the dark page. */
function isDark(value: string) {
  const color = parse(value.trim());
  return color ? wcagLuminance(color) < 0.18 : false;
}

/** A background value that paints something (a visible colour or a gradient). */
function paints(style: CSSStyleDeclaration) {
  const color = parse(style.backgroundColor.trim());
  return (
    (color !== undefined && (color.alpha ?? 1) > 0) || style.backgroundImage.includes("gradient(")
  );
}

/**
 * Whether the message paints its own page (a newsletter). Those are shown on
 * white with their colours untouched; everything else follows the dark page.
 * Read with the browser's parsers (inert: a parsed document loads nothing),
 * so the work stays linear in the input.
 */
export function declaresBackground(html: string) {
  const doc = new DOMParser().parseFromString(html.slice(0, MAX_HTML), "text/html");
  for (const el of Array.from(doc.querySelectorAll("[bgcolor]"))) {
    const value = el.getAttribute("bgcolor")!.trim();
    const color = value.toLowerCase() === "transparent" ? undefined : parse(value);
    if (color) return true;
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[style]"))) {
    if (paints(el.style)) return true;
  }
  for (const node of Array.from(doc.querySelectorAll("style"))) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(node.textContent ?? "");
      for (const rule of Array.from(sheet.cssRules)) {
        if ("style" in rule && paints(rule.style as CSSStyleDeclaration)) return true;
      }
    } catch {
      // Unparseable: it paints nothing we can rely on.
    }
  }
  return false;
}

export interface PreparedEmail {
  /** What the sender wrote. */
  html: string;
  /** What they quoted (earlier messages), folded away by default. */
  quoted: string | null;
  /** How many remote resources were held back. */
  blockedImages: number;
  /** How many remote images load now that the reader allowed them. */
  remoteImages: number;
  /** Paints its own page: render on white, colours untouched. */
  ownsBackground: boolean;
}

export interface PrepareOptions {
  showRemoteImages: boolean;
  /** Content-ID (without <>) to URL, for cid: references. */
  inlineImages?: Record<string, string>;
}

/**
 * Sanitizes a message and, until the reader opts in, removes every way it
 * could reach the network: img/srcset, background and poster attributes, SVG
 * href, CSS url()/image-set()/@import/@font-face in style attributes and
 * <style> blocks, and the tags that fetch by nature (link, meta refresh,
 * object, embed, iframe, media, input type=image). EmailFrame adds a CSP on
 * top, so anything missed here is still refused by the browser.
 */
export function prepareEmail(source: string, options: PrepareOptions): PreparedEmail {
  const { html, ...rest } = clean(source, options);
  return { ...splitQuoted(html), ...rest };
}

/**
 * What the composer accepts. Unlike a received mail, which renders inside a
 * sandboxed frame, the editor is part of the app's own page: a <style>
 * block or a style, class or id attribute there would restyle or cover the
 * dashboard itself. So no styling survives, and nothing interactive.
 */
const EDITOR_POLICY = {
  FORBID_TAGS: [
    "style",
    "link",
    "meta",
    "base",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "iframe",
    "object",
    "embed",
    "svg",
    "math",
    "video",
    "audio",
  ],
  FORBID_ATTR: ["style", "class", "id", "srcset", "background", "poster"],
};

/**
 * Safe HTML for the composer's editor (a reply's quote, a saved draft, a
 * paste): the
 * mail policy, then the editor policy. Remote images stay held back while
 * editing and come back on send through restoreBlockedImages. Held-back
 * images are restored first, because clean() drops data attributes: a saved
 * draft (already held back once) would otherwise lose them for good.
 */
export const sanitizeForEditor = (html: string) =>
  DOMPurify.sanitize(
    clean(restoreBlockedImages(html), { showRemoteImages: false }).html,
    EDITOR_POLICY,
  );

/** Puts held-back remote images back, for the copy that is sent. */
export function restoreBlockedImages(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const img of Array.from(doc.querySelectorAll("img[data-blocked-src]"))) {
    img.setAttribute("src", img.getAttribute("data-blocked-src")!);
    img.removeAttribute("data-blocked-src");
  }
  return doc.body.innerHTML;
}

function clean(source: string, options: PrepareOptions) {
  let blockedImages = 0;
  let remoteImages = 0;
  const allowRemote = options.showRemoteImages;
  const inline = options.inlineImages ?? {};
  const ownsBackground = declaresBackground(source);
  // Dark text written for a white page is unreadable on ours, so it goes
  // (and inherits the page's off-white). A message with its own page keeps it.
  const dropDarkText = !ownsBackground;

  DOMPurify.addHook("afterSanitizeElements", (node) => {
    // Lowercased: an SVG <style> reports "style", an HTML one "STYLE".
    if (node.nodeName.toLowerCase() !== "style") return;
    const css = node.textContent ?? "";
    const clean = cleanStylesheet(css, allowRemote);
    if (clean !== css) {
      node.textContent = clean;
      if (!allowRemote && fetches(css)) blockedImages += 1;
    }
  });

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const tag = node.nodeName.toLowerCase();
    for (const { name, value } of Array.from(node.attributes)) {
      if (name === "style") continue;
      const isLink = LINK_TAGS.has(tag) && (name === "href" || name === "xlink:href");
      if (isLink) continue;

      if (FETCH_ATTRS.has(name)) {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: drops the control characters browsers ignore inside URLs
        const url = value.replace(/[\u0000- ]/g, "");
        if (EMBEDDED_IMAGE.test(url)) continue;
        const cid = tag === "img" && name === "src" && /^cid:/i.test(url) ? url.slice(4) : null;
        const inlineUrl = cid ? (inline[cid] ?? inline[cid.replace(/^<|>$/g, "")]) : undefined;
        if (inlineUrl) {
          node.setAttribute(name, inlineUrl);
          continue;
        }
        if (allowRemote && /^https?:\/\//i.test(url)) {
          remoteImages += 1;
          continue;
        }
        if (NETWORK_URL.test(url)) blockedImages += 1;
        if (tag === "img" && name === "src" && NETWORK_URL.test(url)) {
          node.setAttribute("data-blocked-src", url);
          node.setAttribute("src", TRANSPARENT_PIXEL);
        } else {
          node.removeAttribute(name);
        }
      } else if (!allowRemote && node.namespaceURI === SVG_NS && fetches(value)) {
        // SVG presentation attributes (fill, filter, mask...) take url() too.
        node.removeAttribute(name);
        blockedImages += 1;
      } else if (dropDarkText && name === "color" && tag === "font" && isDark(value)) {
        node.removeAttribute(name);
      }
    }

    const style = node.getAttribute("style");
    if (style) {
      const css = (node as HTMLElement).style as CSSStyleDeclaration | undefined;
      const fetching = !allowRemote && fetches(style);
      if (css) stripDeclarations(css, allowRemote);
      if (fetching) {
        blockedImages += 1;
        if (fetches(node.getAttribute("style") ?? "")) node.removeAttribute("style");
      }
      if (dropDarkText && css?.color && isDark(css.color)) css.removeProperty("color");
    }

    if (tag === "a") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });

  try {
    const html = DOMPurify.sanitize(source.slice(0, MAX_HTML), {
      FORBID_TAGS: [
        "script",
        "iframe",
        "frame",
        "object",
        "embed",
        "applet",
        "form",
        "input",
        "button",
        "textarea",
        "select",
        "option",
        "dialog",
        "base",
        "link",
        "meta",
        "video",
        "audio",
        "source",
        "track",
      ],
      FORBID_ATTR: ["srcset", "ping", "formaction"],
      ALLOW_DATA_ATTR: false,
      // Keeps a leading <style>, which the parser would otherwise put in a
      // <head> that is then thrown away.
      FORCE_BODY: true,
      // DOMPurify's default URI check stays: a custom ALLOWED_URI_REGEXP is
      // applied to every non-URI attribute too and strips width, align and
      // bgcolor. The fetch policy lives in the hook above instead.
    });
    return { html, blockedImages, remoteImages, ownsBackground };
  } finally {
    DOMPurify.removeAllHooks();
  }
}

const QUOTE = ".gmail_quote, blockquote[type='cite'], blockquote";

/**
 * Splits sanitized HTML into what the sender wrote and what they quoted. A
 * reply carries the message it answers; shown in full, three new lines
 * arrive under a wall the reader has already read. "On ... wrote:" travels
 * with the quote. Nothing is folded when the quote is all there is.
 */
export function splitQuoted(html: string): { html: string; quoted: string | null } {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const quotes = Array.from(doc.body.querySelectorAll(QUOTE)).filter(
    (el) => !el.parentElement?.closest(QUOTE),
  );
  if (quotes.length === 0) return { html, quoted: null };

  const holder = doc.createElement("div");
  for (const quote of quotes) {
    const before = quote.previousElementSibling;
    const tail = (before?.textContent ?? "").slice(-200);
    if (before && /wrote:\s*$/i.test(tail) && !before.matches(QUOTE)) {
      holder.append(before);
    }
    holder.append(quote);
  }
  // A stylesheet sits in the written part; the quote needs it too.
  for (const sheet of Array.from(doc.body.querySelectorAll("style"))) {
    holder.prepend(sheet.cloneNode(true));
  }
  if (!(doc.body.textContent ?? "").trim() && !doc.body.querySelector("img")) {
    return { html, quoted: null };
  }
  return { html: doc.body.innerHTML, quoted: holder.innerHTML };
}

/**
 * The CSP the message frame carries: nothing loads except embedded images,
 * our own inline attachments, and remote images once the reader asks.
 * `attachments` is the absolute URL prefix inline images are served from.
 */
export function frameCsp(allowRemote: boolean, attachments?: string) {
  const images = ["data:", attachments, allowRemote && "https: http:"].filter(Boolean).join(" ");
  return `default-src 'none'; img-src ${images}; style-src 'unsafe-inline'; font-src data:`;
}

/** Plain text, wrapped so it reads like the message it was typed as. */
export function textToHtml(text: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer nofollow">$1</a>',
  );
  return `<div style="white-space:pre-wrap">${linked}</div>`;
}

/** Frame colours per app theme (tokens.css --soft-foreground, --muted-foreground, --border). */
const FRAME_THEME = {
  dark: { text: "#b9b7c3", muted: "#94929f", line: "#3a3942" },
  light: { text: "#4b4957", muted: "#686574", line: "#d4d1de" },
} as const;

/**
 * The stylesheet inside the frame. Kept close to the extension's. The app's
 * fonts are not loaded in the frame (font-src stays data: only), so Inter
 * applies only where it is installed; otherwise the system sans.
 */
export function frameStyles(onWhite: boolean, theme: "dark" | "light" = "dark") {
  const colors = FRAME_THEME[theme];
  const text = onWhite ? "#1f1f1f" : colors.text;
  return `
  html { scrollbar-width: none; }
  html::-webkit-scrollbar { width: 0; height: 0; }
  :root { color-scheme: ${onWhite ? "light" : theme}; }
  body {
    margin: 0;
    padding: ${onWhite ? "16px" : "0"};
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    font-size: ${onWhite ? "14px" : "15.5px"};
    line-height: ${onWhite ? "1.55" : "1.75"};
    color: ${text};
    background: ${onWhite ? "#fff" : "transparent"};
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  p { margin: 0 0 14px; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: ${text}; text-decoration: underline; }
  blockquote {
    margin: 8px 0 8px 4px;
    padding-left: 12px;
    border-left: 2px solid ${colors.line};
    color: ${onWhite ? "#555" : colors.muted};
  }
  pre { white-space: pre-wrap; word-break: break-word; }
  img[data-blocked-src] {
    width: 22px !important;
    height: 22px !important;
    max-width: 22px;
    background: repeating-linear-gradient(45deg, ${colors.line}, ${colors.line} 5px, transparent 5px, transparent 10px);
    border: 1px dashed ${colors.muted};
    border-radius: 3px;
  }
  body > *:first-child { margin-top: 0; }
  body > *:last-child { margin-bottom: 0; }
`;
}
