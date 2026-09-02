const fs = require("fs");

const cssFiles = [
  "styles.css",
  "components.css",
  "reviews.css",
  "cart.css",
  "checkout.css",
  "create-store.css",
  "my-store.css",
  "products.css",
  "add-product.css",
  "store.css",
  "browse-stores.css",
  "discover.css",
  "product-details.css",
  "subscription.css"
];

let errors = 0;

for (const f of cssFiles) {
  const content = fs.readFileSync(f, "utf8");
  let depth = 0;
  let line = 1;
  let inString = null;
  let inComment = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (inComment) {
      if (ch === "*" && content[i + 1] === "/") {
        inComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        i++;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === "/" && content[i + 1] === "*") {
      inComment = true;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }

    if (ch === "\n") {
      line++;
    }

    if (ch === "{") {
      depth++;
    }

    if (ch === "}") {
      depth--;
      if (depth < 0) {
        console.log("ERROR " + f + ":" + line + " - Extra closing brace");
        errors++;
        depth = 0;
        break;
      }
    }
  }

  if (inComment) {
    console.log("ERROR " + f + " - Unclosed comment");
    errors++;
  } else if (inString) {
    console.log("ERROR " + f + " - Unclosed string");
    errors++;
  } else if (depth !== 0) {
    console.log("ERROR " + f + " - Unbalanced braces (depth=" + depth + ")");
    errors++;
  } else {
    console.log("OK: " + f);
  }
}

console.log("\nTotal errors: " + errors);