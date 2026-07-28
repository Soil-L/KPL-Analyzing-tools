import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the KPL tactical analysis prototype", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>战术罗盘｜KPL 对局空间分析<\/title>/i);
  assert.match(html, /KPL SPATIAL LAB/);
  assert.match(html, /导入轨迹数据/);
  assert.match(html, /预测分析/);
});

test("keeps the prototype data contract and metadata discoverable", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /time, team, role, player, x, y/);
  assert.match(page, /type Role =/);
  assert.match(page, /"positions" \| "forecast"/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /战术罗盘｜KPL 对局空间分析/);
  assert.match(packageJson, /"name": "kpl-tactical-compass"/);
});
