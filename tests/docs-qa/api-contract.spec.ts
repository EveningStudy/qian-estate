import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../../server/src/app";

// Isolated synthetic database: never mutate the shared development database.
test("demo API scopes data, enforces roles and never enables real locks", async ({
  playwright,
}) => {
  const app = createApp(":memory:");
  let server: Server | undefined;
  const api = await playwright.request.newContext();
  try {
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const health = await api.get(`${base}/health`);
    expect(health.ok()).toBeTruthy();
    expect(await health.json()).toEqual({
      status: "ok",
      demo: true,
      realLocksEnabled: false,
    });
    const anonymous = await (await api.get(`${base}/bootstrap`)).json();
    expect(anonymous.user).toBeNull();
    expect(anonymous.clients).toEqual([]);
    expect(anonymous.messages).toEqual([]);
    expect(anonymous.properties.length).toBeGreaterThan(0);
    expect(
      anonymous.properties.every(
        (p: Record<string, unknown>) => !("ownerId" in p),
      ),
    ).toBe(true);

    const headers: Record<string, { Authorization: string }> = {};
    for (const role of ["owner", "agent", "admin"]) {
      const login = await api.post(`${base}/auth/demo`, { data: { role } });
      expect(login.ok()).toBeTruthy();
      const data = await login.json();
      expect(data.user.role).toBe(role);
      headers[role] = { Authorization: `Bearer ${data.token}` };
    }
    const denied = await api.post(`${base}/clients`, {
      headers: headers.owner,
      data: { name: "QA synthetic" },
    });
    expect(denied.status()).toBe(403);
    const protectedField = await api.put(`${base}/profile`, {
      headers: headers.owner,
      data: { role: "admin" },
    });
    expect(protectedField.status()).toBe(400);
    const payload = {
      propertyId: "property-1",
      reason: "Synthetic QA request, no hardware action",
    };
    const lockHeaders = {
      ...headers.owner,
      "Idempotency-Key": "qa-lock-request",
    };
    const created = await api.post(`${base}/lockRequests`, {
      headers: lockHeaders,
      data: payload,
    });
    expect(created.status()).toBe(201);
    const lock = await created.json();
    const replay = await api.post(`${base}/lockRequests`, {
      headers: lockHeaders,
      data: payload,
    });
    expect((await replay.json()).id).toBe(lock.id);
    expect(replay.headers()["idempotency-replayed"]).toBe("true");
    const approved = await api.patch(`${base}/lockRequests/${lock.id}`, {
      headers: headers.admin,
      data: { status: "approved" },
    });
    expect(approved.status()).toBe(200);
    expect(await approved.json()).toMatchObject({
      status: "approved",
      lockEnabled: false,
      unlockEnabled: false,
      unlocked: false,
    });
    expect(
      (await api.post(`${base}/auth/logout`, { headers: headers.owner })).ok(),
    ).toBeTruthy();
    expect(
      (await api.get(`${base}/bootstrap`, { headers: headers.owner })).status(),
    ).toBe(401);
  } finally {
    await api.dispose();
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    app.locals.close();
  }
});
