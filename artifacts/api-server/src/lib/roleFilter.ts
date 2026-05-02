/**
 * Role Filter
 *
 * Strips role-gated fields from inventory items before sending to the client.
 * Server-side enforcement — not a UI hint.
 *
 * Exports:
 *   filterInventoryByRole(items, role) — returns stripped items for the given role
 *
 * Field visibility by role:
 *   owner  → all fields
 *   viewer → hides matrixPrice, cost
 *   guest  → hides matrixPrice, cost, bbAvgWholesale, bbValues; blanks price
 *
 * @example
 * ```ts
 * import { filterInventoryByRole } from "../lib/roleFilter.js";
 *
 * const role = await getUserRole(req) ?? "guest";
 * const items = filterInventoryByRole(getCacheState().data, role);
 * res.json(items);
 * ```
 *
 * Consumers: routes/inventory.ts
 */
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
