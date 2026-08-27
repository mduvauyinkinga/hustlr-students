/**
 * Cart Module — client-side localStorage cart.
 *
 * Format:
 * {
 *   storeId: "",
 *   storeName: "",
 *   items: [
 *     {
 *       productId: "",
 *       name: "",
 *       price: 0,
 *       imageURL: "",
 *       quantity: 1
 *     }
 *   ]
 * }
 */

const CART_KEY = "hustlr_cart";

const EMPTY_CART = {
  storeId: "",
  storeName: "",
  items: []
};

/**
 * Read the current cart from localStorage.
 * Returns a valid cart object (never null).
 */
export function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return { ...EMPTY_CART, items: [] };
    const parsed = JSON.parse(raw);
    // Ensure structure is valid
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_CART, items: [] };
    return {
      storeId: String(parsed.storeId || ""),
      storeName: String(parsed.storeName || ""),
      items: Array.isArray(parsed.items) ? parsed.items : []
    };
  } catch {
    return { ...EMPTY_CART, items: [] };
  }
}

/**
 * Persist cart to localStorage.
 */
export function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {
    // silently fail (storage full or unavailable)
  }
}

/**
 * Remove cart from localStorage entirely.
 */
export function clearCart() {
  try {
    localStorage.removeItem(CART_KEY);
  } catch {
    // silently fail
  }
}

/**
 * Add a product to the cart.
 *
 * @param {Object} product - Product data from Firestore
 * @param {string} storeId
 * @param {string} storeName
 * @returns {{ success: boolean, conflict: boolean }}
 *   - success: true if item was added/quantity increased
 *   - conflict: true if items from another store exist (caller must handle)
 */
export function addToCart(product, storeId, storeName) {
  const cart = getCart();

  // If cart has items from a different store — flag conflict
  if (cart.items.length > 0 && cart.storeId !== storeId) {
    return { success: false, conflict: true };
  }

  // Normalise price
  const price = Number(product.price) || 0;

  // Check if product already exists in cart
  const existing = cart.items.find((item) => item.productId === product.productId);

  if (existing) {
    existing.quantity += 1;
  } else {
    cart.items.push({
      productId: String(product.productId || product.id || ""),
      name: String(product.name || "Unnamed Product"),
      price: price,
      imageURL: String(product.imageURL || ""),
      quantity: 1
    });
  }

  // Ensure store info is set
  cart.storeId = storeId;
  cart.storeName = storeName;

  saveCart(cart);
  return { success: true, conflict: false };
}

/**
 * Remove a specific item from the cart by productId.
 */
export function removeFromCart(productId) {
  const cart = getCart();
  cart.items = cart.items.filter((item) => item.productId !== productId);

  // If last item removed, reset store info
  if (cart.items.length === 0) {
    cart.storeId = "";
    cart.storeName = "";
  }

  saveCart(cart);
  return cart;
}

/**
 * Update quantity for a product.
 * If quantity drops to 0 or below, the item is removed.
 */
export function updateQuantity(productId, newQuantity) {
  const cart = getCart();
  const item = cart.items.find((i) => i.productId === productId);
  if (!item) return cart;

  const qty = Math.max(0, Math.floor(Number(newQuantity) || 0));
  if (qty <= 0) {
    return removeFromCart(productId);
  }

  item.quantity = qty;
  saveCart(cart);
  return cart;
}

/**
 * Return total number of items (sum of quantities).
 */
export function getItemCount() {
  const cart = getCart();
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * Format a price value to a currency string.
 * Always returns format: R250.00
 * Strips any existing R prefix or formatting characters before display.
 */
export function formatPrice(price) {
  const cleaned = String(price ?? "")
    .replace(/[\sRr]+/g, "")
    .replace(/[^\d.-]/g, "");

  const num = Number(cleaned);
  if (isNaN(num)) return "R0.00";
  return num.toFixed(2);
}

/**
 * Calculate the total price for all items in cart.
 */
export function getCartTotal(cart) {
  if (!cart || !cart.items) return 0;
  return cart.items.reduce((sum, item) => {
    return sum + (Number(item.price) || 0) * (Number(item.quantity) || 0);
  }, 0);
}

