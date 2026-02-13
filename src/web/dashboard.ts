/**
 * HTTP route handler for the web dashboard.
 * Serves the self-contained HTML page.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getDashboardHtml } from "./dashboard-html.js";

export function createDashboardHandler() {
  return (_req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(getDashboardHtml());
  };
}
