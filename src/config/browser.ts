import { LaunchOptions } from 'puppeteer';
import { logger } from './logger.js';

// Common browser arguments for both NPX and Docker environments
const commonArgs = [
  "--disable-web-security",  // Bypass CORS
  "--disable-features=IsolateOrigins,site-per-process", // Disable site isolation
  "--disable-site-isolation-trials",
  "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" // Modern Chrome UA
];

// Additional flags required when running as root (Chromium sandbox cannot start)
const sandboxBypassArgs = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
];

// Detect root user (Linux)
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

// Detect CI or headless server environment (no X server)
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const hasDisplay = !!process.env.DISPLAY;
const headlessInNpx = isCI || !hasDisplay;

// NPX configuration for local/CI environments
const npxArgs = isRoot ? [...commonArgs, ...sandboxBypassArgs] : [...commonArgs];
if (headlessInNpx) {
  // Extra flags helpful in CI/headless linux
  npxArgs.unshift("--headless=new");
  npxArgs.push("--disable-dev-shm-usage", "--disable-gpu");
  // Only add --no-zygote when sandbox is disabled to avoid Chrome error
  if (isRoot || isCI) {
    if (npxArgs.indexOf("--no-sandbox") === -1) {
      npxArgs.push(...sandboxBypassArgs);
    }
    npxArgs.push("--no-zygote");
  }
}
export const npxConfig: LaunchOptions = { 
  headless: headlessInNpx,
  args: npxArgs,
};

logger.debug('Resolved Puppeteer NPX config', { headless: npxConfig.headless, args: npxConfig.args, isRoot, isCI, hasDisplay });

// Docker configuration for containerized environment
export const dockerConfig: LaunchOptions = { 
  headless: true, 
  args: [
    "--headless=new",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--single-process",
    "--no-zygote",
    ...commonArgs,
  ],
};

// Default navigation timeout in milliseconds
export const DEFAULT_NAVIGATION_TIMEOUT = 30000;

// Default debugging port for Chrome
export const DEFAULT_DEBUG_PORT = 9222;
