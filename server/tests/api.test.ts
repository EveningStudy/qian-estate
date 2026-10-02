import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";

type Role = "owner" | "agent" | "admin";
let app: ReturnType<typeof createApp>;
let server: Server;
let base: string;
const tokens: Record<Role, string> = { owner: "", agent: "", admin: "" };
const previousEnv = process.env.NODE_ENV;

async function request(
  path: string,
  options: {
    role?: Role;
    token?: string;
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    raw?: string;
  } = {},
) {
  const token =
    options.token ?? (options.role ? tokens[options.role] : undefined);
  const response = await fetch(`${base}/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined || options.raw !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
    body:
      options.raw ??
      (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data, headers: response.headers };
}
const post = (
  path: string,
  role: Role,
  body: unknown,
  headers?: Record<string, string>,
) => request(path, { role, method: "POST", body, headers });
const patch = (
  path: string,
  role: Role,
  status: string,
  extras: Record<string, unknown> = {},
) => request(path, { role, method: "PATCH", body: { status, ...extras } });

before(async () => {
  process.env.NODE_ENV = "test";
  app = createApp(":memory:");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const role of ["owner", "agent", "admin"] as const) {
    const result = await request("/auth/demo", {
      method: "POST",
      body: { role },
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.user.role, role);
    assert.match(result.data.token, /^[a-f0-9]{64}$/);
    tokens[role] = result.data.token;
  }
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  app?.locals.close();
  if (previousEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnv;
});

test("anonymous bootstrap is public, complete and excludes all private owner fields", async () => {
  const { status, data } = await request("/bootstrap");
  assert.equal(status, 200);
  assert.equal(data.user, null);
  assert.equal(data.realLocksEnabled, false);
  for (const key of [
    "properties",
    "agents",
    "transactions",
    "faqs",
    "favorites",
    "appointments",
    "commissions",
    "collaborations",
    "clients",
    "messages",
    "feedback",
    "lockRequests",
    "notifications",
    "audit",
  ])
    assert.ok(Array.isArray(data[key]), key);
  assert.ok(data.properties.length >= 3);
  assert.ok(
    data.properties.every((p: any) => ["published", "sold"].includes(p.status)),
  );
  assert.ok(
    data.properties.every(
      (p: any) =>
        !("ownerId" in p) && !("ownerContact" in p) && !("privateNotes" in p),
    ),
  );
  assert.deepEqual(data.messages, []);
  assert.deepEqual(data.transactions, []);
  assert.deepEqual(data.clients, []);
});

test("owner and agent scopes differ; admin cannot read unrelated messages", async () => {
  const owner = (await request("/bootstrap", { role: "owner" })).data;
  const agent = (await request("/bootstrap", { role: "agent" })).data;
  const admin = (await request("/bootstrap", { role: "admin" })).data;
  assert.ok(owner.properties.find((p: any) => p.id === "property-4"));
  assert.ok(!owner.properties.find((p: any) => p.id === "property-6"));
  assert.ok(
    owner.properties.find((p: any) => p.id === "property-1").ownerContact,
  );
  assert.ok(
    !agent.properties.find((p: any) => p.id === "property-1").ownerContact,
  );
  assert.deepEqual(owner.clients, []);
  assert.equal(agent.clients.length, 1);
  assert.ok(owner.transactions.every((t: any) => t.ownerId === "owner-demo"));
  assert.ok(!owner.messages.some((m: any) => m.id === "message-private"));
  assert.deepEqual(admin.messages, []);
  assert.ok(admin.properties.find((p: any) => p.id === "property-6"));
  assert.ok(owner.audit.every((a: any) => a.actorId === "owner-demo"));
});

test("authentication rejects forged, expired and revoked tokens; missing auth cannot mutate", async () => {
  assert.equal(
    (await request("/bootstrap", { token: "owner-demo" })).status,
    401,
  );
  assert.equal(
    (await request("/bootstrap", { token: "a".repeat(64) })).status,
    401,
  );
  assert.equal(
    (await request("/feedback", { method: "POST", body: { content: "hello" } }))
      .status,
    401,
  );
  assert.equal(
    (
      await request("/auth/demo", {
        method: "POST",
        body: { role: "admin", userId: "owner-other" },
      })
    ).status,
    400,
  );
  const login = await request("/auth/demo", {
    method: "POST",
    body: { role: "owner" },
  });
  assert.equal(
    (await request("/auth/logout", { method: "POST", token: login.data.token }))
      .status,
    200,
  );
  assert.equal(
    (await request("/bootstrap", { token: login.data.token })).status,
    401,
  );
  const expiring = await request("/auth/demo", {
    method: "POST",
    body: { role: "owner" },
  });
  const tokenHash = createHash("sha256")
    .update(expiring.data.token)
    .digest("hex");
  assert.equal(
    app.locals.db
      .prepare("SELECT token_hash FROM sessions WHERE token_hash=?")
      .get(expiring.data.token),
    undefined,
  );
  app.locals.db
    .prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?")
    .run(Date.now() - 1, tokenHash);
  assert.equal(
    (await request("/bootstrap", { token: expiring.data.token })).status,
    401,
  );
});

test("production rejects demo login and previously issued demo tokens", async () => {
  process.env.NODE_ENV = "production";
  try {
    const result = await request("/auth/demo", {
      method: "POST",
      body: { role: "admin" },
    });
    assert.equal(result.status, 403);
    assert.equal(result.data.error.code, "DEMO_AUTH_DISABLED");
    assert.equal((await request("/bootstrap", { role: "admin" })).status, 401);
  } finally {
    process.env.NODE_ENV = "test";
  }
});

test("CORS allows loopback only, rejects spoofed hosts and returns structured parsing errors", async () => {
  assert.equal(
    (
      await request("/health", { headers: { Origin: "http://localhost:4311" } })
    ).headers.get("access-control-allow-origin"),
    "http://localhost:4311",
  );
  assert.equal(
    (await request("/health", { headers: { Origin: "http://[::1]:4311" } }))
      .status,
    200,
  );
  for (const origin of [
    "https://evil.example",
    "http://localhost.evil.example",
    "null",
    "file://",
  ]) {
    const response = await request("/health", { headers: { Origin: origin } });
    assert.equal(response.status, 403);
    assert.equal(response.data.error.code, "ORIGIN_DENIED");
  }
  assert.equal(
    (
      await request("/health", {
        method: "OPTIONS",
        headers: { Origin: "http://127.0.0.1:4311" },
      })
    ).status,
    204,
  );
  const malformed = await request("/feedback", {
    method: "POST",
    role: "owner",
    raw: '{"content":',
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.data.error.code, "INVALID_JSON");
  assert.equal(
    (await post("/feedback", "owner", { content: "x".repeat(1_048_576) }))
      .status,
    413,
  );
  assert.equal((await request("/properties/bad%20id")).status, 400);
  assert.equal((await request("/properties/%E0%A4%A")).status, 400);
  assert.equal((await request("/missing")).data.error.code, "NOT_FOUND");
});

test("public detail hides inaccessible listings and SQL-shaped identifiers are rejected", async () => {
  assert.equal((await request("/properties/property-1")).status, 200);
  assert.equal(
    (await request("/properties/property-6", { role: "owner" })).status,
    404,
  );
  assert.equal(
    (await request("/properties/property-6", { role: "agent" })).status,
    404,
  );
  assert.equal(
    (await request("/properties/property-6", { role: "admin" })).status,
    200,
  );
  assert.equal((await request("/properties/does-not-exist")).status, 404);
  assert.equal((await request("/properties/%27%20OR%201%3D1")).status, 400);
});

test("Express serves generated public PNG assets and does not expose source files", async () => {
  const asset = await fetch(`${base}/assets/interior-1.png`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type") ?? "", /image\/png/);
  const bytes = new Uint8Array(await asset.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const source = await fetch(
    `${base}/assets/%2e%2e%2f%2e%2e%2fserver%2fsrc%2fapp.ts`,
  );
  assert.equal(source.status, 404);
  assert.equal((await fetch(`${base}/server/src/app.ts`)).status, 404);
});

test("property creation assigns ownership, rejects mass assignment and enforces admin review", async () => {
  const body = {
    title: "演示新房源",
    community: "测试社区",
    city: "杭州",
    district: "滨江区",
    address: "虚构路1号",
    area: 88,
    price: 300,
    rooms: "3室2厅",
  };
  assert.equal((await post("/properties", "agent", body)).status, 403);
  for (const field of [
    "ownerId",
    "role",
    "status",
    "views",
    "transactionInfo",
    "requesterId",
  ])
    assert.equal(
      (await post("/properties", "owner", { ...body, [field]: "forged" }))
        .status,
      400,
      field,
    );
  assert.equal(
    (
      await post("/properties", "owner", {
        ...body,
        images: ["https://evil.example/a.png"],
      })
    ).status,
    400,
  );
  const created = await post("/properties", "owner", body);
  assert.equal(created.status, 201);
  assert.equal(created.data.ownerId, "owner-demo");
  assert.equal(created.data.status, "pending");
  assert.equal(created.data.images[0], "/assets/interior-1.png");
  assert.ok(created.data.createdAt);
  const path = `/properties/${created.data.id}`;
  assert.equal((await patch(path, "owner", "published")).status, 409);
  assert.equal((await patch(path, "agent", "published")).status, 403);
  assert.equal((await patch(path, "admin", "published")).status, 200);
  const publicRecord = (await request(path)).data;
  assert.equal(publicRecord.privateNotes, undefined);
  assert.equal(publicRecord.customBusinessMetadata, undefined);
  assert.equal((await patch(path, "owner", "sold")).status, 409);
  assert.equal((await patch(path, "admin", "sold")).status, 200);
  assert.equal((await patch(path, "admin", "published")).status, 409);
  assert.equal(
    (await post("/commissions", "owner", { propertyId: created.data.id }))
      .status,
    409,
  );
});

test("commission submission is owner-only, scoped and idempotent across repeated requests", async () => {
  assert.equal(
    (await post("/commissions", "agent", { propertyId: "property-1" })).status,
    403,
  );
  assert.equal(
    (await post("/commissions", "owner", { propertyId: "property-2" })).status,
    403,
  );
  assert.equal(
    (
      await post("/commissions", "owner", {
        propertyId: "property-1",
        agentId: "agent-other",
      })
    ).status,
    400,
  );
  assert.equal((await post("/commissions", "owner", {})).status, 400);
  const body = {
    propertyId: "property-1",
    note: "希望出售",
    phone: "演示号码",
  };
  const headers = { "Idempotency-Key": "commission-create-1" };
  const first = await post("/commissions", "owner", body, headers);
  const repeat = await post(
    "/commissions",
    "owner",
    { phone: "演示号码", note: "希望出售", propertyId: "property-1" },
    headers,
  );
  assert.equal(first.status, 201);
  assert.equal(repeat.data.id, first.data.id);
  assert.equal(repeat.headers.get("idempotency-replayed"), "true");
  assert.equal(
    (await post("/commissions", "owner", { ...body, note: "changed" }, headers))
      .status,
    409,
  );
  const snapshot = (await request("/bootstrap", { role: "owner" })).data;
  assert.equal(
    snapshot.commissions.filter((x: any) => x.id === first.data.id).length,
    1,
  );
  assert.equal(
    snapshot.audit.filter((x: any) => x.recordId === first.data.id).length,
    1,
  );
  assert.equal(
    (await patch(`/commissions/${first.data.id}`, "owner", "accepted")).status,
    409,
  );
  assert.equal(
    (await patch(`/commissions/${first.data.id}`, "agent", "accepted")).status,
    200,
  );
  assert.equal(
    (await patch(`/commissions/${first.data.id}`, "agent", "completed")).status,
    200,
  );
  assert.equal(
    (await patch(`/commissions/${first.data.id}`, "owner", "cancelled")).status,
    409,
  );
  const freeform = await post("/commissions", "owner", {
    community: "新社区",
    area: 90,
    price: 320,
  });
  assert.equal(freeform.status, 201);
  assert.equal(freeform.data.agentId, "agent-demo");
  const simultaneous = await Promise.all(
    Array.from({ length: 4 }, () =>
      post("/commissions", "owner", body, {
        "Idempotency-Key": "commission-concurrent",
      }),
    ),
  );
  assert.ok(simultaneous.every((result) => result.status === 201));
  assert.equal(new Set(simultaneous.map((result) => result.data.id)).size, 1);
});

test("appointments enforce dates, publication, actual assigned agent and valid transitions", async () => {
  const scheduledAt = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(
    (
      await post("/appointments", "owner", {
        propertyId: "property-1",
        scheduledAt: "yesterday",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/appointments", "owner", {
        propertyId: "property-1",
        scheduledAt: "2020-01-01T00:00:00Z",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/appointments", "owner", {
        propertyId: "property-4",
        scheduledAt,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post("/appointments", "owner", {
        propertyId: "property-1",
        scheduledAt,
        agentId: "agent-other",
      })
    ).status,
    400,
  );
  const created = await post("/appointments", "owner", {
    propertyId: "property-1",
    scheduledAt,
  });
  assert.equal(created.status, 201);
  const path = `/appointments/${created.data.id}`;
  assert.equal((await patch(path, "owner", "confirmed")).status, 409);
  assert.equal((await patch(path, "agent", "confirmed")).status, 200);
  assert.equal((await patch(path, "agent", "completed")).status, 200);
  const unrelated = await post("/appointments", "owner", {
    propertyId: "property-2",
    scheduledAt,
  });
  assert.equal(
    (await patch(`/appointments/${unrelated.data.id}`, "agent", "confirmed"))
      .status,
    404,
  );
});

test("collaborations target the other listing agent; clients belong to their creating agent", async () => {
  assert.equal(
    (await post("/collaborations", "owner", { propertyId: "property-2" }))
      .status,
    403,
  );
  assert.equal(
    (await post("/collaborations", "agent", { propertyId: "property-1" }))
      .status,
    400,
  );
  assert.equal(
    (
      await post("/collaborations", "agent", {
        propertyId: "property-2",
        targetAgentId: "agent-demo",
      })
    ).status,
    400,
  );
  const collaboration = await post("/collaborations", "agent", {
    propertyId: "property-2",
    note: "演示合作",
  });
  assert.equal(collaboration.status, 201);
  assert.equal(collaboration.data.agentId, "agent-demo");
  assert.equal(collaboration.data.targetAgentId, "agent-other");
  assert.equal(
    (
      await patch(
        `/collaborations/${collaboration.data.id}`,
        "agent",
        "accepted",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await patch(
        `/collaborations/${collaboration.data.id}`,
        "admin",
        "accepted",
      )
    ).status,
    200,
  );
  assert.equal(
    (await post("/clients", "owner", { name: "Client" })).status,
    403,
  );
  assert.equal(
    (
      await post("/clients", "agent", {
        name: "Client",
        agentId: "agent-other",
      })
    ).status,
    400,
  );
  const client = await post("/clients", "agent", {
    name: "Demo Client",
    budget: 300,
  });
  assert.equal(client.status, 201);
  assert.equal(
    (await patch(`/clients/${client.data.id}`, "owner", "contacted")).status,
    404,
  );
  assert.equal(
    (await patch(`/clients/${client.data.id}`, "agent", "contacted")).status,
    200,
  );
  assert.equal(
    (await patch(`/clients/${client.data.id}`, "agent", "converted")).status,
    200,
  );
});

test("messages are participant-only and only the recipient marks a message as read", async () => {
  const created = await post("/messages", "owner", {
    recipientId: "agent-demo",
    content: "你好，想咨询一下",
    propertyId: "property-1",
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.senderId, "owner-demo");
  assert.equal(
    (await patch(`/messages/${created.data.id}`, "owner", "read")).status,
    403,
  );
  assert.equal(
    (await patch(`/messages/${created.data.id}`, "admin", "read")).status,
    404,
  );
  assert.equal(
    (await patch(`/messages/${created.data.id}`, "agent", "read")).status,
    200,
  );
  assert.equal(
    (
      await post("/messages", "owner", {
        recipientId: "agent-demo",
        content: "x",
        senderId: "admin-demo",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/messages", "owner", {
        recipientId: "owner-other",
        content: "x",
      })
    ).status,
    403,
  );
  assert.equal(
    (await post("/messages", "owner", { recipientId: "missing", content: "x" }))
      .status,
    400,
  );
  const admin = (await request("/bootstrap", { role: "admin" })).data;
  assert.ok(!admin.messages.some((m: any) => m.id === created.data.id));
});

test("feedback and questions require admin resolution, answered FAQ hides submitter identity", async () => {
  const feedback = await post("/feedback", "owner", {
    content: "演示建议",
    category: "产品体验",
  });
  assert.equal(feedback.status, 201);
  assert.equal(
    (await patch(`/feedback/${feedback.data.id}`, "owner", "resolved")).status,
    403,
  );
  assert.equal(
    (await patch(`/feedback/${feedback.data.id}`, "admin", "in_progress"))
      .status,
    200,
  );
  assert.equal(
    (await patch(`/feedback/${feedback.data.id}`, "admin", "resolved")).status,
    200,
  );
  const question = await post("/questions", "owner", {
    question: "可以真实交易吗？",
  });
  const path = `/questions/${question.data.id}`;
  assert.equal((await patch(path, "admin", "answered")).status, 400);
  assert.equal(
    (await patch(path, "owner", "answered", { answer: "伪造答案" })).status,
    403,
  );
  assert.equal(
    (
      await patch(path, "admin", "answered", {
        answer: "不可以，这是虚构演示。",
      })
    ).status,
    200,
  );
  const publicData = (await request("/bootstrap")).data;
  const published = publicData.faqs.find((q: any) => q.id === question.data.id);
  assert.equal(published.answer, "不可以，这是虚构演示。");
  assert.equal(published.userId, undefined);
  assert.deepEqual(publicData.questions, []);
});

test("lock approvals are simulations only, require ownership and never provide unlocking", async () => {
  assert.equal(
    (
      await post("/lockRequests", "owner", {
        propertyId: "property-2",
        reason: "看房",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post("/lockRequests", "agent", {
        propertyId: "property-2",
        reason: "看房",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post("/lockRequests", "agent", {
        propertyId: "property-1",
        reason: "看房",
        unlocked: true,
      })
    ).status,
    400,
  );
  const created = await post("/lockRequests", "agent", {
    propertyId: "property-1",
    reason: "演示看房审批",
  });
  assert.equal(created.status, 201);
  const path = `/lockRequests/${created.data.id}`;
  assert.equal((await patch(path, "agent", "approved")).status, 409);
  const approval = await patch(path, "owner", "approved");
  assert.equal(approval.status, 200);
  for (const flag of ["lockEnabled", "unlockEnabled", "unlocked"])
    assert.equal(approval.data[flag], false);
  assert.equal((await patch(path, "admin", "unlocked")).status, 409);
  assert.equal(
    (
      await request(`/locks/${created.data.id}/unlock`, {
        role: "admin",
        method: "POST",
        body: {},
      })
    ).status,
    404,
  );
  assert.equal((await patch(path, "owner", "revoked")).status, 200);
  const own = await post("/lockRequests", "owner", {
    propertyId: "property-1",
    reason: "演示自有房源",
  });
  assert.equal(
    (await patch(`/lockRequests/${own.data.id}`, "owner", "approved")).status,
    409,
  );
  assert.equal(
    (await patch(`/lockRequests/${own.data.id}`, "admin", "approved")).status,
    200,
  );
});

test("favorites toggle independently by user and replay does not toggle twice", async () => {
  const headers = { "Idempotency-Key": "favorite-1" };
  const added = await post("/favorites/property-1", "owner", {}, headers);
  assert.equal(added.status, 200);
  assert.equal(added.data.favorited, true);
  assert.equal(
    (await post("/favorites/property-1", "owner", {}, headers)).data.favorited,
    true,
  );
  assert.deepEqual(
    (await request("/bootstrap", { role: "agent" })).data.favorites,
    [],
  );
  assert.equal(
    (await post("/favorites/property-1", "owner", {})).data.favorited,
    false,
  );
  assert.equal((await post("/favorites/property-6", "owner", {})).status, 404);
});

test("profile edits cannot change identity and public agent profile never includes private phone", async () => {
  for (const fields of [
    { role: "admin" },
    { userId: "owner-other" },
    { status: "disabled" },
    {},
  ])
    assert.equal(
      (
        await request("/profile", {
          role: "owner",
          method: "PUT",
          body: fields,
        })
      ).status,
      400,
    );
  const updated = await request("/profile", {
    role: "agent",
    method: "PUT",
    body: {
      name: "陈予安（演示）",
      phone: "private-demo-number",
      bio: "演示简介",
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.id, "agent-demo");
  const publicAgent = (await request("/bootstrap")).data.agents.find(
    (a: any) => a.id === "agent-demo",
  );
  assert.equal(publicAgent.name, "陈予安（演示）");
  assert.equal(publicAgent.phone, undefined);
});

test("valuation uses a labeled fixed demo band and validates numeric input", async () => {
  const result = await post("/valuation", "owner", {
    area: 100,
    city: "杭州",
    community: "晴川里",
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.low, 255);
  assert.equal(result.data.high, 345);
  assert.equal(result.data.demo, true);
  assert.equal(result.data.indicativeOnly, true);
  assert.match(result.data.disclaimer, /不是真实/);
  assert.equal(
    (
      await post("/valuation", "owner", {
        area: -5,
        city: "杭州",
        community: "晴川里",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/valuation", "owner", {
        area: "100",
        city: "杭州",
        community: "晴川里",
      })
    ).status,
    400,
  );
});

test("notifications are recipient scoped and unmanaged collections cannot be mutated", async () => {
  assert.equal(
    (await patch("/notifications/notification-owner-demo", "agent", "read"))
      .status,
    404,
  );
  assert.equal(
    (await patch("/notifications/notification-owner-demo", "owner", "read"))
      .status,
    200,
  );
  for (const collection of [
    "transactions",
    "audit",
    "faqs",
    "agents",
    "users",
    "sessions",
    "constructor",
    "toString",
  ])
    assert.equal(
      (await post(`/${collection}`, "admin", {})).status,
      404,
      collection,
    );
  assert.equal(
    (
      await request("/properties/property-1", {
        role: "admin",
        method: "PATCH",
        body: { status: "sold", ownerId: "admin-demo" },
      })
    ).status,
    400,
  );
});

test("SQLite records and idempotency responses persist across reopening without reseeding", () => {
  const directory = mkdtempSync(join(tmpdir(), "qian-estate-server-test-"));
  const path = join(directory, "nested", "data.sqlite");
  let first: ReturnType<typeof createApp> | undefined;
  let second: ReturnType<typeof createApp> | undefined;
  try {
    first = createApp(path);
    const beforeCount = first.locals.db
      .prepare("SELECT COUNT(*) AS count FROM records")
      .get().count;
    const row = first.locals.db
      .prepare("SELECT data FROM users WHERE id=?")
      .get("owner-demo");
    const user = JSON.parse(row.data);
    user.name = "Persistent demo name";
    first.locals.db
      .prepare("UPDATE users SET data=? WHERE id=?")
      .run(JSON.stringify(user), user.id);
    first.locals.db
      .prepare("INSERT INTO idempotency VALUES (?,?,?,?)")
      .run(user.id, "persist-test", "fingerprint", '{"ok":true}');
    first.locals.close();
    first = undefined;
    second = createApp(path);
    assert.equal(
      JSON.parse(
        second.locals.db
          .prepare("SELECT data FROM users WHERE id=?")
          .get(user.id).data,
      ).name,
      "Persistent demo name",
    );
    assert.equal(
      second.locals.db.prepare("SELECT COUNT(*) AS count FROM records").get()
        .count,
      beforeCount,
    );
    assert.equal(
      second.locals.db
        .prepare("SELECT response FROM idempotency WHERE key=?")
        .get("persist-test").response,
      '{"ok":true}',
    );
  } finally {
    first?.locals.close();
    second?.locals.close();
    // Only remove the exact, freshly created test directory after all handles close.
    assert.ok(directory.startsWith(join(tmpdir(), "qian-estate-server-test-")));
    rmSync(directory, { recursive: true, force: true });
  }
});
