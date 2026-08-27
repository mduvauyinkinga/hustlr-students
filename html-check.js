const fs = require("fs");

const htmlFiles = [
  "index.html",
  "auth.html",
  "browse-stores.html",
  "cart.html",
  "checkout.html",
  "create-store.html",
  "customer-orders.html",
  "dashboard.html",
  "discover.html",
  "add-product.html",
  "my-store.html",
  "product-details.html",
  "products.html",
  "safety.html",
  "seller-orders.html",
  "store.html"
];

const voidElements = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);

const containerElements = new Set([
  "html", "head", "body", "title", "nav", "div", "section", "header",
  "footer", "main", "article", "aside", "span", "p", "form", "label",
  "select", "textarea", "button", "table", "thead", "tbody",
  "tr", "td", "th", "ul", "ol", "li", "a", "h1", "h2", "h3", "h4",
  "h5", "h6", "picture", "small", "strong", "em", "b", "i", "u",
  "sub", "sup", "blockquote", "code", "pre", "time", "address",
  "figure", "figcaption", "details", "summary",
  "fieldset", "legend", "datalist", "output", "source", "template"
]);

function findTagEnd(content, start) {
  let inQuote = null;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inQuote) {
      if (ch === "\\") i++;
      else if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === ">") return i;
  }
  return -1;
}

let totalErrors = 0;

for (const f of htmlFiles) {
  const content = fs.readFileSync(f, "utf8");
  const stack = [];
  const fileErrors = [];
  let i = 0;

  while (i < content.length) {
    const lt = content.indexOf("<", i);
    if (lt === -1) break;

    // HTML comment
    if (content.startsWith("<!--", lt)) {
      const close = content.indexOf("-->", lt + 4);
      if (close === -1) {
        fileErrors.push("Unclosed HTML comment");
        break;
      }
      i = close + 3;
      continue;
    }

    // Doctype
    if (content.startsWith("<!DOCTYPE", lt) || content.startsWith("<!doctype", lt)) {
      const close = content.indexOf(">", lt);
      if (close === -1) {
        fileErrors.push("Malformed DOCTYPE");
        break;
      }
      i = close + 1;
      continue;
    }

    // Closing tag
    if (content.startsWith("</", lt)) {
      const gt = findTagEnd(content, lt + 2);
      if (gt === -1) {
        fileErrors.push("Unclosed closing tag");
        break;
      }
      const tagName = content.substring(lt + 2, gt).trim().toLowerCase().split(/[\s>]/)[0];
      if (tagName === "script" || tagName === "style") {
        i = gt + 1;
        continue;
      }
      if (!voidElements.has(tagName) && containerElements.has(tagName)) {
        if (stack.length > 0 && stack[stack.length - 1] === tagName) {
          stack.pop();
        } else if (stack.length > 0) {
          // Allow optional closing tags like <p>, <li>, etc. but flag real mismatches
          if (tagName !== "p" && tagName !== "li" && tagName !== "td" && tagName !== "th" && tagName !== "option" && tagName !== "tr") {
            fileErrors.push(`Mismatched closing tag </${tagName}> (expected </${stack[stack.length - 1]}>)`);
          } else {
            // Pop until we find the matching tag
            while (stack.length > 0 && stack[stack.length - 1] !== tagName) {
              stack.pop();
            }
            if (stack.length > 0) stack.pop();
          }
        } else if (tagName !== "p" && tagName !== "li" && tagName !== "td" && tagName !== "th") {
          fileErrors.push(`Unexpected closing tag </${tagName}> with no open tag`);
        }
      }
      i = gt + 1;
      continue;
    }

    // Opening tag
    const gt = findTagEnd(content, lt + 1);
    if (gt === -1) {
      // < may be in text content
      i = lt + 1;
      continue;
    }

    const tagContent = content.substring(lt + 1, gt);
    const match = tagContent.match(/^\s*([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!match) {
      i = lt + 1;
      continue;
    }

    const tagName = match[1].toLowerCase();
    const selfClosing = tagContent.trimEnd().endsWith("/");

    // Special handling for script/style - skip to closing tag
    if (tagName === "script" || tagName === "style") {
      const closeTag = content.indexOf(`</${tagName}>`, gt + 1);
      if (closeTag === -1) {
        fileErrors.push(`Unclosed <${tagName}> tag`);
        break;
      }
      i = closeTag;
      continue;
    }

    if (!voidElements.has(tagName) && !selfClosing && containerElements.has(tagName)) {
      stack.push(tagName);
    }

    i = gt + 1;
  }

  if (stack.length > 0) {
    fileErrors.push(`Unclosed tags at end of file: ${stack.join(", ")}`);
  }

  if (fileErrors.length > 0) {
    totalErrors++;
    console.log("ERROR in " + f + ":");
    for (const msg of fileErrors) {
      console.log("  - " + msg);
    }
  } else {
    console.log("OK: " + f);
  }
}

console.log("\nTotal files with errors: " + totalErrors);