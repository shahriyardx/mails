// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cleanStylesheet, decodeCss, frameCsp, prepareEmail } from "./sanitize";

const blocked = (html: string) => prepareEmail(html, { showRemoteImages: false });
const shown = (html: string) => prepareEmail(html, { showRemoteImages: true });

/** Any trace of the tracking host left in the output. */
const leaks = (html: string) =>
  /x\.test/i.test(html.replace(/data-blocked-src="[^"]*"/g, ""));

describe("remote content is blocked until the reader opts in", () => {
  const cases: [string, string][] = [
    ["img src", '<img src="https://x.test/p.gif">'],
    ["protocol-relative img", '<img src="//x.test/p.gif">'],
    ["img with whitespace in scheme", '<img src=" ht\ttps://x.test/p.gif">'],
    ["srcset", '<img srcset="https://x.test/a.png 1x, https://x.test/b.png 2x">'],
    ["picture source", '<picture><source srcset="https://x.test/s.png"><img alt="a"></picture>'],
    ["background attribute", '<table background="https://x.test/bg.png"><tr><td background="//x.test/bg">a</td></tr></table>'],
    ["video poster", '<video poster="https://x.test/p.png" src="https://x.test/v.mp4"></video>'],
    ["audio", '<audio src="https://x.test/a.mp3"></audio>'],
    ["input type=image", '<input type="image" src="https://x.test/i.png">'],
    ["svg image href", '<svg><image href="https://x.test/a.png"/></svg>'],
    ["svg image xlink:href", '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://x.test/a.png"/></svg>'],
    ["svg feImage", '<svg><filter><feImage href="https://x.test/f.png"/></filter></svg>'],
    ["svg fill url", '<svg><rect fill="url(https://x.test/g.svg#g)"/></svg>'],
    ["object", '<object data="https://x.test/o.swf"></object>'],
    ["embed", '<embed src="https://x.test/e.swf">'],
    ["iframe", '<iframe src="https://x.test/f"></iframe>'],
    ["link stylesheet", '<link rel="stylesheet" href="https://x.test/a.css"><p>a</p>'],
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=https://x.test/"><p>a</p>'],
    ["style url()", '<div style="background:url(https://x.test/a.png)">a</div>'],
    ["style url with quotes", "<div style=\"background-image: url('//x.test/a.png')\">a</div>"],
    ["style hex escape", '<div style="background:\\75rl(https://x.test/a.png)">a</div>'],
    ["style escape in host", '<div style="background:url(https://x\\2etest/a.png)">a</div>'],
    ["style comment", '<div style="background:/**/url(https://x.test/a.png)">a</div>'],
    ["style image-set", '<div style="background-image:image-set(\'https://x.test/a.png\' 1x)">a</div>'],
    ["style -webkit-image-set", '<div style="background-image:-webkit-image-set(url(https://x.test/a.png) 1x)">a</div>'],
    ["style custom property", '<div style="--bg:url(https://x.test/a.png);background:var(--bg)">a</div>'],
    ["<style> url()", "<style>.a{background:url(https://x.test/a.png)}</style><p class=a>a</p>"],
    ["<style> @import", '<style>@import "https://x.test/a.css"; p{color:red}</style><p>a</p>'],
    ["<style> @import url", "<style>@import url(https://x.test/a.css);</style><p>a</p>"],
    ["<style> @font-face", "<style>@font-face{font-family:F;src:url(https://x.test/f.woff)}</style><p>a</p>"],
    ["<style> escaped url", "<style>.a{background:\\75 rl(https://x.test/a.png)}</style><p>a</p>"],
    ["<style> in @media", "<style>@media (min-width:1px){.a{background:url(https://x.test/a.png)}}</style><p>a</p>"],
    ["<style> image-set", "<style>.a{background:image-set('https://x.test/a.png' 1x)}</style><p>a</p>"],
    ["svg <style>", "<svg><style>rect{fill:url(https://x.test/g.svg#g)}</style><rect/></svg>"],
    ["form action", '<form action="https://x.test/f"><button formaction="https://x.test/b">go</button></form>'],
    ["a ping", '<a href="https://ok.example/" ping="https://x.test/ping">a</a>'],
    ["base href", '<base href="https://x.test/"><img src="p.gif">'],
  ];

  for (const [name, html] of cases) {
    it(name, () => {
      const out = blocked(html).html;
      expect(leaks(out), out).toBe(false);
    });
  }

  it("counts what it held back", () => {
    const result = blocked(
      '<img src="https://x.test/a.gif"><div style="background:url(https://x.test/b.png)">a</div>',
    );
    expect(result.blockedImages).toBe(2);
    expect(result.html).toContain('data-blocked-src="https://x.test/a.gif"');
  });

  it("keeps the rest of a style that also fetched", () => {
    const out = blocked('<div style="color: red; background: url(https://x.test/a.png)">a</div>').html;
    expect(out).toContain("color: red");
    expect(leaks(out)).toBe(false);
  });

  it("keeps the rest of a stylesheet", () => {
    const out = blocked(
      "<style>p{color:red}.a{background:url(https://x.test/a.png);margin:0}</style><p>a</p>",
    ).html;
    expect(out).toMatch(/color:\s*red/);
    expect(out).toMatch(/margin:\s*0/);
    expect(leaks(out)).toBe(false);
  });

  it("keeps a stylesheet with no fetch (as the browser writes it back)", () => {
    expect(cleanStylesheet("p{color:red}").replace(/\s+/g, "")).toBe("p{color:red;}");
  });

  it("keeps embedded images and local fragment references", () => {
    const pixel = "data:image/png;base64,iVBORw0KGgo=";
    const out = blocked(`<img src="${pixel}"><svg><rect fill="url(#g)"/></svg>`);
    expect(out.html).toContain(pixel);
    expect(out.html).toContain('fill="url(#g)"');
    expect(out.blockedImages).toBe(0);
  });

  it("keeps layout attributes", () => {
    const out = blocked(
      '<table width="600" align="center" bgcolor="#fff"><tr><td colspan="2">a</td></tr></table>',
    ).html;
    expect(out).toContain('width="600"');
    expect(out).toContain('align="center"');
    expect(out).toContain('bgcolor="#fff"');
    expect(out).toContain('colspan="2"');
  });

  it("drops cid: and relative image sources without counting them", () => {
    const out = blocked('<img src="cid:logo@x"><img src="p.gif">');
    expect(out.html).not.toMatch(/cid:|p\.gif/);
    expect(out.blockedImages).toBe(0);
  });

  it("keeps links clickable and opens them in a new tab", () => {
    const out = blocked('<a href="https://ok.example/">a</a>').html;
    expect(out).toContain('href="https://ok.example/"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it("still removes scripts and handlers", () => {
    const out = blocked('<img src=x onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">a</a>').html;
    expect(out).not.toMatch(/onerror|<script|javascript:/i);
  });
});

describe("after the reader opts in", () => {
  it("loads remote images and backgrounds", () => {
    const out = shown(
      '<img src="https://x.test/a.gif"><div style="background:url(https://x.test/b.png)">a</div>',
    );
    expect(out.html).toContain('src="https://x.test/a.gif"');
    expect(out.html).toContain("url(https://x.test/b.png)");
    expect(out.blockedImages).toBe(0);
  });

  it("still refuses tags that fetch by nature", () => {
    const out = shown('<iframe src="https://x.test/f"></iframe><link rel=stylesheet href="https://x.test/a.css"><p>a</p>').html;
    expect(leaks(out)).toBe(false);
  });
});

describe("decodeCss", () => {
  it("resolves escapes and drops comments", () => {
    expect(decodeCss("\\75rl(a) u\\72l(b) /* x */c\\(")).toBe("url(a) url(b) c(");
  });

  it("survives out-of-range escapes", () => {
    expect(decodeCss("\\110000")).toBe("\ufffd");
  });
});

describe("frame CSP", () => {
  it("blocks remote loads by default and lets images through on opt-in", () => {
    expect(frameCsp(false)).toContain("default-src 'none'");
    expect(frameCsp(false)).toContain("img-src data:;");
    expect(frameCsp(true)).toContain("img-src data: https: http:");
  });
});

describe("ui redress", () => {
  it("strips out-of-flow layout from inline styles and style blocks, images shown or not", () => {
    for (const showRemoteImages of [false, true]) {
      const { html } = prepareEmail(
        '<style>.x{position:fixed;top:0;color:red}</style><div style="position:absolute;transform:scale(9);margin-top:-500px;color:blue">hi</div><textarea>x</textarea>',
        { showRemoteImages },
      );
      expect(html).not.toMatch(/position|transform|margin-top|textarea/);
      expect(html).toContain("color: blue");
    }
  });
});

describe("ui redress with CSS escapes", () => {
  it("decodes escapes before deciding", () => {
    const { html } = prepareEmail(
      '<style>.x{posit\\69 on:fixed;tr\\61nsform:scale(9);color:red}</style><div style="posit\\69 on:fixed;rotate:45deg;color:blue">hi</div>',
      { showRemoteImages: false },
    );
    expect(html).not.toMatch(/fixed|scale\(9\)|rotate/);
    expect(html).toContain("color: red");
  });
});

describe("mutation XSS through rewritten style blocks", () => {
  it("drops a stylesheet that could close its own <style> element", () => {
    const evil = 'p{color:red}\np::after{content:"\\3c/style\\3e<img src=x onerror=alert(1)>"}';
    expect(cleanStylesheet(evil)).toBe("");
    const { html } = prepareEmail(`<style>${evil}</style><p>hi</p>`, { showRemoteImages: true });
    expect(html).not.toMatch(/<img|onerror/);
  });
});
