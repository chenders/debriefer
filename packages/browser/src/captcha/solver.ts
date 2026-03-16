/**
 * CAPTCHA solving service integration.
 *
 * Supports:
 * - 2Captcha (https://2captcha.com)
 * - CapSolver (https://capsolver.com)
 *
 * Typical costs:
 * - reCAPTCHA v2: ~$0.003 per solve
 * - reCAPTCHA v3: ~$0.003 per solve
 * - hCaptcha: ~$0.003 per solve
 */

import type { Page } from "playwright-core"

import type {
  CaptchaDetectionResult,
  CaptchaSolveResult,
  CaptchaSolverConfig,
  CaptchaType,
} from "../types.js"

const TWOCAPTCHA_API = {
  submit: "https://2captcha.com/in.php",
  result: "https://2captcha.com/res.php",
}

const CAPSOLVER_API = {
  createTask: "https://api.capsolver.com/createTask",
  getTaskResult: "https://api.capsolver.com/getTaskResult",
}

const POLL_INTERVAL_MS = 5000
const INITIAL_WAIT_MS = 10000
const DEFAULT_TIMEOUT_MS = 120000
const DEFAULT_MAX_COST = 0.01

/** Resolve optional config fields to concrete values. */
function resolveConfig(config: CaptchaSolverConfig): Required<CaptchaSolverConfig> {
  return {
    provider: config.provider,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxCostPerSolve: config.maxCostPerSolve ?? DEFAULT_MAX_COST,
  }
}

const CAPTCHA_COSTS: Record<CaptchaType, number> = {
  recaptcha_v2: 0.003,
  recaptcha_v3: 0.003,
  hcaptcha: 0.003,
  perimeterx: 0.005,
  datadome: 0.003,
  unknown: 0.005,
}

async function submit2Captcha(
  config: Required<CaptchaSolverConfig>,
  type: CaptchaType,
  siteKey: string,
  pageUrl: string
): Promise<string> {
  const params = new URLSearchParams({
    key: config.apiKey,
    method: type === "hcaptcha" ? "hcaptcha" : "userrecaptcha",
    ...(type === "hcaptcha" ? { sitekey: siteKey } : { googlekey: siteKey }),
    pageurl: pageUrl,
    json: "1",
  })

  if (type === "recaptcha_v3") {
    params.append("version", "v3")
    params.append("action", "verify")
    params.append("min_score", "0.3")
  }

  const response = await fetch(`${TWOCAPTCHA_API.submit}?${params}`, {
    signal: AbortSignal.timeout(30000),
  })
  const data = (await response.json()) as { status: number; request: string }

  if (data.status !== 1) {
    throw new Error(`2Captcha submission failed: ${data.request}`)
  }

  return data.request
}

async function submit2CaptchaDataDome(
  config: Required<CaptchaSolverConfig>,
  captchaUrl: string,
  pageUrl: string,
  userAgent: string
): Promise<string> {
  const params = new URLSearchParams({
    key: config.apiKey,
    method: "datadome",
    captcha_url: captchaUrl,
    pageurl: pageUrl,
    userAgent: userAgent,
    json: "1",
  })

  const response = await fetch(`${TWOCAPTCHA_API.submit}?${params}`, {
    signal: AbortSignal.timeout(30000),
  })
  const data = (await response.json()) as { status: number; request: string }

  if (data.status !== 1) {
    throw new Error(`2Captcha DataDome submission failed: ${data.request}`)
  }

  return data.request
}

async function poll2Captcha(
  config: Required<CaptchaSolverConfig>,
  taskId: string,
  startTime: number
): Promise<string> {
  const params = new URLSearchParams({
    key: config.apiKey,
    action: "get",
    id: taskId,
    json: "1",
  })

  while (Date.now() - startTime < config.timeoutMs) {
    const response = await fetch(`${TWOCAPTCHA_API.result}?${params}`, {
      signal: AbortSignal.timeout(30000),
    })
    const data = (await response.json()) as { status: number; request: string }

    if (data.status === 1) {
      return data.request
    }

    if (data.request !== "CAPCHA_NOT_READY") {
      throw new Error(`2Captcha solving failed: ${data.request}`)
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  throw new Error("2Captcha solving timed out")
}

async function submitCapSolver(
  config: Required<CaptchaSolverConfig>,
  type: CaptchaType,
  siteKey: string,
  pageUrl: string
): Promise<string> {
  const taskType =
    type === "hcaptcha"
      ? "HCaptchaTaskProxyLess"
      : type === "recaptcha_v3"
        ? "ReCaptchaV3TaskProxyLess"
        : "ReCaptchaV2TaskProxyLess"

  const task: Record<string, unknown> = {
    type: taskType,
    websiteURL: pageUrl,
    websiteKey: siteKey,
  }

  if (type === "recaptcha_v3") {
    task.pageAction = "verify"
    task.minScore = 0.3
  }

  const response = await fetch(CAPSOLVER_API.createTask, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: config.apiKey, task }),
    signal: AbortSignal.timeout(30000),
  })

  const data = (await response.json()) as {
    errorId: number
    errorDescription?: string
    taskId?: string
  }

  if (data.errorId !== 0 || !data.taskId) {
    throw new Error(`CapSolver submission failed: ${data.errorDescription || "Unknown error"}`)
  }

  return data.taskId
}

async function pollCapSolver(
  config: Required<CaptchaSolverConfig>,
  taskId: string,
  startTime: number
): Promise<string> {
  while (Date.now() - startTime < config.timeoutMs) {
    const response = await fetch(CAPSOLVER_API.getTaskResult, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: config.apiKey, taskId }),
      signal: AbortSignal.timeout(30000),
    })

    const data = (await response.json()) as {
      errorId: number
      errorDescription?: string
      status: string
      solution?: { gRecaptchaResponse?: string; token?: string }
    }

    if (data.errorId !== 0) {
      throw new Error(`CapSolver polling failed: ${data.errorDescription || "Unknown error"}`)
    }

    if (data.status === "ready" && data.solution) {
      return data.solution.gRecaptchaResponse || data.solution.token || ""
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  throw new Error("CapSolver solving timed out")
}

/**
 * Inject a solved CAPTCHA token into the page.
 */
export async function injectCaptchaToken(
  page: Page,
  token: string,
  type: CaptchaType
): Promise<void> {
  await page.evaluate(
    ({ token, type }) => {
      const win = window as unknown as Record<string, unknown>

      const responseSelectors = [
        "#g-recaptcha-response",
        'textarea[name="g-recaptcha-response"]',
        ".g-recaptcha-response",
        "#h-captcha-response",
        'textarea[name="h-captcha-response"]',
        ".h-captcha-response",
      ]

      for (const selector of responseSelectors) {
        const textarea = document.querySelector(selector) as HTMLTextAreaElement | null
        if (textarea) {
          textarea.style.display = "block"
          textarea.style.visibility = "visible"
          textarea.value = token
          textarea.dispatchEvent(new Event("input", { bubbles: true }))
          textarea.dispatchEvent(new Event("change", { bubbles: true }))
          break
        }
      }

      if (type === "recaptcha_v2" || type === "recaptcha_v3") {
        const grecaptcha = win.grecaptcha as { getResponse?: () => string } | undefined
        if (typeof grecaptcha !== "undefined" && grecaptcha?.getResponse) {
          try {
            const recaptchaDiv = document.querySelector("[data-callback]")
            const callbackName = recaptchaDiv?.getAttribute("data-callback")
            if (callbackName && typeof win[callbackName] === "function") {
              ;(win[callbackName] as (t: string) => void)(token)
            }
          } catch {
            // Callback invocation failed, form submission should still work
          }
        }
      } else if (type === "hcaptcha") {
        if (typeof win.hcaptcha !== "undefined") {
          try {
            const hcaptchaDiv = document.querySelector("[data-callback]")
            const callbackName = hcaptchaDiv?.getAttribute("data-callback")
            if (callbackName && typeof win[callbackName] === "function") {
              ;(win[callbackName] as (t: string) => void)(token)
            }
          } catch {
            // Callback invocation failed
          }
        }
      }
    },
    { token, type }
  )
}

/**
 * Solve a CAPTCHA using the configured solving service.
 */
export async function solveCaptcha(
  page: Page,
  detection: CaptchaDetectionResult,
  config: CaptchaSolverConfig
): Promise<CaptchaSolveResult> {
  const resolved = resolveConfig(config)
  const startTime = Date.now()
  const type = detection.type || "unknown"
  const estimatedCost = CAPTCHA_COSTS[type]

  if (estimatedCost > resolved.maxCostPerSolve) {
    return {
      success: false,
      token: null,
      type,
      costUsd: 0,
      solveTimeMs: Date.now() - startTime,
      error: `CAPTCHA cost ($${estimatedCost}) exceeds limit ($${resolved.maxCostPerSolve})`,
    }
  }

  const pageUrl = page.url()

  if (type === "datadome") {
    return solveDataDome(page, detection, resolved, pageUrl, startTime, estimatedCost)
  }

  if (!detection.siteKey) {
    return {
      success: false,
      token: null,
      type,
      costUsd: 0,
      solveTimeMs: Date.now() - startTime,
      error: "No site key found for CAPTCHA",
    }
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, INITIAL_WAIT_MS))

    let token: string

    if (resolved.provider === "2captcha") {
      const taskId = await submit2Captcha(resolved, type, detection.siteKey, pageUrl)
      token = await poll2Captcha(resolved, taskId, startTime)
    } else {
      const taskId = await submitCapSolver(resolved, type, detection.siteKey, pageUrl)
      token = await pollCapSolver(resolved, taskId, startTime)
    }

    await injectCaptchaToken(page, token, type)

    return {
      success: true,
      token,
      type,
      costUsd: estimatedCost,
      solveTimeMs: Date.now() - startTime,
    }
  } catch (error) {
    return {
      success: false,
      token: null,
      type,
      costUsd: 0,
      solveTimeMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

async function solveDataDome(
  page: Page,
  detection: CaptchaDetectionResult,
  config: Required<CaptchaSolverConfig>,
  pageUrl: string,
  startTime: number,
  estimatedCost: number
): Promise<CaptchaSolveResult> {
  if (!detection.datadomeUrl) {
    return {
      success: false,
      token: null,
      type: "datadome",
      costUsd: 0,
      solveTimeMs: Date.now() - startTime,
      error: "No DataDome captcha URL found",
    }
  }

  if (config.provider !== "2captcha") {
    return {
      success: false,
      token: null,
      type: "datadome",
      costUsd: 0,
      solveTimeMs: Date.now() - startTime,
      error: "DataDome solving only supported via 2captcha provider",
    }
  }

  try {
    const userAgent = await page.evaluate(() => navigator.userAgent)

    await new Promise((resolve) => setTimeout(resolve, INITIAL_WAIT_MS))

    const taskId = await submit2CaptchaDataDome(config, detection.datadomeUrl, pageUrl, userAgent)
    const cookieValue = await poll2Captcha(config, taskId, startTime)

    const url = new URL(pageUrl)
    await page.context().addCookies([
      {
        name: "datadome",
        value: cookieValue,
        domain: url.hostname,
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      },
    ])

    return {
      success: true,
      token: cookieValue,
      type: "datadome",
      costUsd: estimatedCost,
      solveTimeMs: Date.now() - startTime,
    }
  } catch (error) {
    return {
      success: false,
      token: null,
      type: "datadome",
      costUsd: 0,
      solveTimeMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

/**
 * Check the balance of the solving service account.
 */
export async function getBalance(config: CaptchaSolverConfig): Promise<number> {
  const resolved = resolveConfig(config)
  if (resolved.provider === "2captcha") {
    const params = new URLSearchParams({
      key: config.apiKey,
      action: "getbalance",
      json: "1",
    })

    const response = await fetch(`${TWOCAPTCHA_API.result}?${params}`, {
      signal: AbortSignal.timeout(30000),
    })
    const data = (await response.json()) as { status: number; request: string }

    if (data.status !== 1) {
      throw new Error(`Failed to get 2Captcha balance: ${data.request}`)
    }

    return parseFloat(data.request)
  } else {
    const response = await fetch("https://api.capsolver.com/getBalance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: config.apiKey }),
      signal: AbortSignal.timeout(30000),
    })

    const data = (await response.json()) as {
      errorId: number
      balance?: number
      errorDescription?: string
    }

    if (data.errorId !== 0) {
      throw new Error(`Failed to get CapSolver balance: ${data.errorDescription}`)
    }

    return data.balance || 0
  }
}
