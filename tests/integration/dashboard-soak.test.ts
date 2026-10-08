import { test } from "node:test";
import assert from "node:assert/strict";
import v8 from "node:v8";
import vm from "node:vm";
import { makeEvent } from "../../lib/dashboard/events.ts";
import { buildViews } from "../../lib/dashboard/routes.ts";
import { startDashboard } from "../../lib/dashboard/server.ts";
import { emptyHost, planned } from "../helpers/dashboard-fixture.ts";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc") as () => void;
const heapMb = (): number => {
  gc();
  gc();
  return process.memoryUsage().heapUsed / 1_048_576;
};

/**
 * A session of 8 hours, run in accelerated time: one simulated minute is one iteration with 12 new events (one every 5 s),
 * a reconnecting live stream, and a refresh of the open section every 10 s (6 reads rotating over every view).
 * What must hold: nothing is left attached when a stream closes, and the memory the process holds grows with the events
 * it stores (the log is the data), not with the number of reads, connections or minutes.
 */
test("an 8 hour session leaves nothing attached and holds memory proportional to the events it stores", async (t) => {
  const { root } = emptyHost();
  planned(root, new Date(), "lothus");
  const server = await startDashboard({ root, pollMs: 10_000 });
  const headers = { authorization: `Bearer ${server.token}` };
  const views = ["/api/clients", ...buildViews().map((v) => v.path)];
  const MINUTES = 480;
  const marks: Array<{ minute: number; heap: number; events: number }> = [];
  let key = 0;
  try {
    const start = Date.now();
    for (let minute = 1; minute <= MINUTES; minute++) {
      server.store.ingest(Array.from({ length: 12 }, () => makeEvent({ source: "soak", key: `k${++key}`, ts: new Date(start - (MINUTES - minute) * 1000).toISOString(), kind: "script_ready", client: "lothus", piece_id: `P-${key % 40}`, data: { attempt: 1 } })));
      for (let r = 0; r < 6; r++) {
        const res = await fetch(`${server.url}${views[(minute * 6 + r) % views.length]}`, { headers });
        assert.equal(res.status, 200);
        await res.arrayBuffer();
      }
      // the live stream drops and reconnects once a minute
      const sse = await fetch(`${server.url}/api/events?lastEventId=${server.store.lastSeq - 5}`, { headers });
      const reader = (sse.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();
      await reader.cancel();
      if (minute % 120 === 0 || minute === 60) marks.push({ minute, heap: heapMb(), events: server.store.size });
    }
    await new Promise((r) => setTimeout(r, 100));
    const health = (await (await fetch(`${server.url}/api/health`, { headers })).json()) as { sse_clients: number };
    assert.equal(health.sse_clients, 0, "every closed stream was released");
    assert.equal(server.store.bus.listenerCount("event"), 1, "only the server listens to the store");
    const [a, b, c] = [marks.find((m) => m.minute === 120)!, marks.find((m) => m.minute === 360)!, marks.find((m) => m.minute === 480)!];
    const perEvent = ((c.heap - a.heap) * 1024) / (c.events - a.events);
    t.diagnostic(`heap at minute 60/120/240/360/480: ${marks.map((m) => `${m.heap.toFixed(1)} MB`).join(" / ")}; events ${marks.map((m) => m.events).join(" / ")}; heap per stored event ${perEvent.toFixed(2)} KB`);
    assert.ok(perEvent < 4, `the heap grew ${perEvent.toFixed(2)} KB per stored event`);
    assert.ok(c.heap - b.heap < (b.heap - a.heap) * 1.5 + 2, "the last 2 hours grow no faster than the 4 before them");
  } finally {
    await server.close();
  }
});
