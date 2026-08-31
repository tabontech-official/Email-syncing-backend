/*
|--------------------------------------------------------------------------
| Incoming mail bodies
|--------------------------------------------------------------------------
|
| Mail arrives with two parts: plain text and HTML. We stored both,
| verbatim, and the HTML part was 69% of the collection's bytes — inlined
| stylesheets, base64 images, tracking pixels, font wrappers, layout
| tables nested six deep, and a class or style attribute on every node.
|
| Almost none of that is content. This keeps the part that IS content —
| the semantic structure — and discards the presentation layer, which the
| reading pane overrides with the app's own styling anyway.
|
| KEPT
|
|   paragraphs, line breaks, headings h1-h6
|   bold, italic, underline, strikethrough, code, pre
|   ordered and unordered lists
|   blockquotes (so quoted replies still indent)
|   tables, when they carry data
|   links, with their href
|   images, with their src
|
| DISCARDED
|
|   <script>, <style>, <head>, <meta>, <link>, comments
|   every class, id, style, width, bgcolor, align, cellpadding attribute
|   font/span/center wrappers — unwrapped, their text kept
|   base64 data: URIs, which is where the megabytes actually are
|   javascript: and data: hrefs
|   elements left empty once their attributes are gone
|
| Parsed with htmlparser2 rather than pattern-matched. A regex sanitiser
| is a well-known way to let markup through: <scr<script>ipt>, attributes
| split across lines, unquoted values. A parser sees the tree the browser
| would see.
|
| A text version is derived alongside, for list snippets, search, and as
| the body the AI reply reads. Both are stored.
|
| Nothing here throws. If a body cannot be parsed it is kept as it came in
| — losing an email is far worse than storing a big one.
*/

import { parseDocument } from 'htmlparser2';
import render from 'dom-serializer';
import { convert as htmlToTextConvert } from 'html-to-text';

/*
 * Is this actually markup?
 *
 * A real tag, not merely a "<" somewhere: the tag name has to be
 * followed by whitespace, "/" or ">". Plain text quoting an address as
 * "<someone@example.com>" is not HTML, and treating it as such collapses
 * every line break in the message.
 */
export const looksLikeHtml = (value = '') =>
  /<\/?(?:div|p|br|span|a|table|tbody|thead|tfoot|tr|td|th|ul|ol|li|h[1-6]|blockquote|strong|b|em|i|u|s|img|pre|code|hr|font|center|section|article)(?:\s[^>]*)?\/?>/i.test(String(value || ''));

/*
 * Tags whose meaning survives into our own rendering. Anything not here
 * is either dropped with its content (script, style) or unwrapped so its
 * text is kept (span, font, center).
 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'mark', 'sub', 'sup',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
]);

/* Dropped along with everything inside them — none of it is readable. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'head', 'meta', 'link', 'title', 'noscript',
  'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea',
  'svg', 'canvas', 'audio', 'video', 'map', 'area',
]);

/*
 * The only attributes worth keeping. Everything else is presentation
 * (class, style, width, bgcolor, align) or tracking (data-*, on*).
 */
const ALLOWED_ATTRS = {
  a: ['href', 'title'],
  img: ['src', 'alt'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};

/* Structural tags that add nothing once their styling is gone. */
const UNWRAP = new Set([
  'span', 'font', 'center', 'div', 'section', 'article', 'header', 'footer',
  'main', 'nav', 'aside', 'html', 'body', 'tbody-wrapper', 'small', 'big',
  'label', 'figure', 'figcaption', 'picture', 'source', 'col', 'colgroup',
]);

/*
 * A div is a block, so unwrapping it would run its paragraphs together.
 * It becomes a <p> instead — the same visual break, none of the weight.
 */
const BLOCK_UNWRAP_AS_P = new Set([
  'div', 'section', 'article', 'header', 'footer', 'main', 'aside',
]);

/* Links and images must point somewhere safe. */
const SAFE_URL = /^(https?:|mailto:|tel:|\/\/)/i;

const isSafeUrl = (value = '') => {
  const url = String(value || '').trim();
  if (!url) return false;

  /* Base64 payloads are the bulk of a heavy mail body. */
  if (/^data:/i.test(url)) return false;
  if (/^javascript:/i.test(url)) return false;
  if (url.startsWith('#')) return false;

  return SAFE_URL.test(url);
};

/*
 * Invisible padding.
 *
 * Marketing mail pads its preheader with hundreds of zero-width and
 * combining characters so the preview line in a mail client comes out a
 * particular length. They are invisible in a mail client and invisible
 * here — but they survive sanitising, so without this the reading pane
 * opens on screens of what looks like corrupted whitespace.
 *
 * Combining grapheme joiner, soft hyphen, Mongolian vowel separator,
 * zero-width space/non-joiner/joiner, LTR and RTL marks, word joiner, BOM.
 */
const INVISIBLE = /[͏­᠎​-‏⁠﻿]/g;

/* Non-breaking and typographic spaces, which should read as one space. */
const ODD_SPACES = /[  -   　]/g;

/* Tidy a plain-text body, however it was produced. */
export const cleanText = (value = '') =>
  String(value || '')
    .replace(INVISIBLE, '')
    .replace(ODD_SPACES, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/*
 * Was this hidden in the sender's own rendering?
 *
 * Preheaders are the common case: a block of text styled display:none so
 * a mail client shows it in the list preview but never in the message.
 * Stripping the style attribute without checking this would PROMOTE that
 * text into the visible body — content that was deliberately invisible
 * suddenly leading every marketing email.
 */
const isHiddenByStyle = (node) => {
  if (node.attribs?.hidden !== undefined) return true;

  const style = String(node.attribs?.style || '').toLowerCase().replace(/\s+/g, '');
  if (!style) return false;

  return (
    style.includes('display:none') ||
    style.includes('visibility:hidden') ||
    style.includes('opacity:0') ||
    /(?:max-)?height:0(?:px|%)?/.test(style) ||
    /font-size:0(?:px|%)?/.test(style)
  );
};

/*
 * Is this table holding data, or holding a layout?
 *
 * Email is built on nested tables used purely for positioning — a 600px
 * wrapper, then a row, then a cell, around the actual message. Keeping
 * them preserves the content but buries it in scaffolding our own
 * rendering does not need.
 *
 * A table with header cells, or with more than one column, is carrying
 * data and is kept. One that is a single cell, or a single column, is
 * scaffolding and is unwrapped.
 */
const isDataTable = (node) => {
  const rows = [];

  const collectRows = (current) => {
    for (const child of current.children || []) {
      if (child.type !== 'tag') continue;
      const name = String(child.name || '').toLowerCase();

      if (name === 'tr') rows.push(child);
      else if (['thead', 'tbody', 'tfoot'].includes(name)) collectRows(child);
    }
  };

  collectRows(node);

  if (!rows.length) return false;

  const hasHeader = rows.some((row) =>
    (row.children || []).some(
      (cell) => cell.type === 'tag' && String(cell.name).toLowerCase() === 'th'
    )
  );

  if (hasHeader) return true;

  const widestRow = Math.max(
    ...rows.map(
      (row) =>
        (row.children || []).filter(
          (cell) =>
            cell.type === 'tag' &&
            ['td', 'th'].includes(String(cell.name).toLowerCase())
        ).length
    )
  );

  return widestRow > 1 && rows.length > 1;
};

/* Every cell's children, in order — a layout table's actual content. */
const unwrapTable = (node) => {
  const out = [];

  const walk = (current) => {
    for (const child of current.children || []) {
      if (child.type !== 'tag') {
        out.push(child);
        continue;
      }

      const name = String(child.name || '').toLowerCase();

      if (['thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption'].includes(name)) {
        walk(child);
      } else {
        out.push(child);
      }
    }
  };

  walk(node);

  return out;
};

/* Does this node, or anything under it, carry text or an image? */
const hasContent = (node) => {
  if (!node) return false;
  if (node.type === 'text') return Boolean(node.data && node.data.trim());
  if (node.name === 'br' || node.name === 'hr' || node.name === 'img') return true;
  return (node.children || []).some(hasContent);
};

/*
 * Walk the tree, rewriting it in place.
 *
 * Returns the list of nodes that should replace `node` in its parent:
 * itself (kept), nothing (dropped), or its children (unwrapped).
 */
const sanitizeNode = (node) => {
  if (node.type === 'text') {
    node.data = String(node.data || '').replace(INVISIBLE, '');
    return node.data ? [node] : [];
  }

  if (node.type === 'comment' || node.type === 'directive') return [];

  if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') {
    return [node];
  }

  const name = String(node.name || '').toLowerCase();

  if (DROP_WITH_CONTENT.has(name)) return [];

  /*
   * Checked BEFORE the style attribute is stripped — afterwards there is
   * no way to tell a preheader from body text.
   */
  if (isHiddenByStyle(node)) return [];

  /* Recurse first, so decisions above are made on cleaned children. */
  const children = [];
  for (const child of node.children || []) {
    children.push(...sanitizeNode(child));
  }
  node.children = children;
  children.forEach((child) => {
    child.parent = node;
  });

  if (name === 'img') {
    const src = node.attribs?.src || '';
    /* A base64 image or a tracker is not worth the bytes. */
    if (!isSafeUrl(src)) return [];
    node.attribs = { src: src.trim(), ...(node.attribs.alt ? { alt: node.attribs.alt } : {}) };
    return [node];
  }

  if (name === 'a') {
    const href = node.attribs?.href || '';
    /* An unusable link is just text. */
    if (!isSafeUrl(href)) return children;
    node.attribs = { href: href.trim(), target: '_blank', rel: 'noreferrer noopener' };
    return [node];
  }

  /* Scaffolding tables hand their cell contents up; data tables stay. */
  if (name === 'table' && !isDataTable(node)) {
    return unwrapTable(node);
  }

  if (ALLOWED_TAGS.has(name)) {
    const keep = ALLOWED_ATTRS[name] || [];
    const attribs = {};
    for (const attr of keep) {
      if (node.attribs?.[attr]) attribs[attr] = node.attribs[attr];
    }
    node.attribs = attribs;

    /* An empty paragraph or heading is a leftover spacer. */
    if (name !== 'br' && name !== 'hr' && name !== 'img' && !hasContent(node)) {
      return [];
    }

    return [node];
  }

  if (UNWRAP.has(name)) {
    if (!children.length) return [];

    /*
     * Block-level wrappers become a paragraph so the break survives;
     * inline ones (span, font) hand their children straight up.
     */
    if (BLOCK_UNWRAP_AS_P.has(name)) {
      /* Already block-level inside? Then the wrapper adds nothing. */
      const wrapsBlocks = children.some(
        (c) => c.type === 'tag' && ['p', 'div', 'ul', 'ol', 'table', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(String(c.name || '').toLowerCase())
      );

      if (wrapsBlocks) return children;

      node.name = 'p';
      node.attribs = {};
      return hasContent(node) ? [node] : [];
    }

    return children;
  }

  /* Anything unrecognised keeps its text and loses its tag. */
  return children;
};

/*
 * Sanitise an HTML body down to basic, semantic markup.
 *
 * Returns '' when nothing survives, so the caller can fall back rather
 * than storing an empty <div>.
 */
export const sanitizeEmailHtml = (html = '') => {
  const source = String(html || '');
  if (!source.trim()) return '';

  try {
    const document = parseDocument(source, { decodeEntities: true });

    const kept = [];
    for (const node of document.children || []) {
      kept.push(...sanitizeNode(node));
    }

    let out = render(kept, { decodeEntities: true });

    /* Runs of breaks left behind by removed spacers. */
    out = out
      .replace(/(?:\s*<br\s*\/?>\s*){3,}/gi, '<br /><br />')
      .replace(/(?:\s*<p>\s*<\/p>\s*)+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    /* Markup with no words in it is not worth keeping. */
    return out.replace(/<[^>]+>/g, '').trim() ? out : '';
  } catch (err) {
    console.error('sanitizeEmailHtml failed, keeping the raw body:', err.message);
    return source;
  }
};

/*
 * HTML -> readable text, for snippets, search and the AI reply input.
 *
 * html-to-text is already a dependency and handles the cases a hand
 * -rolled stripper gets wrong: link hrefs, list markers, table columns,
 * entity decoding.
 */
export const htmlToText = (html = '') => {
  const source = String(html || '');
  if (!source.trim()) return '';

  try {
    return cleanText(
      htmlToTextConvert(source, {
        wordwrap: false,
        selectors: [
          { selector: 'img', format: 'skip' },
          { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
          { selector: 'table', format: 'dataTable' },
        ],
      })
    );
  } catch (err) {
    console.error('htmlToText failed, falling back to a tag strip:', err.message);
    return cleanText(source.replace(/<[^>]+>/g, ' '));
  }
};

/*
 * The body fields to store for an incoming message.
 *
 * Returns { textBody, htmlBody } — the sanitised markup, and a text
 * version alongside it.
 */
export const normalizeIncomingBody = ({ text = '', html = '' } = {}) => {
  const plain = String(text || '').trim();
  const markup = String(html || '');

  const htmlBody = markup ? sanitizeEmailHtml(markup) : '';

  /*
   * The sender's own text part is cleaned too — it carries the same
   * invisible padding. If it cleans down to nothing, that padding was all
   * it held, so derive one from the markup instead.
   */
  const cleaned = plain ? cleanText(plain) : '';

  /*
   * Is the supplied text part usable, or was it made by a bare tag strip?
   *
   * That was how outgoing replies were stored: `html.replace(/<[^>]+>/g,
   * '')`, which turns "<p>Hi,</p><p>Thanks</p>" into "Hi,Thanks" — every
   * paragraph break gone, and no space where it had been. A body like
   * that is worse than no body, so it is re-derived from the markup.
   *
   * The tell: markup that clearly has block structure, paired with text
   * that has almost no line breaks for its length.
   */
  const markupHasBlocks = /<(?:p|br|div|li|tr|h[1-6]|blockquote)[\s>/]/i.test(
    markup
  );
  const lineBreaks = (cleaned.match(/\n/g) || []).length;
  const looksFlattened =
    markupHasBlocks && cleaned.length > 400 && lineBreaks < cleaned.length / 400;

  const textBody =
    cleaned && !looksFlattened
      ? cleaned
      : htmlBody
        ? htmlToText(htmlBody)
        : markup
          ? htmlToText(markup)
          : cleaned;

  return { textBody, htmlBody };
};

/* How much a body shrank. Used by the backfill report. */
export const bodySavings = (before = '', after = '') => {
  const a = String(before || '').length;
  const b = String(after || '').length;

  return {
    before: a,
    after: b,
    saved: Math.max(0, a - b),
    percent: a ? Math.round(((a - b) / a) * 100) : 0,
  };
};
