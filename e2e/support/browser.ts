/**
 * Launch options shared by the browser-driven specs.
 *
 * By default Playwright uses the browser build that matches the installed
 * `@playwright/test`. Hosts whose preinstalled Chromium comes from another
 * Playwright release can point MARKETING_ENGINE_CHROMIUM at that executable.
 */
export function chromiumLaunchOptions(): { executablePath?: string } {
  const executablePath = process.env.MARKETING_ENGINE_CHROMIUM;
  return executablePath ? { executablePath } : {};
}
