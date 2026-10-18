import type { Page } from "@playwright/test";
import { test, expect, call, goTo, FUNDED, OTHER, expectClipboard } from "../fixtures";

const MESSAGE = "I control this address. 2026-10-17";

/** Fills the Verify page's form. */
async function fillVerify(page: Page, v: { address: string; message: string; signature: string }) {
  const main = page.getByRole("main");
  await main.getByLabel("Message").fill(v.message);
  await main.getByLabel("Address").fill(v.address);
  await main.getByLabel("Signature").fill(v.signature);
}

test.describe("messages", () => {
  test("a message signed is shared, then verifies as the account's", { tag: "@clipboard" }, async ({ app, page }) => {
    await goTo(page, "Sign message");
    const main = page.getByRole("main");
    await expect(main.getByText("Before you sign")).toBeVisible();
    const sign = main.getByRole("button", { name: "Sign message" });
    await expect(sign).toBeDisabled();

    await main.getByLabel("Message").fill(MESSAGE);
    await expect(main.getByText(`${MESSAGE.length} / 1024 bytes`)).toBeVisible();
    await expect(main.getByLabel("Signing as")).toContainText(FUNDED.name);
    await sign.click();

    // The wallet is unlocked: no password asked, the signature at once
    await expect(main.getByRole("heading", { name: "Message signed" })).toBeVisible();
    await expect(main.getByText(FUNDED.address, { exact: true })).toBeVisible();
    await expect(main.getByText(MESSAGE, { exact: true })).toBeVisible();
    const signature = (await main.getByText(/^0x[0-9a-f]{130}$/).textContent())!;

    // Copied alone (the address's, the signature's, then all of it), and as the block to share
    await main.getByRole("button", { name: "Copy" }).nth(1).click();
    await expectClipboard(app, signature);
    await main.getByRole("button", { name: "Copy" }).last().click();
    await expectClipboard(app, `Address: ${FUNDED.address}\nMessage:\n${MESSAGE}\nSignature: ${signature}`);
    // What was signed is what the backend checks as signed
    expect(await call(page, "MessageVerify", FUNDED.address, MESSAGE, signature)).toEqual({
      valid: true,
      recovered: FUNDED.address,
    });

    await goTo(page, "Verify message");
    await fillVerify(page, { address: FUNDED.address, message: MESSAGE, signature });
    // The address is one of the wallet's, said by name as it's typed
    await expect(main.getByText(`This is ${FUNDED.name}.`)).toBeVisible();
    await main.getByRole("button", { name: "Verify" }).click();
    await expect(main.getByRole("heading", { name: "Valid signature" })).toBeVisible();
    await expect(main.getByText("This message was signed by")).toBeVisible();
    await expect(main.getByText(FUNDED.name, { exact: true })).toBeVisible();
  });

  test("Sign another starts over", async ({ page }) => {
    await goTo(page, "Sign message");
    const main = page.getByRole("main");
    await main.getByLabel("Message").fill(MESSAGE);
    await main.getByRole("button", { name: "Sign message" }).click();
    await main.getByRole("button", { name: "Sign another" }).click();
    await expect(main.getByLabel("Message")).toHaveValue("");
    await expect(main.getByRole("button", { name: "Sign message" })).toBeDisabled();
  });

  test("a message too long or with a control character can't be signed", async ({ page }) => {
    await goTo(page, "Sign message");
    const main = page.getByRole("main");
    const sign = main.getByRole("button", { name: "Sign message" });

    await main.getByLabel("Message").fill("x".repeat(1025));
    await expect(main.getByText("1025 / 1024 bytes")).toBeVisible();
    await expect(main.getByRole("alert")).toHaveText("A message can be at most 1024 bytes.");
    await expect(sign).toBeDisabled();

    // Bytes, not characters: 512 two-byte letters fill it exactly
    await main.getByLabel("Message").fill("é".repeat(512));
    await expect(main.getByText("1024 / 1024 bytes")).toBeVisible();
    await expect(sign).toBeEnabled();

    await main.getByLabel("Message").fill("ring the bell\u0007");
    await expect(main.getByRole("alert")).toHaveText(
      "The message has a control character. Only line breaks and tabs are allowed.",
    );
    await expect(sign).toBeDisabled();

    await main.getByLabel("Message").fill("line one\n\tline two");
    await expect(main.getByRole("alert")).toHaveCount(0);
    await expect(sign).toBeEnabled();
  });

  test("a changed message, or another address, isn't signed by it", async ({ page }) => {
    const { signature } = await call<{ signature: string }>(page, "MessageSign", FUNDED.address, MESSAGE);
    await goTo(page, "Verify message");
    const main = page.getByRole("main");

    // The message changed: signed by someone, not by this address
    await fillVerify(page, { address: FUNDED.address, message: MESSAGE + "!", signature });
    await main.getByRole("button", { name: "Verify" }).click();
    await expect(main.getByRole("heading", { name: "Not signed by this address" })).toBeVisible();
    await expect(main.getByText(/This signature isn't from 0x7E5F/)).toBeVisible();

    // Back keeps what was typed
    await main.getByRole("button", { name: "Back" }).click();
    await expect(main.getByLabel("Message")).toHaveValue(MESSAGE + "!");
    await expect(main.getByLabel("Signature")).toHaveValue(signature);

    // The right message said to be another's: it names who did sign it
    await fillVerify(page, { address: OTHER.address, message: MESSAGE, signature });
    await main.getByRole("button", { name: "Verify" }).click();
    await expect(main.getByRole("heading", { name: "Not signed by this address" })).toBeVisible();
    await expect(main.getByText(/This signature isn't from 0x2B5A/)).toBeVisible();
    await expect(main.getByText(FUNDED.name, { exact: true })).toBeVisible();

    // Verify another clears the form
    await main.getByRole("button", { name: "Verify another" }).click();
    await expect(main.getByLabel("Message")).toHaveValue("");
    await expect(main.getByLabel("Address")).toHaveValue("");
    await expect(main.getByLabel("Signature")).toHaveValue("");
  });

  test("a malformed signature or address is refused", async ({ page }) => {
    await goTo(page, "Verify message");
    const main = page.getByRole("main");
    const verify = main.getByRole("button", { name: "Verify" });
    await expect(verify).toBeDisabled();

    await fillVerify(page, { address: "0x1234", message: MESSAGE, signature: "0xdeadbeef" });
    await expect(main.getByText("That isn't a valid address.")).toBeVisible();
    await expect(verify).toBeDisabled();

    await main.getByLabel("Address").fill(FUNDED.address);
    await verify.click();
    await expect(main.getByText("Couldn't verify")).toBeVisible();
    await expect(main.getByText("That isn't a valid signature.")).toBeVisible();
    await expect(main.getByRole("heading", { name: "Valid signature" })).toHaveCount(0);
  });
});
