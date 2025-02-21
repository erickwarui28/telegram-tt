import { IS_EMOJI_SUPPORTED } from "./windowEnvironment";
import { ApiMessageEntityTypes } from '../api/types';
import { ensureProtocol } from './ensureProtocol';

interface ASTNode {
  type: string;
  text?: string;
  lang?: string;
  alt?: string;
  id?: string;
  href?: string;
  children?: ASTNode[];
}

export function parseMarkdown(input: string, options?: { withMarkdownLinks?: boolean }): string {
  const withMarkdownLinks = options?.withMarkdownLinks;

  let normalized = input
    .replace(/&nbsp;/g, " ")
    .replace(/<div><br([^>]*)?><\/div>/g, "\n")
    .replace(/<br([^>]*)?>/g, "\n")
    .replace(/<\/div>(\s*)<div>/g, "\n")
    .replace(/<div>/g, "\n")
    .replace(/<\/div>/g, "");

  const ast = parseMarkdownAST(normalized, { withMarkdownLinks: withMarkdownLinks });
  return astToHtml(ast, { emojiSupported: IS_EMOJI_SUPPORTED });
}

/**
 *   - Code blocks: ```lang\ncode content\n```
 *   - Inline code: `code`
 *   - Bold: **text**
 *   - Italic: __text__
 *   - Strikethrough: ~~text~~
 *   - Spoiler: ||text||
 *   - Links: [text](url)  (if url starts with "customEmoji:" then treat as emoji)
 */
function parseMarkdownAST(input: string, options?: { withMarkdownLinks?: boolean }): ASTNode[] {
  const withMarkdownLinks = options?.withMarkdownLinks;
  let pos = 0;

  function parseNodes(stopTokens: string[] = []): ASTNode[] {
    const nodes: ASTNode[] = [];
    if (nodes.length >= Number.MAX_SAFE_INTEGER) {
      return nodes;
    }
    while (pos < input.length) {
      if (stopTokens.some((token) => input.startsWith(token, pos))) {
        break;
      }

      if (input[pos] === '<') {
        const endIndex = input.indexOf('>', pos);
        if (endIndex !== -1) {
          const potentialHtml = input.slice(pos, endIndex + 1);
          if (/^<\/?[a-z][\s\S]*>$/i.test(potentialHtml)) {
            nodes.push({ type: "raw", text: potentialHtml });
            pos = endIndex + 1;
            continue;
          }
        }
      }

      if (input.startsWith("```", pos)) {
        pos += 3;
        let lang = "";
        const newlineIndex = input.indexOf("\n", pos);
        if (newlineIndex !== -1) {
          lang = input.slice(pos, newlineIndex).trim();
          pos = newlineIndex + 1;
        }
        const endCode = input.indexOf("```", pos);
        const codeContent =
          endCode === -1 ? input.slice(pos) : input.slice(pos, endCode);
        nodes.push({ type: "code_block", lang, text: codeContent });
        pos = endCode === -1 ? input.length : endCode + 3;
        continue;
      }

      if (input.startsWith("`", pos)) {
        pos++;
        const endCode = input.indexOf("`", pos);
        const codeContent =
          endCode === -1 ? input.slice(pos) : input.slice(pos, endCode);
        nodes.push({ type: "code", text: codeContent });
        pos = endCode === -1 ? input.length : endCode + 1;
        continue;
      }

      if (input.startsWith("**", pos)) {
        pos += 2;
        const children = parseNodes(["**"]);
        if (input.startsWith("**", pos)) {
          pos += 2;
        }
        nodes.push({ type: "bold", children });
        continue;
      }

      if (input.startsWith("__", pos)) {
        pos += 2;
        const children = parseNodes(["__"]);
        if (input.startsWith("__", pos)) {
          pos += 2;
        }
        nodes.push({ type: "italic", children });
        continue;
      }

      if (input.startsWith("~~", pos)) {
        pos += 2;
        const children = parseNodes(["~~"]);
        if (input.startsWith("~~", pos)) {
          pos += 2;
        }
        nodes.push({ type: "strikethrough", children });
        continue;
      }

      if (input.startsWith("||", pos)) {
        pos += 2;
        const children = parseNodes(["||"]);
        if (input.startsWith("||", pos)) {
          pos += 2;
        }
        nodes.push({ type: "spoiler", children });
        continue;
      }

      if (input.startsWith("[", pos)) {
        const closingBracket = input.indexOf("]", pos);
        if (closingBracket !== -1 && input[closingBracket + 1] === "(") {
          const closingParen = input.indexOf(")", closingBracket + 2);
          if (closingParen !== -1) {
            const textContent = input.slice(pos + 1, closingBracket);
            const link = input.slice(closingBracket + 2, closingParen);
            if (link.startsWith("customEmoji:")) {
              const id = link.slice("customEmoji:".length);
              nodes.push({ type: "emoji", alt: textContent, id });
            } else {
              if(withMarkdownLinks){
                  nodes.push({ type: "link", href: normalizeUrl(link), text: textContent });
              } else {
                  nodes.push({ type: "link", href: link, text: textContent });
              }
            }
            pos = closingParen + 1;
            continue;
          }
        }
      }

      const specialTokens = [
        "```",
        "`",
        "**",
        "__",
        "~~",
        "||",
        "[",
        ...stopTokens,
      ];
      let nextPos = input.length;
      for (const token of specialTokens) {
        const idx = input.indexOf(token, pos);
        if (idx !== -1 && idx < nextPos) {
          nextPos = idx;
        }
      }
      if (nextPos === pos) {
        nextPos = pos + 1;
      }
      const text = input.slice(pos, nextPos);
      nodes.push({ type: "text", text });
      pos = nextPos;
    }
    return nodes;
  }

  return parseNodes();
}

function astToHtml(
  nodes: ASTNode[],
  options?: { emojiSupported?: boolean }
): string {
  const emojiSupported = options?.emojiSupported !== false;
  let html = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        html += (node.text || "");
        break;
      case "code":
        html += `<code>${(node.text || "")}</code>`;
        break;
      case "raw":
        html += node.text || "";
        break;
      case "code_block":
        if (node.lang) {
          html += `<pre data-language="${escapeHtml(node.lang)}">${(
            node.text || ""
          )}</pre>`;
        } else {
          html += `<pre>${(node.text || "")}</pre>`;
        }
        break;
      case "bold":
        html += `<b>${astToHtml(node.children || [], {
          emojiSupported: IS_EMOJI_SUPPORTED,
        })}</b>`;
        break;
      case "italic":
        html += `<i>${astToHtml(node.children || [], {
          emojiSupported: IS_EMOJI_SUPPORTED,
        })}</i>`;
        break;
      case "strikethrough":
        html += `<s>${astToHtml(node.children || [], {
          emojiSupported: IS_EMOJI_SUPPORTED,
        })}</s>`;
        break;
      case "spoiler":
        html += `<span data-entity-type="${ApiMessageEntityTypes.Spoiler}">${astToHtml(
          node.children || [],
          { emojiSupported: IS_EMOJI_SUPPORTED }
        )}</span>`;
        break;
      case "link":
        const formattedLinkUrl = (ensureProtocol(node.href || "") || '').split('%').map(encodeURI).join('%');
        html += `<a href=${formattedLinkUrl} class="text-entity-link" dir="auto">${node.text || ""}</a>`;
        break;
      case "emoji":
        if (emojiSupported) {
          html += `<img alt="${escapeHtml(
            node.alt || ""
          )}" data-document-id="${escapeHtml(node.id || "")}">`;
        } else {
          html += `[${(node.alt || "")}]`;
        }
        break;
      default:
        html += (node.text || "");
    }
  }
  return html;
}
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeUrl(link: string): string {
  if (link.includes("://")) {
    return link;
  } else if (link.includes("@")) {
    return `mailto:${link}`;
  }
  return `https://${link}`;
}