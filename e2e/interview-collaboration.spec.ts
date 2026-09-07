import { expect, test } from "@playwright/test";

test("candidate canvas changes appear for the interviewer", async ({ browser, baseURL }) => {
  test.skip(!baseURL, "E2E_BASE_URL or Playwright baseURL is required");

  const interviewerContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const interviewer = await interviewerContext.newPage();

  const loginResponse = interviewer.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/token") && response.request().method() === "POST",
  );
  await interviewer.goto("/");
  await expect(interviewer.getByRole("heading", { name: "Interview sessions" })).toBeVisible();
  expect((await loginResponse).ok()).toBeTruthy();

  const uniqueTitle = `Playwright collaboration ${Date.now()}`;
  await interviewer.getByRole("link", { name: "New session" }).click();
  await interviewer.getByLabel("Session title").fill(uniqueTitle);
  await interviewer
    .getByLabel("Prompt given to the candidate")
    .fill("Design a globally distributed event processing system with durable delivery.");
  await interviewer.getByLabel("Candidate name").fill("Playwright Candidate");
  await interviewer.getByLabel("Candidate email").fill("candidate@example.com");
  await interviewer.getByRole("button", { name: "Create session & invite link" }).click();
  await expect(interviewer).toHaveURL(/\/sessions\/[^?]+\?role=interviewer/);
  await expect(interviewer.getByRole("heading", { name: uniqueTitle })).toBeVisible();

  await interviewer.getByRole("button", { name: "Copy invite" }).click();
  await expect(interviewer.getByRole("status")).toContainText("Invite link copied");
  const joinLink = await interviewer.evaluate(() => navigator.clipboard.readText());
  expect(joinLink).toMatch(new RegExp(`^${baseURL}/join/`));

  const candidateContext = await browser.newContext();
  const candidate = await candidateContext.newPage();
  await candidate.goto(joinLink);
  await expect(candidate.getByRole("heading", { name: uniqueTitle })).toBeVisible();
  await candidate.getByRole("button", { name: "Enter lobby" }).click();
  await expect(candidate.getByRole("button", { name: "Waiting for interviewer…" })).toBeDisabled();

  await interviewer.getByRole("button", { name: "Start session" }).click();
  await expect(interviewer.getByText("Live", { exact: true })).toBeVisible();
  await expect(candidate.getByRole("button", { name: "Join canvas" })).toBeEnabled();
  await candidate.getByRole("button", { name: "Join canvas" }).click();
  await expect(candidate.getByText("You can edit the canvas")).toBeVisible();

  await candidate.getByRole("button", { name: "Database", exact: true }).click();
  await expect(candidate.getByTestId("canvas-node").filter({ hasText: "Database" })).toBeVisible();
  await expect(interviewer.getByTestId("canvas-node").filter({ hasText: "Database" })).toBeVisible({
    timeout: 10_000,
  });

  await candidateContext.close();
  await interviewerContext.close();
});
