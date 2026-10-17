import { test, expect, call, nodeRunning, goTo } from "../fixtures";

test("the seeded wallet opens on the development chain, funded", async ({ page }) => {
  await nodeRunning(page);
  expect((await call<{ devChain: boolean }>(page, "NodeStatus")).devChain).toBe(true);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("1,000,000").first()).toBeVisible();
  await goTo(page, "Contacts");
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
});
