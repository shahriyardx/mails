import DOMPurify from "dompurify";

/**
 * Turning a stranger's HTML into something safe to draw in the popup.
 *
 * The web app does this with a hand-written pass because it runs on the
 * server, where there is no DOM. Here there is one, so DOMPurify does the
 * removing and this file only decides the policy: no active content, no
 * remote images until the reader asks, every link leaving in a new tab.
 *
 * The result is still rendered inside a sandboxed iframe. Two layers, because
 * neither one is worth betting a reader's session on alone.
 */

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
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
    });
}

const fetches = (css: string) => CSS_FETCH.test(decodeCss(css));

/** Removes every declaration that fetches. */
function stripDeclarations(style: CSSStyleDeclaration) {
  for (const name of Array.from(style)) {
    if (fetches(style.getPropertyValue(name))) style.removeProperty(name);
  }
}

/** Walks a sheet (or grouping rule), dropping fetching declarations and rules. */
function stripRules(owner: { cssRules: CSSRuleList; deleteRule(index: number): void }) {
  for (let index = owner.cssRules.length - 1; index >= 0; index -= 1) {
    const rule = owner.cssRules[index]!;
    if ("style" in rule) stripDeclarations(rule.style as CSSStyleDeclaration);
    if ("cssRules" in rule && "deleteRule" in rule) stripRules(rule as unknown as typeof owner);
    // @import, @font-face and anything else still fetching goes whole.
    if (fetches(rule.cssText)) owner.deleteRule(index);
  }
}

/**
 * A <style> block with every fetch removed, or "" when it cannot be cleaned
 * with certainty. Parsed by the browser's own CSS parser, then checked again
 * as text: if anything fetching survives, the whole block goes.
 */
export function cleanStylesheet(css: string) {
  if (!fetches(css)) return css;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    stripRules(sheet);
    const out = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
    return fetches(out) ? "" : out;
  } catch {
    return "";
  }
}

export interface PreparedEmail {
  html: string;
  /** How many remote resources were held back. */
  blockedImages: number;
}

/**
 * Sanitizes a message and, until the reader opts in, removes every way it
 * could reach the network: img/srcset, background and poster attributes, SVG
 * href, CSS url()/image-set()/@import/@font-face in style attributes and
 * <style> blocks, and the tags that fetch by nature (link, meta refresh,
 * object, embed, iframe, media, input type=image). EmailFrame adds a CSP on
 * top, so anything missed here is still refused by the browser.
 */
export function prepareEmail(
  source: string,
  options: { showRemoteImages: boolean },
): PreparedEmail {
  let blockedImages = 0;
  const allowRemote = options.showRemoteImages;

  DOMPurify.addHook("afterSanitizeElements", (node) => {
    // Lowercased: an SVG <style> reports "style", an HTML one "STYLE".
    if (allowRemote || node.nodeName.toLowerCase() !== "style") return;
    const css = node.textContent ?? "";
    const clean = cleanStylesheet(css);
    if (clean !== css) {
      node.textContent = clean;
      blockedImages += 1;
    }
  });

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const tag = node.nodeName.toLowerCase();
    for (const { name, value } of Array.from(node.attributes)) {
      if (name === "style") continue;
      const isLink = LINK_TAGS.has(tag) && (name === "href" || name === "xlink:href");
      if (isLink) continue;

      if (FETCH_ATTRS.has(name)) {
        const url = value.replace(/[\u0000-\u0020]/g, "");
        if (EMBEDDED_IMAGE.test(url)) continue;
        if (allowRemote && /^https?:\/\//i.test(url)) continue;
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
      }
    }

    const style = node.getAttribute("style");
    if (!allowRemote && style && fetches(style)) {
      if ("style" in node) stripDeclarations((node as HTMLElement).style);
      if (fetches(node.getAttribute("style") ?? "")) node.removeAttribute("style");
      blockedImages += 1;
    }

    if (tag === "a") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });

  try {
    const html = DOMPurify.sanitize(source, {
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
      // bgcolor. The fetch policy lives in the hook above instead; `cid:`
      // images (attachments not downloaded here) are dropped there.
    });
    return { html, blockedImages };
  } finally {
    DOMPurify.removeAllHooks();
  }
}

/**
 * The CSP the message frame carries: nothing loads except embedded images,
 * plus remote images once the reader asks for them.
 */
export function frameCsp(allowRemote: boolean) {
  const images = allowRemote ? "data: https: http:" : "data:";
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

/**
 * The stylesheet the frame carries. Kept close to the web app's so a message
 * does not change shape between the popup and the tab.
 */
export const FRAME_STYLES = `
  html { scrollbar-width: none; }
  html::-webkit-scrollbar { width: 0; height: 0; }
  :root { color-scheme: dark; }
  body {
    margin: 0;
    padding: 0;
    font-family: "Google Sans Flex Variable", ui-sans-serif, system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.55;
    color: oklch(0.88 0.01 85);
    background: transparent;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: oklch(0.88 0.01 85); text-decoration: underline; }
  blockquote {
    margin: 8px 0 8px 4px;
    padding-left: 12px;
    border-left: 2px solid oklch(0.36 0.008 85);
    color: oklch(0.66 0.008 85);
  }
  pre { white-space: pre-wrap; word-break: break-word; }
  img[data-blocked-src] {
    width: 22px !important;
    height: 22px !important;
    max-width: 22px;
    background: repeating-linear-gradient(45deg, oklch(0.88 0.01 85 / 0.12), oklch(0.88 0.01 85 / 0.12) 5px, transparent 5px, transparent 10px);
    border: 1px dashed oklch(0.66 0.008 85);
    border-radius: 3px;
  }
  body > *:first-child { margin-top: 0; }
  body > *:last-child { margin-bottom: 0; }
`;
