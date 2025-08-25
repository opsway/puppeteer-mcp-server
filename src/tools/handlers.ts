import { CallToolResult, TextContent, ImageContent } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../config/logger.js";
import { BrowserState } from "../types/global.js";
import { 
  ensureBrowser, 
  getDebuggerWebSocketUrl, 
  connectToExistingBrowser,
  getCurrentPage 
} from "../browser/connection.js";
import { notifyConsoleUpdate, notifyScreenshotUpdate } from "../resources/handlers.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import path from "path";
import { mkdir, stat, writeFile } from "fs/promises";
import { Buffer } from "buffer";

export async function handleToolCall(
  name: string, 
  args: any, 
  state: BrowserState,
  server: Server
): Promise<CallToolResult> {
  logger.debug('Tool call received', { tool: name, arguments: args });
  const page = await ensureBrowser();

  switch (name) {
    case "puppeteer_connect_active_tab":
      try {
        const wsEndpoint = await getDebuggerWebSocketUrl(args.debugPort);
        const connectedPage = await connectToExistingBrowser(
          wsEndpoint, 
          args.targetUrl,
          (logEntry) => {
            state.consoleLogs.push(logEntry);
            notifyConsoleUpdate(server);
          }
        );
        const url = await connectedPage.url();
        const title = await connectedPage.title();
        return {
          content: [{
            type: "text",
            text: `Successfully connected to browser\nActive webpage: ${title} (${url})`,
          }],
          isError: false,
        };
      } catch (error) {
        const errorMessage = (error as Error).message;
        const isConnectionError = errorMessage.includes('connect to Chrome debugging port') || 
                                errorMessage.includes('Target closed');
        
        return {
          content: [{
            type: "text",
            text: `Failed to connect to browser: ${errorMessage}\n\n` +
                  (isConnectionError ? 
                    "To connect to Chrome:\n" +
                    "1. Close Chrome completely\n" +
                    "2. Reopen Chrome with remote debugging enabled:\n" +
                    "   Windows: chrome.exe --remote-debugging-port=9222\n" +
                    "   Mac: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222\n" +
                    "3. Navigate to your desired webpage\n" +
                    "4. Try the operation again" : 
                    "Please check if Chrome is running and try again.")
          }],
          isError: true,
        };
      }

    case "puppeteer_navigate":
      try {
        logger.info('Navigating to URL', { url: args.url });
        const response = await page.goto(args.url, {
          waitUntil: 'networkidle0',
          timeout: 30000
        });
        
        if (!response) {
          throw new Error('Navigation failed - no response received');
        }

        const status = response.status();
        if (status >= 400) {
          throw new Error(`HTTP error: ${status} ${response.statusText()}`);
        }

        logger.info('Navigation successful', { url: args.url, status });
        return {
          content: [{
            type: "text",
            text: `Successfully navigated to ${args.url} (Status: ${status})`,
          }],
          isError: false,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Navigation failed', { url: args.url, error: errorMessage });
        return {
          content: [{
            type: "text",
            text: `Navigation failed: ${errorMessage}\nThis could be due to:\n- Network connectivity issues\n- Site blocking automated access\n- Page requiring authentication\n- Navigation timeout\n\nTry using a different URL or checking network connectivity.`,
          }],
          isError: true,
        };
      }

    case "puppeteer_screenshot": {
      const width = args.width ?? 800;
      const height = args.height ?? 600;
      await page.setViewport({ width, height });

      const filePathInput: string | undefined = typeof args.filepass === 'string' && args.filepass.trim() ? args.filepass : undefined;
      const baseDir = process.env.GITHUB_WORKSPACE || process.cwd();
      const filePath: string | undefined = filePathInput
        ? (path.isAbsolute(filePathInput) ? filePathInput : path.join(baseDir, filePathInput))
        : undefined;
      if (filePath) {
        const dir = path.dirname(filePath);
        try {
          await mkdir(dir, { recursive: true });
        } catch (e) {
          // ignore mkdir errors; screenshot will fail if path is invalid
        }
      }

      let screenshot: string | undefined;
      try {
        screenshot = await (args.selector ?
          (await page.$(args.selector))?.screenshot(filePath ? { encoding: "base64", path: filePath } : { encoding: "base64" }) :
          page.screenshot(filePath ? { encoding: "base64", fullPage: false, path: filePath } : { encoding: "base64", fullPage: false }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (filePath) {
          const dir = path.dirname(filePath);
          return {
            content: [{
              type: "text",
              text: `Screenshot failed while saving to file\nPath: ${filePath}\nDir: ${dir}\nError: ${msg}\nPossible causes: permission denied, invalid path, or insufficient disk space.`,
            }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Screenshot failed: ${msg}` }],
          isError: true,
        };
      }

      if (!screenshot) {
        return {
          content: [{
            type: "text",
            text: args.selector ? `Element not found: ${args.selector}` : "Screenshot failed",
          }],
          isError: true,
        };
      }

      // Keep resource listing feature by storing base64 in memory regardless of file saving
      state.screenshots.set(args.name, screenshot);
      notifyScreenshotUpdate(server);

      if (filePath) {
        try {
          let st = await stat(filePath);
          if (!st.isFile() || st.size <= 0) {
            // Attempt fallback write from the captured base64
            try {
              await writeFile(filePath, Buffer.from(screenshot, 'base64'));
              st = await stat(filePath);
              if (!st.isFile() || st.size <= 0) {
                return {
                  content: [{
                    type: "text",
                    text: `Screenshot file validation failed after fallback write: ${filePath} ${!st.isFile() ? '(not a regular file)' : '(empty file)'}`,
                  }],
                  isError: true,
                };
              }
            } catch (e2) {
              const msg2 = e2 instanceof Error ? e2.message : String(e2);
              return {
                content: [{
                  type: "text",
                  text: `Screenshot file validation failed and fallback write errored\nPath: ${filePath}\nError: ${msg2}`,
                }],
                isError: true,
              };
            }
          }
        } catch (e) {
          // File missing: attempt to create it from base64 then verify
          try {
            await writeFile(filePath, Buffer.from(screenshot, 'base64'));
          } catch (e2) {
            const msg2 = e2 instanceof Error ? e2.message : String(e2);
            const dir = path.dirname(filePath);
            return {
              content: [{
                type: "text",
                text: `Screenshot reported success but file missing; fallback write failed\nPath: ${filePath}\nDir: ${dir}\nError: ${msg2}`,
              }],
              isError: true,
            };
          }
          // Verify after fallback write
          try {
            const st2 = await stat(filePath);
            if (!st2.isFile() || st2.size <= 0) {
              return {
                content: [{
                  type: "text",
                  text: `Screenshot fallback write produced invalid file: ${filePath} ${!st2.isFile() ? '(not a regular file)' : '(empty file)'}`,
                }],
                isError: true,
              };
            }
          } catch (e3) {
            const msg3 = e3 instanceof Error ? e3.message : String(e3);
            return {
              content: [{
                type: "text",
                text: `Screenshot fallback write verification failed\nPath: ${filePath}\nError: ${msg3}`,
              }],
              isError: true,
            };
          }
        }
        return {
          content: [{ type: "text", text: filePath }],
          isError: false,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Screenshot '${args.name}' taken at ${width}x${height}`,
          } as TextContent,
          {
            type: "image",
            data: screenshot,
            mimeType: "image/png",
          } as ImageContent,
        ],
        isError: false,
      };
    }

    case "puppeteer_click":
      try {
        await page.click(args.selector);
        return {
          content: [{
            type: "text",
            text: `Clicked: ${args.selector}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to click ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case "puppeteer_fill":
      try {
        await page.waitForSelector(args.selector);
        await page.type(args.selector, args.value);
        return {
          content: [{
            type: "text",
            text: `Filled ${args.selector} with: ${args.value}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to fill ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case "puppeteer_select":
      try {
        await page.waitForSelector(args.selector);
        await page.select(args.selector, args.value);
        return {
          content: [{
            type: "text",
            text: `Selected ${args.selector} with: ${args.value}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to select ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case "puppeteer_hover":
      try {
        await page.waitForSelector(args.selector);
        await page.hover(args.selector);
        return {
          content: [{
            type: "text",
            text: `Hovered ${args.selector}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to hover ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case "puppeteer_evaluate":
      try {
        // Set up console listener
        const logs: string[] = [];
        const consoleListener = (message: any) => {
          logs.push(`${message.type()}: ${message.text()}`);
        };
        
        page.on('console', consoleListener);
        
        // Execute script with proper serialization
        logger.debug('Executing script in browser', { scriptLength: args.script.length });
        
        // Wrap the script in a function that returns a serializable result
        const result = await page.evaluate(`(async () => {
          try {
            const result = (function() { ${args.script} })();
            return result;
          } catch (e) {
            console.error('Script execution error:', e.message);
            return { error: e.message };
          }
        })()`);
        
        // Remove the listener to avoid memory leaks
        page.off('console', consoleListener);
        
        logger.debug('Script execution result', {
          resultType: typeof result,
          hasResult: result !== undefined,
          logCount: logs.length
        });

        return {
          content: [{
            type: "text",
            text: `Execution result:\n${JSON.stringify(result, null, 2)}\n\nConsole output:\n${logs.join('\n')}`,
          }],
          isError: false,
        };
      } catch (error) {
        logger.error('Script evaluation failed', { error: error instanceof Error ? error.message : String(error) });
        return {
          content: [{
            type: "text",
            text: `Script execution failed: ${error instanceof Error ? error.message : String(error)}\n\nPossible causes:\n- Syntax error in script\n- Execution timeout\n- Browser security restrictions\n- Serialization issues with complex objects`,
          }],
          isError: true,
        };
      }

    case "puppeteer_get_compact_page_representation":
      try {
        // Default, constant options (arguments are ignored)
        const options = {
          interactiveTags: ["a", "button", "input", "i", "select", "textarea"],
          keepAttrs: ["id", "class", "href", "src", "srcset"],
          stripAttrs: true,
          dropAriaAttrs: true,
          dropDataAttrs: false,
          keepStyle: true,
          pretty: false,
          indent: 2,
          cssHead: true,
          includeIdInHead: true,
          spanAlias: 'span',
          attrMap: true,
          relevantOnly: true,
        } as const;

        const sexpr: string = await page.evaluate((opts: any) => {
          // Build a working clone to avoid modifying the live DOM
          const originalRoot = document.documentElement;
          const root = originalRoot.cloneNode(true) as any;

          const toLowerSet = (arr: any[]) => new Set(arr.map((s: any) => String(s).toLowerCase()));
          const KEEP = toLowerSet(opts.keepAttrs || []);
          const INTER = toLowerSet(opts.interactiveTags || []);

          const REMOVE_TAGS = new Set(["script","style","noscript","template","meta","link","svg","math"]);
          const ALLOWED_HTML_TAGS = new Set([
            "html","head","title","base","link","meta","style","script","noscript","body",
            "section","nav","article","aside","h1","h2","h3","h4","h5","h6","header",
            "footer","address","main","p","hr","pre","blockquote","ol","ul","li","dl","dt",
            "dd","figure","figcaption","div","a","em","strong","small","s","cite","q","dfn",
            "abbr","ruby","rb","rt","rtc","rp","data","time","code","var","samp","kbd",
            "sub","sup","i","b","u","mark","bdi","bdo","span","br","wbr","ins","del",
            "picture","source","img","iframe","embed","object","param","video","audio","track",
            "map","area","table","caption","colgroup","col","tbody","thead","tfoot","tr","td",
            "th","form","label","input","button","select","datalist","optgroup","option","textarea",
            "output","progress","meter","fieldset","legend","details","summary","dialog","slot",
            "template","canvas","menu"
          ]);

          function forEachElement(rootEl: any, cb: (el: any) => void) {
            const all = rootEl.querySelectorAll('*');
            (Array.from(all) as any[]).forEach(cb);
          }

          function removeComments(node: any) {
            const children = Array.from(node.childNodes) as any[];
            for (const child of children) {
              if (child.nodeType === 8 /* COMMENT_NODE */) {
                child.parentNode?.removeChild(child);
              } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
                removeComments(child);
              }
            }
          }

          function parseStyleAttr(styleValue: string) {
            const styles: Record<string, string> = {};
            for (const item of styleValue.split(';')) {
              const idx = item.indexOf(':');
              if (idx !== -1) {
                const k = item.slice(0, idx).trim().toLowerCase();
                const v = item.slice(idx + 1).trim().toLowerCase();
                if (k) styles[k] = v;
              }
            }
            return styles;
          }

          function hasHiddenFlag(el: any): boolean {
            if (el.hasAttribute('hidden')) return true;
            const aria = (el.getAttribute('aria-hidden') || '').trim().toLowerCase();
            if (aria === 'true' || aria === '1' || aria === 'yes') return true;
            if (el.tagName.toLowerCase() === 'input' && (el.getAttribute('type') || '').trim().toLowerCase() === 'hidden') return true;
            const style = el.getAttribute('style') || '';
            if (style) {
              const s = parseStyleAttr(style);
              const disp = s['display'];
              if (disp && disp.includes('none')) return true;
              const vis = s['visibility'];
              if (vis && vis.includes('hidden')) return true;
              const op = s['opacity'];
              if (op != null && op.trim().startsWith('0')) return true;
            }
            return false;
          }

          // 1) Remove comments
          removeComments(root);

          // 2) Remove known non-content tags entirely
          for (const tag of REMOVE_TAGS) {
            root.querySelectorAll(tag).forEach((t: any) => t.parentElement?.removeChild(t));
          }

          // 3) Remove namespaced tags (with ':')
          forEachElement(root, (el) => {
            const name = el.tagName.toLowerCase();
            if (name.includes(':')) {
              el.parentElement?.removeChild(el);
            }
          });

          // 4) Unwrap custom/non-standard elements to preserve their children
          forEachElement(root, (el) => {
            const name = el.tagName.toLowerCase();
            if (!ALLOWED_HTML_TAGS.has(name)) {
              const parent = el.parentElement;
              if (!parent) return;
              while (el.firstChild) parent.insertBefore(el.firstChild, el);
              parent.removeChild(el);
            }
          });

          // 5) Strip base64 data URIs from <img src/srcset>
          root.querySelectorAll('img').forEach((img: any) => {
            const src = img.getAttribute('src');
            if (src && src.trim().toLowerCase().startsWith('data:')) {
              img.setAttribute('src', '');
            }
            const srcset = img.getAttribute('srcset');
            if (srcset && srcset.toLowerCase().includes('data:')) {
              const parts = srcset.split(',').map((p: string) => p.trim());
              const filtered = parts.filter((p: string) => !p.toLowerCase().startsWith('data:'));
              img.setAttribute('srcset', filtered.join(', '));
            }
          });

          // 6) Prune hidden subtrees (self or by ancestors)
          (function pruneHidden(node: any, hiddenUpstream: boolean) {
            const children = Array.from(node.children) as any[];
            for (const child of children) {
              const hidden = hiddenUpstream || hasHiddenFlag(child);
              if (hidden) {
                child.parentElement?.removeChild(child);
              } else {
                pruneHidden(child, hidden);
              }
            }
          })(root, false);

          // 7) Optional attribute stripping
          if (opts.stripAttrs) {
            const tagAllow: Record<string, Set<string>> = {
              'a': new Set(['href']),
              'img': new Set(['src','srcset']),
              'input': new Set(['type','name','value','checked','disabled','placeholder']),
              'label': new Set(['for']),
              'button': new Set(['type','name','value','disabled']),
              'select': new Set(['name','disabled','multiple']),
              'option': new Set(['value','selected','disabled']),
              'textarea': new Set(['name','disabled','placeholder']),
              'form': new Set([]),
              'iframe': new Set(['src']),
            };

            forEachElement(root, (el: any) => {
              const allowed = new Set([...(KEEP || new Set<string>())]);
              const tag = el.tagName.toLowerCase();
              const extra = tagAllow[tag];
              if (extra) extra.forEach(a => allowed.add(a));
              const names = el.getAttributeNames();
              for (const attr of names) {
                const al = attr.toLowerCase();
                if (al.startsWith('on')) { el.removeAttribute(attr); continue; }
                if (al === 'style' && !opts.keepStyle) { el.removeAttribute(attr); continue; }
                if (allowed.has(al)) continue;
                if (!opts.dropDataAttrs && al.startsWith('data-')) continue;
                if (!opts.dropAriaAttrs && al.startsWith('aria-')) continue;
                el.removeAttribute(attr);
              }
            });
          }

          // 8) Prune DOM to relevant-only if requested
          if (opts.relevantOnly) {
            const interSelector = Array.from(INTER).join(',');

            function hasDirectText(el: any): boolean {
              for (const n of Array.from(el.childNodes) as any[]) {
                if (n.nodeType === 3 /* TEXT_NODE */ && (n.textContent || '').trim()) return true;
              }
              return false;
            }

            function shouldKeep(el: any): boolean {
              const name = el.tagName.toLowerCase();
              if (INTER.has(name)) return true;
              if ((el.getAttribute('id') || '').trim()) return true;
              if (hasDirectText(el)) return true;
              if (interSelector && (el as any).querySelector(interSelector)) return true;
              return false;
            }

            function prune(node: any): boolean {
              // Process children first
              for (const child of Array.from(node.children) as any[]) {
                const keepChild = prune(child);
                if (!keepChild) child.parentElement?.removeChild(child);
              }
              // Drop whitespace-only text nodes
              for (const t of Array.from(node.childNodes) as any[]) {
                if (t.nodeType === 3 /* TEXT_NODE */ && !(t.textContent || '').trim()) {
                  t.parentNode?.removeChild(t);
                }
              }
              const name = node.tagName.toLowerCase();
              if (name === 'html' || name === 'body') return true;
              return shouldKeep(node);
            }

            const top = root; // root is <html>
            prune(top as any);
          }

          // 9) Serialize to S-expression
          const keepAttrs = KEEP.size ? KEEP : new Set(["id","class","name","href","src","srcset","for","value","type","role"]);

          function q(s: string): string {
            return '"' + s.replace(/\\/g, "\\\\").replace(/\"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
          }

          function normText(s: string): string {
            return s.split(/\s+/).filter(Boolean).join(' ');
          }

          function attrItems(el: any): Array<[string,string]> {
            const acc: Array<[string,string]> = [];
            for (const attr of el.getAttributeNames()) {
              const k = attr.toLowerCase();
              if (opts.cssHead && k === 'class') continue;
              if (opts.cssHead && opts.includeIdInHead && k === 'id' && (el.getAttribute('id') || '').trim()) continue;
              if (!keepAttrs.has(k)) continue;
              let v = el.getAttribute(attr);
              if (k === 'class') v = (el as any).className || v || '';
              acc.push([k, v ?? '']);
            }
            acc.sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
            return acc;
          }

          function headToken(el: any): string {
            if (!opts.cssHead) return el.tagName.toLowerCase();
            const name = el.tagName.toLowerCase();
            let base = '';
            if (name === 'div') base = '';
            else if (name === 'span') base = opts.spanAlias || 'sp';
            else base = name;
            let token = base;
            const id = (el.getAttribute('id') || '').trim();
            const cls = ((el as any).className || '').trim();
            if (opts.includeIdInHead && id) token += `#${id}`;
            if (cls) token += cls.split(/\s+/).filter(Boolean).map((c: string) => `.${c}`).join('');
            if (!token) token = 'div';
            return token;
          }

          function emit(node: any, depth: number): string {
            if (node.nodeType === 3 /* TEXT_NODE */) {
              const txt = normText(node.textContent || '');
              if (!txt.trim()) return '';
              return opts.pretty ? ' '.repeat(opts.indent * depth) + q(txt) : q(txt);
            }
            if (node.nodeType === 1 /* ELEMENT_NODE */) {
              const el = node as any;
              let out = opts.pretty ? ' '.repeat(opts.indent * depth) + '(' + headToken(el) : '(' + headToken(el);
              const attrs = attrItems(el);
              if (opts.attrMap && attrs.length) {
                const amap = '{' + attrs.map(([k,v]) => `:${k} ${q(v)}`).join(' ') + '}';
                out += ' ' + amap;
              } else {
                for (const [k,v] of attrs) out += ` :${k} ${q(v)}`;
              }
              const frags: string[] = [];
              for (const child of Array.from(el.childNodes)) {
                const frag = emit(child, depth + 1);
                if (frag) frags.push(frag);
              }
              if (!frags.length) return out + ')';
              if (opts.pretty) return out + '\n' + frags.join('\n') + '\n' + ' '.repeat(opts.indent * depth) + ')';
              return out + ' ' + frags.join(' ') + ')';
            }
            return '';
          }

          const topEl = root as any; // <html>
          return emit(topEl, 0);
        }, options);

        return {
          content: [{
            type: 'text',
            text: sexpr,
          }],
          isError: false,
        };
      } catch (error) {
        logger.error('Failed to generate compact page representation', { error: error instanceof Error ? error.message : String(error) });
        return {
          content: [{
            type: 'text',
            text: `Failed to generate compact representation: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }

    default:
      return {
        content: [{
          type: "text",
          text: `Unknown tool: ${name}`,
        }],
        isError: true,
      };
  }
}
