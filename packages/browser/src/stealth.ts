/**
 * Browser stealth techniques to avoid bot detection.
 *
 * Uses fingerprint-injector (from Apify's fingerprint-suite) for statistically
 * realistic browser fingerprint rotation, combined with supplemental stealth
 * techniques for ChromeDriver cleanup and chrome.runtime faking.
 */

import type { Browser, BrowserContext, Page } from "playwright-core"

/**
 * Supplemental stealth script that covers areas fingerprint-injector doesn't:
 * - ChromeDriver variable cleanup (window.cdc_*)
 * - chrome.runtime fake
 * - console.debug puppeteer filtering
 * - Function.prototype.toString patching
 */
const SUPPLEMENTAL_STEALTH_SCRIPT = `
// Hide webdriver property
Object.defineProperty(navigator, 'webdriver', {
  get: () => undefined,
  configurable: true
});

// Remove automation-related properties from navigator
delete navigator.__proto__.webdriver;

// Fix permissions API to not leak automation
if (navigator.permissions) {
  const originalQuery = navigator.permissions.query;
  navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );
}

// Hide automation indicators in window (ChromeDriver variables)
delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

// Override chrome runtime to appear normal
if (window.chrome) {
  window.chrome.runtime = {
    PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
    PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
    PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
    RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
    OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }
  };
}

// Fix console.debug to not reveal automation
const originalDebug = console.debug;
console.debug = function(...args) {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('puppeteer')) {
    return;
  }
  return originalDebug.apply(console, args);
};

// Override Function.prototype.toString for stealth
const originalFunctionToString = Function.prototype.toString;
Function.prototype.toString = function() {
  if (this === navigator.permissions.query) {
    return 'function query() { [native code] }';
  }
  return originalFunctionToString.call(this);
};
`

/**
 * Create a new browser context with realistic, randomized fingerprints.
 *
 * Uses fingerprint-injector to generate statistically realistic browser
 * fingerprints (UA, viewport, WebGL, etc.) that vary per session, then
 * applies supplemental stealth scripts for ChromeDriver cleanup.
 */
export async function createStealthContext(
  browser: Browser,
  options?: { timezoneId?: string; locale?: string }
): Promise<BrowserContext> {
  const { newInjectedContext } = await import("fingerprint-injector")

  const context = await newInjectedContext(browser, {
    fingerprintOptions: {
      devices: ["desktop"],
      operatingSystems: ["macos", "windows", "linux"],
      browsers: [{ name: "chrome", minVersion: 125 }],
      locales: [options?.locale ?? "en-US"],
    },
    newContextOptions: {
      timezoneId: options?.timezoneId ?? "America/New_York",
      locale: options?.locale ?? "en-US",
    },
  })

  await context.addInitScript(SUPPLEMENTAL_STEALTH_SCRIPT)

  return context
}

/**
 * Apply stealth techniques to an existing browser context.
 * Use createStealthContext() for new contexts when possible.
 */
export async function applyStealthToContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(SUPPLEMENTAL_STEALTH_SCRIPT)
}

/**
 * Apply stealth techniques to a single page.
 */
export async function applyStealthToPage(page: Page): Promise<void> {
  await page.addInitScript(SUPPLEMENTAL_STEALTH_SCRIPT)
}

/**
 * Get browser launch arguments for stealth mode.
 */
export function getStealthLaunchArgs(): string[] {
  return [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--disable-infobars",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--window-position=0,0",
    "--ignore-certificate-errors",
    "--ignore-certificate-errors-spki-list",
    "--disable-features=IsolateOrigins,site-per-process",
    "--flag-switches-begin",
    "--flag-switches-end",
    "--disable-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-gpu",
    "--disable-extensions",
  ]
}
