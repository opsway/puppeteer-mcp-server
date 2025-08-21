import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  {
    name: "puppeteer_connect_active_tab",
    description: "Connect to an existing Chrome instance with remote debugging enabled",
    inputSchema: {
      type: "object",
      properties: {
        targetUrl: { 
          type: "string", 
          description: "Optional URL of the target tab to connect to. If not provided, connects to the first available tab." 
        },
        debugPort: {
          type: "number",
          description: "Optional Chrome debugging port (default: 9222)",
          default: 9222
        }
      },
      required: [],
    },
  },
  {
    name: "puppeteer_navigate",
    description: "Navigate to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: "puppeteer_screenshot",
    description: "Take a screenshot of the current page or a specific element",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the screenshot" },
        selector: { type: "string", description: "CSS selector for element to screenshot" },
        width: { type: "number", description: "Width in pixels (default: 800)" },
        height: { type: "number", description: "Height in pixels (default: 600)" },
        filepass: { type: "string", description: "Optional file path to save PNG. If provided, the tool save the screenshot to the file instead of returning raw image data." },
      },
      required: ["name"],
    },
  },
  {
    name: "puppeteer_click",
    description: "Click an element on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to click" },
      },
      required: ["selector"],
    },
  },
  {
    name: "puppeteer_fill",
    description: "Fill out an input field",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for input field" },
        value: { type: "string", description: "Value to fill" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "puppeteer_select",
    description: "Select an element on the page with Select tag",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to select" },
        value: { type: "string", description: "Value to select" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "puppeteer_hover",
    description: "Hover an element on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to hover" },
      },
      required: ["selector"],
    },
  },
  {
    name: "puppeteer_evaluate",
    description: "Execute JavaScript in the browser console",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "JavaScript code to execute" },
      },
      required: ["script"],
    },
  },
  {
    name: "puppeteer_get_compact_page_representation",
    description: "Produce a compact S-expression of the current page designed to help build CSS selectors and understand the page's structure and content. The output: (1) keeps only visible nodes; (2) prioritizes interactive elements (a, button, input, select, textarea, i), elements with ids or direct text, and the minimal containers linking them; (3) removes hidden/non-HTML/non-content tags and noisy attributes. Each element is serialized with a CSS-like head token that includes #id and .classes, plus a minimal attribute map and quoted text children. The default tag is 'div' (omitted in the head unless needed)",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];
