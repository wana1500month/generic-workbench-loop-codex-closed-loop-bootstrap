const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const targetStateDir = process.argv[2];
const manifestPath = process.argv[3];

if (!targetStateDir || !manifestPath) {
  console.error("Usage: node target-server.cjs <target-state-dir> <manifest-path>");
  process.exit(1);
}

const markerPath = path.join(targetStateDir, "run_target.txt");
const latestItemPath = path.join(targetStateDir, "latest-item.json");
const semanticModePath = path.join(targetStateDir, "semantic-mode.txt");

const currentMode = () =>
  fs.existsSync(semanticModePath) ? fs.readFileSync(semanticModePath, "utf8").trim() : "truth";

const familyForMode = (mode) =>
  mode.startsWith("chat-")
    ? "chat"
    : mode.startsWith("browser-")
      ? "browser"
      : mode.startsWith("fullstack-")
        ? "fullstack"
    : mode.startsWith("editor-")
      ? "editor"
      : mode.startsWith("dashboard-")
        ? "dashboard"
        : "api";

const isBlockedMode = (mode) => mode.endsWith("-blocked");

const writeBlockedResponse = (res, family) => {
  res.writeHead(451, { "content-type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      error: "ERR_BLOCKED_BY_ADMINISTRATOR",
      status: "blocked",
      family
    })
  );
};

const readLatestItem = () => {
  if (!fs.existsSync(latestItemPath)) {
    return {
      id: "missing-item",
      title: "Missing Item",
      status: "missing"
    };
  }

  return JSON.parse(fs.readFileSync(latestItemPath, "utf8"));
};

const renderShell = (url) => {
  const mode = currentMode();
  const family = familyForMode(mode);
  const marker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8").trim() : "missing";
  const latestItem = readLatestItem();
  const isInvalidFixture = url.includes("fixture=invalid");

  if (family === "editor") {
    return `<!doctype html><html><body><main data-testid="app-shell" data-app-shell="ready"><h1>semantic editor ${marker}</h1>${isInvalidFixture ? "<section data-testid=\"error-banner\">invalid editor flow</section>" : "<section data-testid=\"editor-canvas\">canvas ready</section><button data-testid=\"undo-button\">Undo</button><button data-testid=\"redo-button\">Redo</button><span data-testid=\"selection-indicator\">selection ready</span>"}</main></body></html>`;
  }

  if (family === "dashboard") {
    return `<!doctype html><html><body><main data-testid="app-shell" data-app-shell="ready"><h1>semantic dashboard ${marker}</h1><section data-testid="dashboard-grid">metrics grid ready</section><p data-testid="item-title">${latestItem.title}</p></main></body></html>`;
  }

  if (family === "browser") {
    return `<!doctype html><html><body><main data-testid="app-shell" data-app-shell="ready"><h1>semantic browser ${marker}</h1>${isInvalidFixture ? "<section data-testid=\"error-banner\">invalid browser flow</section>" : "<section data-testid=\"composer\">composer ready</section><p data-testid=\"draft-state\">draft persisted</p>"}</main></body></html>`;
  }

  if (family === "fullstack") {
    return `<!doctype html><html><body><main data-testid="app-shell" data-app-shell="ready"><h1>semantic fullstack ${marker}</h1><p data-testid="item-title">${latestItem.title}</p><p data-testid="session-state">session persisted</p></main></body></html>`;
  }

  return `<!doctype html><html><body><main data-testid="app-shell" data-app-shell="ready"><h1>semantic shell ${marker}</h1><p data-testid="item-title">${latestItem.title}</p></main></body></html>`;
};

const inactivityWindowMs = 30_000;
let shutdownTimer;
const refreshShutdown = () => {
  clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => {
    server.close(() => process.exit(0));
  }, inactivityWindowMs);
};

const server = http.createServer((req, res) => {
  refreshShutdown();
  const mode = currentMode();
  const family = familyForMode(mode);

  if (req.url === "/healthz") {
    const marker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8").trim() : "missing";
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ready", marker, family }));
    return;
  }

  if (req.url === "/api/items/latest") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(readLatestItem()));
    return;
  }

  if (req.url === "/api/items/invalid") {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "invalid_title", status: "rejected" }));
    return;
  }

  if (req.url === "/api/items/summary") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        status: mode === "contradictory" ? "missing" : "consistent"
      })
    );
    return;
  }

  if (req.url === "/api/items/idempotent") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        status: mode === "contradictory" ? "missing" : "idempotent"
      })
    );
    return;
  }

  if (req.url === "/api/items/stale") {
    res.writeHead(409, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "stale_write",
        status: mode === "contradictory" ? "missing" : "stale_rejected"
      })
    );
    return;
  }

  if (req.url === "/api/items/pagination") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        status: mode === "contradictory" ? "missing" : "stable"
      })
    );
    return;
  }

  if (req.url === "/api/conversations/latest") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        grounded: mode === "contradictory" ? false : true,
        status: mode === "contradictory" ? "missing" : "grounded"
      })
    );
    return;
  }

  if (req.url === "/api/conversations/invalid-tool") {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "tool_rejected", status: "rejected" }));
    return;
  }

  if (req.url === "/api/conversations/memory") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        status: mode === "contradictory" ? "missing" : "preserved"
      })
    );
    return;
  }

  if (req.url === "/api/conversations/unsafe-tool") {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "unsafe_tool_blocked",
        status: "blocked"
      })
    );
    return;
  }

  if (req.url === "/api/conversations/refusal") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        status: mode === "contradictory" ? "missing" : "safe_refusal"
      })
    );
    return;
  }

  if (req.url === "/api/conversations/tool-trace") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        status: mode === "contradictory" ? "missing" : "persisted"
      })
    );
    return;
  }

  if (req.url === "/api/browser/summary") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ shell: "visible", status: "ready" }));
    return;
  }

  if (req.url === "/api/browser/invalid") {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "invalid_form", status: "rejected" }));
    return;
  }

  if (req.url === "/api/browser/draft") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "persisted" }));
    return;
  }

  if (req.url === "/api/browser/navigation") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "preserved" }));
    return;
  }

  if (req.url === "/api/browser/refresh") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "persisted" }));
    return;
  }

  if (req.url === "/api/browser/draft-restore") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "restored" }));
    return;
  }

  if (req.url === "/api/browser/submit") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "consistent" }));
    return;
  }

  if (req.url === "/api/fullstack/shell") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ shell: "visible", status: "ready" }));
    return;
  }

  if (req.url === "/api/fullstack/session") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "persisted" }));
    return;
  }

  if (req.url === "/api/fullstack/roundtrip") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "consistent" }));
    return;
  }

  if (req.url === "/api/fullstack/refresh") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "persisted" }));
    return;
  }

  if (req.url === "/api/fullstack/retry") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "recovered" }));
    return;
  }

  if (req.url === "/api/fullstack/audit") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "recorded" }));
    return;
  }

  if (req.url === "/api/fullstack/audit-refresh") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "consistent" }));
    return;
  }

  if (req.url === "/api/metrics/summary") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        status: mode === "contradictory" ? "missing" : "ready"
      })
    );
    return;
  }

  if (req.url === "/api/metrics/summary?filter=invalid") {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "invalid_filter", status: "rejected" }));
    return;
  }

  if (req.url === "/api/editor/summary") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ shell: "visible", status: "ready" }));
    return;
  }

  if (req.url === "/api/editor/invalid") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "invalid_editor_flow", status: "rejected" }));
    return;
  }

  if (req.url === "/api/editor/undo") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "available" }));
    return;
  }

  if (req.url === "/api/editor/redo") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "available" }));
    return;
  }

  if (req.url === "/api/editor/selection") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "preserved" }));
    return;
  }

  if (req.url === "/api/editor/autosave") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "persisted" }));
    return;
  }

  if (req.url === "/api/editor/restore") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "restored" }));
    return;
  }

  if (req.url === "/api/editor/invalid-selection") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "invalid_selection", status: "blocked" }));
    return;
  }

  if (req.url === "/api/editor/selection-recovery") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "recovered" }));
    return;
  }

  if (req.url === "/api/dashboard/shell") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ shell: "visible", status: "ready" }));
    return;
  }

  if (req.url === "/api/dashboard/metrics") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "consistent" }));
    return;
  }

  if (req.url === "/api/dashboard/invalid-filter") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "invalid_filter", status: "rejected" }));
    return;
  }

  if (req.url === "/api/dashboard/time-range") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "consistent" }));
    return;
  }

  if (req.url === "/api/dashboard/filter") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "persisted" }));
    return;
  }

  if (req.url === "/api/dashboard/filter-reset") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "restored" }));
    return;
  }

  if (req.url === "/api/dashboard/aggregation") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "correct" }));
    return;
  }

  if (req.url === "/api/dashboard/drilldown") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "continuous" }));
    return;
  }

  if (req.url === "/api/dashboard/drilldown-refresh") {
    if (isBlockedMode(mode)) {
      writeBlockedResponse(res, family);
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "preserved" }));
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(renderShell(req.url ?? "/"));
});

server.listen(0, "127.0.0.1", () => {
  refreshShutdown();
  const address = server.address();
  if (!address || typeof address === "string") {
    console.error("Failed to resolve server address.");
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        health_url: `http://127.0.0.1:${address.port}/healthz`,
        app_url: `http://127.0.0.1:${address.port}/`,
        api_base_url: `http://127.0.0.1:${address.port}/api/`
      },
      null,
      2
    )
  );
});
