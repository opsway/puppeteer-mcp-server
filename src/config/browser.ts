import { LaunchOptions } from 'puppeteer';

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

// NPX configuration for local development
export const npxConfig: LaunchOptions = { 
  headless: false,
  args: isRoot ? [...commonArgs, ...sandboxBypassArgs] : commonArgs,
};

// Docker configuration for containerized environment
export const dockerConfig: LaunchOptions = { 
  headless: true, 
  args: [
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
