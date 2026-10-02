import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  createObjectKey,
  createObjectStorage,
  loadObjectStorageConfig,
  ObjectStorageError,
  OBJECT_MAX_BYTES,
  OBJECT_PREFIX,
  type ObjectStorageConfigInput,
  type ObjectStorageOptions,
} from "../src/object-storage.js";

// 使用 SDK 真实序列化与签名，在 HTTP 传输边界 mock；不连接真实桶、不上传真实对象。
const config: ObjectStorageConfigInput = {
  endpoint: "https://storage.example",
  region: "us-east-1",
  bucket: "private-test-bucket",
  accessKeyId: "TESTKEYID",
  secretAccessKey: "TESTSECRETKEY",
  forcePathStyle: true,
  nodeEnv: "test",
};
const png = () =>
  readFileSync(new URL("../../public/assets/interior-1.png", import.meta.url));
const hasCode = (code: string) => (error: unknown) =>
  error instanceof ObjectStorageError &&
  error.code === code &&
  /[\u4e00-\u9fff]/.test(error.message);
type CapturedRequest = {
  method: string;
  path: string;
  hostname: string;
  protocol: string;
  headers: Record<string, string>;
  body?: unknown;
};
function mockHandler(statusCode = 200) {
  const requests: CapturedRequest[] = [];
  const handler: ObjectStorageOptions["requestHandler"] = {
    async handle(request: CapturedRequest) {
      requests.push(request as CapturedRequest);
      return {
        response: {
          statusCode,
          headers:
            statusCode === 200
              ? { etag: '"test-etag"' }
              : { "content-type": "application/xml" },
          body: Buffer.from(
            statusCode === 200
              ? ""
              : "<Error><Code>PreconditionFailed</Code><Message>私密信息</Message></Error>",
          ),
        },
      };
    },
  };
  return { requests, handler };
}

test("未配置不创建 SDK 请求，状态明确未真实联调", async () => {
  assert.equal(loadObjectStorageConfig({}), undefined);
  const mock = mockHandler();
  const storage = createObjectStorage(loadObjectStorageConfig({}), {
    requestHandler: mock.handler,
  });
  assert.equal(storage.status.supported, true);
  assert.equal(storage.status.configured, false);
  assert.equal(storage.status.liveVerified, false);
  assert.equal(storage.status.access, "private");
  await assert.rejects(
    storage.upload(createObjectKey("image/png"), Buffer.from("x"), "image/png"),
    hasCode("NOT_CONFIGURED"),
  );
  await assert.rejects(
    storage.getUrl(createObjectKey("image/png")),
    hasCode("NOT_CONFIGURED"),
  );
  assert.equal(mock.requests.length, 0);
  storage.close();
});

test("配置验证拒绝缺失字段、非布尔路径模式以及生产 HTTP", () => {
  assert.throws(
    () =>
      loadObjectStorageConfig({ S3_ACCESS_KEY_ID: "secret-should-not-leak" }),
    (error) =>
      hasCode("INVALID_CONFIG")(error) &&
      !String(error).includes("secret-should-not-leak"),
  );
  const env = {
    S3_ENDPOINT: config.endpoint,
    S3_REGION: config.region,
    S3_BUCKET: config.bucket,
    S3_ACCESS_KEY_ID: config.accessKeyId,
    S3_SECRET_ACCESS_KEY: config.secretAccessKey,
    S3_FORCE_PATH_STYLE: "true",
    NODE_ENV: "production",
  };
  assert.equal(loadObjectStorageConfig(env)!.forcePathStyle, true);
  assert.equal(
    loadObjectStorageConfig({ ...env, S3_FORCE_PATH_STYLE: "false" })!
      .forcePathStyle,
    false,
  );
  assert.throws(
    () => loadObjectStorageConfig({ ...env, S3_FORCE_PATH_STYLE: "1" }),
    hasCode("INVALID_CONFIG"),
  );
  for (const endpoint of [
    "http://storage.example",
    "http://localhost:9000",
    "ftp://storage.example",
    "https://name:password@storage.example",
    "https://storage.example/path",
    "https://storage.example/?token=secret",
    "https://storage.example/#hash",
  ])
    assert.throws(
      () => createObjectStorage({ ...config, endpoint, nodeEnv: "production" }),
      hasCode("INVALID_CONFIG"),
    );
  for (const endpoint of [
    "http://localhost:9000",
    "http://127.0.0.1:9000",
    "http://[::1]:9000",
  ]) {
    const storage = createObjectStorage({ ...config, endpoint });
    assert.equal(storage.status.configured, true);
    storage.close();
  }
  assert.throws(
    () =>
      createObjectStorage({
        ...config,
        endpoint: "http://localhost.evil.example",
      }),
    hasCode("INVALID_CONFIG"),
  );
  assert.throws(
    () => createObjectStorage({ ...config, bucket: "../escape" }),
    hasCode("INVALID_CONFIG"),
  );
});

test("随机对象 key 固定前缀，拒绝文件名、穿越路径和不匹配扩展名", async () => {
  const mock = mockHandler(),
    storage = createObjectStorage(config, { requestHandler: mock.handler });
  try {
    const key = createObjectKey("image/png");
    assert.match(key, /^qian-estate\/uploads\/[a-f0-9]{64}\.png$/);
    assert.notEqual(key, createObjectKey("image/png"));
    assert.match(createObjectKey("image/jpeg"), /\.jpeg$/);
    assert.throws(
      () => createObjectKey("text/html" as never),
      hasCode("INVALID_INPUT"),
    );
    for (const invalid of [
      "photo.png",
      "../../secret",
      `${OBJECT_PREFIX}../secret.png`,
      `${OBJECT_PREFIX}${"a".repeat(64)}.png/extra`,
      `other/${"a".repeat(64)}.png`,
      `${OBJECT_PREFIX}%2e%2e/photo.png`,
      "https://evil.example/file.png",
    ]) {
      await assert.rejects(
        storage.upload(invalid, Buffer.from("x"), "image/png"),
        hasCode("INVALID_INPUT"),
      );
      await assert.rejects(storage.getUrl(invalid), hasCode("INVALID_INPUT"));
    }
    await assert.rejects(
      storage.upload(key, Buffer.from("x"), "image/jpeg"),
      hasCode("INVALID_INPUT"),
    );
    assert.equal(mock.requests.length, 0);
  } finally {
    storage.close();
  }
});

test("校验 Buffer、5MiB、MIME 与图片内容后才调用 SDK", async () => {
  const mock = mockHandler(),
    storage = createObjectStorage(config, { requestHandler: mock.handler });
  const key = createObjectKey("image/png");
  try {
    for (const body of [
      Buffer.alloc(0),
      Buffer.alloc(OBJECT_MAX_BYTES + 1),
      "not-a-buffer",
    ])
      await assert.rejects(
        storage.upload(key, body as Buffer, "image/png"),
        hasCode("INVALID_BODY"),
      );
    await assert.rejects(
      storage.upload(key, Buffer.from("<script>bad</script>"), "image/png"),
      hasCode("INVALID_IMAGE"),
    );
    await assert.rejects(
      storage.upload(key, png(), "image/svg+xml" as never),
      hasCode("INVALID_INPUT"),
    );
    await assert.rejects(
      storage.upload(createObjectKey("image/jpeg"), png(), "image/jpeg"),
      hasCode("INVALID_IMAGE"),
    );
    assert.equal(mock.requests.length, 0);
  } finally {
    storage.close();
  }
});

test("真实 SDK 序列化上传：私有缓存、不公开 ACL、禁止覆盖、只返回 key", async () => {
  const mock = mockHandler(),
    storage = createObjectStorage(config, { requestHandler: mock.handler });
  const key = storage.createKey("image/png"),
    bytes = png();
  try {
    const result = await storage.upload(key, bytes, "image/png");
    assert.deepEqual(result, {
      key,
      size: bytes.length,
      mime: "image/png",
      etag: '"test-etag"',
    });
    assert.equal(mock.requests.length, 1);
    const request = mock.requests[0]!;
    assert.equal(request.method, "PUT");
    assert.equal(request.hostname, "storage.example");
    assert.equal(request.protocol, "https:");
    assert.equal(request.path, `/private-test-bucket/${key}`);
    assert.equal(request.headers["content-type"], "image/png");
    assert.equal(request.headers["if-none-match"], "*");
    assert.equal(request.headers["cache-control"], "private, no-store");
    assert.equal(request.headers["x-amz-acl"], undefined);
    assert.match(request.headers.authorization!, /^AWS4-HMAC-SHA256 /);
    assert.equal("url" in result, false);
    assert.ok(!JSON.stringify(result).includes(config.secretAccessKey));
  } finally {
    storage.close();
  }
});

test("SDK 预签名 GET 不外呼、有效期受限、不提供永久 URL", async () => {
  const mock = mockHandler(),
    storage = createObjectStorage(config, { requestHandler: mock.handler });
  try {
    const key = createObjectKey("image/png"),
      url = new URL(await storage.getUrl(key));
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "storage.example");
    assert.equal(url.pathname, `/private-test-bucket/${key}`);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
    assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.match(url.searchParams.get("X-Amz-Signature")!, /^[a-f0-9]{64}$/);
    assert.equal(
      url.searchParams.get("response-cache-control"),
      "private, no-store",
    );
    assert.equal(mock.requests.length, 0);
    assert.ok(!url.href.includes(config.secretAccessKey));
    assert.throws(
      () => createObjectStorage(config, { getUrlExpiresIn: 901 }),
      hasCode("INVALID_CONFIG"),
    );
  } finally {
    storage.close();
  }
});

test("虚拟主机寻址可配置，AWS 原生端点可省略", async () => {
  const mock = mockHandler(),
    storage = createObjectStorage(
      { ...config, forcePathStyle: false },
      { requestHandler: mock.handler },
    );
  try {
    assert.equal(
      new URL(await storage.getUrl(createObjectKey("image/jpeg"))).hostname,
      "private-test-bucket.storage.example",
    );
  } finally {
    storage.close();
  }
  const aws = createObjectStorage(
    { ...config, endpoint: undefined, forcePathStyle: false },
    { requestHandler: mock.handler },
  );
  try {
    assert.match(
      new URL(await aws.getUrl(createObjectKey("image/png"))).hostname,
      /\.amazonaws\.com$/,
    );
  } finally {
    aws.close();
  }
});

test("已存在对象拒绝覆盖，错误脱敏且无自动重试", async () => {
  const mock = mockHandler(412),
    storage = createObjectStorage(config, { requestHandler: mock.handler });
  try {
    await assert.rejects(
      storage.upload(createObjectKey("image/png"), png(), "image/png"),
      hasCode("OBJECT_EXISTS"),
    );
    assert.equal(mock.requests.length, 1);
  } finally {
    storage.close();
  }
  let calls = 0;
  const failed = createObjectStorage(config, {
    requestHandler: {
      async handle() {
        calls++;
        throw new Error(`敏感 ${config.secretAccessKey}`);
      },
    },
  });
  try {
    await assert.rejects(
      failed.upload(createObjectKey("image/png"), png(), "image/png"),
      (error) =>
        hasCode("STORAGE_FAILED")(error) &&
        !String(error).includes(config.secretAccessKey),
    );
    assert.equal(calls, 1);
  } finally {
    failed.close();
  }
});

test("超时取消请求且关闭后不可再用", async () => {
  let calls = 0,
    aborted = false;
  const storage = createObjectStorage(config, {
    timeoutMs: 30,
    requestHandler: {
      async handle(
        _request: CapturedRequest,
        options?: {
          abortSignal?: {
            addEventListener: (type: "abort", listener: () => void) => void;
          };
        },
      ) {
        calls++;
        return new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("已中止"));
          });
        });
      },
    },
  });
  try {
    await assert.rejects(
      storage.upload(createObjectKey("image/png"), png(), "image/png"),
      hasCode("STORAGE_TIMEOUT"),
    );
    assert.equal(calls, 1);
    assert.equal(aborted, true);
  } finally {
    storage.close();
  }
  storage.close();
  await assert.rejects(
    storage.getUrl(createObjectKey("image/png")),
    hasCode("STORAGE_CLOSED"),
  );
});
