import type { InventoryItem } from "./inventoryCache.js";
import type { UserRole } from "./auth.js";

/**
 * Strip inventory fields based on user role.
 * Owner sees everything; viewer hides cost/matrixPrice; guest additionally hides
 * BB values and price.
 */
export function filterInventoryByRole(
  items: InventoryItem[],
  role: UserRole,
): Partial<InventoryItem>[] {
  return items.map((item) => {
    if (role === "owner") return item;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { matrixPrice, cost, ...rest } = item;
    if (role === "viewer") return rest;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { bbAvgWholesale, bbValues, ...guestRest } = rest;
    return { ...guestRest, price: "" };
  });
}
