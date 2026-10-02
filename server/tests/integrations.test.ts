import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCipheriv,
  createHash,
  createHmac,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import {
  createIntegrations,
  IntegrationError,
  loadIntegrationConfig,
  type IntegrationConfig,
  type SignedRequest,
  type Transport,
} from "../src/integrations.js";

// 只生成本地测试密钥，所有外部传输均替换为 mock，绝不发送真实短信或支付请求。
const merchant = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
const time = Date.parse("2026-09-09T08:00:00Z");
const timestamp = String(time / 1000);
const config: IntegrationConfig = {
  maps: { key: "TEST-MAPS-KEY" },
  sms: {
    secretId: "TESTSECRETID",
    secretKey: "TESTSECRETKEY",
    appId: "1400000000",
    signName: "测试签名",
    templateId: "10001",
    region: "ap-guangzhou",
    sessionToken: "mock-session-token",
  },
  wechatPay: {
    appId: "wx1234567890abcdef",
    merchantId: "1900000001",
    serialNo: "AABBCC",
    privateKeyPem: merchant.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    apiV3Key: "0123456789abcdef0123456789abcdef",
    notifyUrl: "https://merchant.example/api/pay/notify",
    platformPublicKeys: {
      PUB_KEY_ID_TEST: platform.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    },
  },
};
const options = {
  now: () => time,
  nonce: () => "0123456789abcdef0123456789abcdef",
};
const order = {
  outTradeNo: "ORDER_20260909_001",
  description: "测试服务订单",
  totalFen: 1200,
  payerOpenId: "test_openid",
};
const expected = {
  outTradeNo: order.outTradeNo,
  totalFen: order.totalFen,
  payerOpenId: order.payerOpenId,
};
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const hasCode = (code: string) => (error: unknown) =>
  error instanceof IntegrationError &&
  error.code === code &&
  /[\u4e00-\u9fff]/.test(error.message);
function responseHeaders(raw: Buffer, stamp = timestamp): Headers {
  const nonce = "platformnonce0123456789";
  return new Headers({
    "Wechatpay-Timestamp": stamp,
    "Wechatpay-Nonce": nonce,
    "Wechatpay-Serial": "PUB_KEY_ID_TEST",
    "Wechatpay-Signature": sign(
      "RSA-SHA256",
      Buffer.concat([
        Buffer.from(`${stamp}\n${nonce}\n`),
        raw,
        Buffer.from("\n"),
      ]),
      platform.privateKey,
    ).toString("base64"),
  });
}
function paymentNotification(
  overrides: Record<string, unknown> = {},
  tamperCipher = false,
) {
  const transaction = {
    appid: config.wechatPay!.appId,
    mchid: config.wechatPay!.merchantId,
    out_trade_no: order.outTradeNo,
    transaction_id: "WX_TRANSACTION_001",
    trade_type: "JSAPI",
    trade_state: "SUCCESS",
    success_time: "2026-09-09T16:00:00+08:00",
    payer: { openid: order.payerOpenId },
    amount: { total: 1200, currency: "CNY" },
    ...overrides,
  };
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(config.wechatPay!.apiV3Key),
    Buffer.from("0123456789ab"),
  );
  cipher.setAAD(Buffer.from("transaction"));
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(transaction)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  if (tamperCipher) bytes[0] = bytes[0]! ^ 1;
  const raw = Buffer.from(
    JSON.stringify({
      id: "notification-001",
      event_type: "TRANSACTION.SUCCESS",
      resource_type: "encrypt-resource",
      resource: {
        algorithm: "AEAD_AES_256_GCM",
        original_type: "transaction",
        associated_data: "transaction",
        nonce: "0123456789ab",
        ciphertext: bytes.toString("base64"),
      },
    }),
  );
  return { raw, headers: responseHeaders(raw) };
}

test("未配置时报告能力但不外呼，配置错误不泄漏密钥", async () => {
  let calls = 0;
  const api = createIntegrations(
    {},
    {
      transport: async () => {
        calls++;
        throw new Error("不应调用");
      },
    },
  );
  for (const name of ["maps", "sms", "wechatPay"] as const) {
    assert.equal(api.status[name].supported, true);
    assert.equal(api.status[name].configured, false);
    assert.equal(api.status[name].liveVerified, false);
  }
  assert.equal(api.status.s3.supported, false);
  await assert.rejects(
    api.geocode({ address: "示例地址" }),
    hasCode("NOT_CONFIGURED"),
  );
  await assert.rejects(
    api.sendSms({ phoneNumber: "+8613800000000", templateParams: [] }),
    hasCode("NOT_CONFIGURED"),
  );
  assert.throws(
    () => api.buildJsapiOrderRequest(order),
    hasCode("NOT_CONFIGURED"),
  );
  assert.equal(calls, 0);
  assert.throws(
    () =>
      loadIntegrationConfig({ TENCENT_SMS_SECRET_ID: "secret-must-not-leak" }),
    (error) =>
      hasCode("INVALID_CONFIG")(error) &&
      !String(error).includes("secret-must-not-leak"),
  );
  assert.throws(
    () => loadIntegrationConfig({ WECHAT_PAY_API_V3_KEY: "short" }),
    hasCode("INVALID_CONFIG"),
  );
  assert.deepEqual(loadIntegrationConfig({}), {});
});

test("环境变量完整加载并校验 RSA、回调 URL 与 APIv3 密钥", () => {
  const p = config.wechatPay!;
  const env = {
    WECHAT_PAY_APP_ID: p.appId,
    WECHAT_PAY_MCH_ID: p.merchantId,
    WECHAT_PAY_SERIAL_NO: p.serialNo,
    WECHAT_PAY_PRIVATE_KEY_PEM: p.privateKeyPem.replace(/\n/g, "\\n"),
    WECHAT_PAY_API_V3_KEY: p.apiV3Key,
    WECHAT_PAY_NOTIFY_URL: p.notifyUrl,
    WECHAT_PAY_PLATFORM_PUBLIC_KEYS_JSON: JSON.stringify(p.platformPublicKeys),
  };
  assert.equal(
    createIntegrations(loadIntegrationConfig(env)).status.wechatPay.configured,
    true,
  );
  for (const override of [
    { WECHAT_PAY_NOTIFY_URL: "http://merchant.example/notify" },
    { WECHAT_PAY_PLATFORM_PUBLIC_KEYS_JSON: "{" },
    { WECHAT_PAY_API_V3_KEY: "中".repeat(32) },
    { WECHAT_PAY_PRIVATE_KEY_PEM: "invalid-private-key" },
  ])
    assert.throws(
      () => loadIntegrationConfig({ ...env, ...override }),
      hasCode("INVALID_CONFIG"),
    );
  const weak = generateKeyPairSync("rsa", { modulusLength: 1024 });
  assert.throws(
    () =>
      createIntegrations({
        wechatPay: {
          ...p,
          privateKeyPem: weak.privateKey
            .export({ format: "pem", type: "pkcs8" })
            .toString(),
        },
      }),
    hasCode("INVALID_CONFIG"),
  );
});

test("地图真实协议请求通过 mock 返回裁剪结果，密钥只在服务端出站 URL", async () => {
  const urls: URL[] = [];
  const transport: Transport = async (url, init) => {
    const parsed = new URL(url);
    urls.push(parsed);
    assert.equal(parsed.origin, "https://apis.map.qq.com");
    assert.equal(parsed.searchParams.get("key"), config.maps!.key);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    return parsed.pathname.includes("geocoder")
      ? reply({
          status: 0,
          result: {
            location: { lat: 30.2, lng: 120.1 },
            title: "示例大厦",
            key: "不可返回",
            debug: "不可返回",
          },
        })
      : reply({
          status: 0,
          data: [
            {
              id: "place-1",
              title: "示例社区",
              address: "示例路1号",
              location: { lat: 30.2, lng: 120.1 },
              secret: "不可返回",
            },
          ],
        });
  };
  const api = createIntegrations(config, { ...options, transport });
  const result = await api.geocode({ address: "示例路 & 1号", city: "杭州" });
  assert.deepEqual(result, {
    location: { lat: 30.2, lng: 120.1 },
    title: "示例大厦",
  });
  assert.equal(urls[0]!.searchParams.get("address"), "示例路 & 1号");
  const places = await api.searchAddresses({ keyword: "示例", city: "杭州" });
  assert.equal(places[0]!.title, "示例社区");
  assert.equal(urls[1]!.searchParams.get("region_fix"), "1");
  assert.ok(!JSON.stringify(places).includes("不可返回"));
  await assert.rejects(
    api.geocode({ address: "示例", key: "attacker" } as never),
    hasCode("INVALID_INPUT"),
  );
});

test("上游网络、业务错误和无效 JSON 使用中文错误且不泄密", async () => {
  const broken = createIntegrations(config, {
    transport: async (url) => {
      throw new Error(url);
    },
  });
  await assert.rejects(
    broken.geocode({ address: "示例" }),
    (error) =>
      hasCode("UPSTREAM_NETWORK")(error) &&
      !String(error).includes(config.maps!.key),
  );
  const denied = createIntegrations(config, {
    transport: async () => reply({ status: 120, message: "secret value" }),
  });
  await assert.rejects(
    denied.geocode({ address: "示例" }),
    hasCode("MAP_REJECTED"),
  );
  const malformed = createIntegrations(config, {
    transport: async () => new Response("<html>失败</html>"),
  });
  await assert.rejects(
    malformed.geocode({ address: "示例" }),
    hasCode("INVALID_RESPONSE"),
  );
  const http = createIntegrations(config, {
    transport: async () => new Response("secret value", { status: 403 }),
  });
  await assert.rejects(
    http.geocode({ address: "示例" }),
    hasCode("UPSTREAM_HTTP"),
  );
});

test("超时覆盖连接和响应体读取，无自动重试并限制响应大小", async () => {
  let calls = 0;
  const hung = createIntegrations(config, {
    timeoutMs: 15,
    transport: async (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) =>
        init.signal!.addEventListener("abort", () =>
          reject(new Error("已取消")),
        ),
      );
    },
  });
  await assert.rejects(
    hung.geocode({ address: "示例" }),
    hasCode("UPSTREAM_TIMEOUT"),
  );
  assert.equal(calls, 1);
  const slow = createIntegrations(config, {
    timeoutMs: 15,
    transport: async (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal!.addEventListener("abort", () =>
              controller.error(new Error("已取消")),
            );
          },
        }),
      ),
  });
  await assert.rejects(
    slow.searchAddresses({ keyword: "示例", city: "杭州" }),
    hasCode("UPSTREAM_TIMEOUT"),
  );
  const huge = createIntegrations(config, {
    transport: async () => new Response("x".repeat(1024 * 1024 + 1)),
  });
  await assert.rejects(
    huge.geocode({ address: "示例" }),
    hasCode("INVALID_RESPONSE"),
  );
});

test("短信 TC3 签名可独立重算，固定模板且只接受已确认受理", async () => {
  let sent: SignedRequest | undefined;
  const api = createIntegrations(config, {
    ...options,
    transport: async (url, init) => {
      sent = { url, ...init } as SignedRequest;
      return reply({
        Response: {
          RequestId: "request-1",
          SendStatusSet: [
            { Code: "Ok", SerialNo: "sms-1", PhoneNumber: "+8613800000000" },
          ],
        },
      });
    },
  });
  const result = await api.sendSms({
    phoneNumber: "+8613800000000",
    templateParams: ["123456", "5"],
  });
  assert.deepEqual(result, {
    accepted: true,
    requestId: "request-1",
    serialNo: "sms-1",
  });
  assert.equal(sent!.url, "https://sms.tencentcloudapi.com/");
  assert.equal(sent!.headers["X-TC-Token"], "mock-session-token");
  const body = JSON.parse(sent!.body);
  assert.equal(body.TemplateId, "10001");
  assert.equal(body.SignName, "测试签名");
  const digest = (s: string) => createHash("sha256").update(s).digest("hex");
  const scope = "2026-09-09/sms/tc3_request";
  const lines = [
    "POST",
    "/",
    "",
    "content-type:application/json; charset=utf-8\nhost:sms.tencentcloudapi.com\nx-tc-action:sendsms\n",
    "content-type;host;x-tc-action",
    digest(sent!.body),
  ];
  let key: Buffer = Buffer.from(`TC3${config.sms!.secretKey}`);
  for (const part of ["2026-09-09", "sms", "tc3_request"])
    key = createHmac("sha256", key).update(part).digest();
  const signature = createHmac("sha256", key)
    .update(
      ["TC3-HMAC-SHA256", timestamp, scope, digest(lines.join("\n"))].join(
        "\n",
      ),
    )
    .digest("hex");
  assert.equal(
    sent!.headers.Authorization,
    `TC3-HMAC-SHA256 Credential=TESTSECRETID/${scope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`,
  );
  await assert.rejects(
    api.sendSms({ phoneNumber: "13800000000", templateParams: [] }),
    hasCode("INVALID_INPUT"),
  );
  assert.throws(
    () =>
      api.signSmsRequest({
        phoneNumber: "+8613800000000",
        templateParams: [],
        templateId: "attacker",
      } as never),
    hasCode("INVALID_INPUT"),
  );
});

test("短信业务拒绝与收件人不匹配不会冒充成功", async () => {
  for (const response of [
    { Error: { Code: "Rejected", Message: "秘密" }, RequestId: "x" },
    {
      RequestId: "x",
      SendStatusSet: [
        {
          Code: "FailedOperation",
          SerialNo: "",
          PhoneNumber: "+8613800000000",
        },
      ],
    },
    {
      RequestId: "x",
      SendStatusSet: [
        { Code: "Ok", SerialNo: "s", PhoneNumber: "+8613900000000" },
      ],
    },
  ]) {
    const api = createIntegrations(config, {
      ...options,
      transport: async () => reply({ Response: response }),
    });
    await assert.rejects(
      api.sendSms({ phoneNumber: "+8613800000000", templateParams: [] }),
      hasCode("SMS_REJECTED"),
    );
  }
});

test("微信下单仅构造 RSA 请求，金额严格为服务器整数分且不会外呼", () => {
  let calls = 0;
  const api = createIntegrations(config, {
    ...options,
    transport: async () => {
      calls++;
      throw new Error();
    },
  });
  const request = api.buildJsapiOrderRequest(order);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(request.body).amount, {
    total: 1200,
    currency: "CNY",
  });
  const signature = /signature="([^"]+)"/.exec(
    request.headers.Authorization!,
  )![1]!;
  assert.ok(
    verify(
      "RSA-SHA256",
      Buffer.from(
        `POST\n/v3/pay/transactions/jsapi\n${timestamp}\n${options.nonce()}\n${request.body}\n`,
      ),
      merchant.publicKey,
      Buffer.from(signature, "base64"),
    ),
  );
  for (const patch of [
    { totalFen: 1.5 },
    { totalFen: -1 },
    { amount: 1 },
    { notifyUrl: "https://attacker.example" },
  ])
    assert.throws(
      () => api.buildJsapiOrderRequest({ ...order, ...patch }),
      hasCode("INVALID_INPUT"),
    );
});

test("JSAPI 参数签名与平台应答验签按原始字节验证", () => {
  const api = createIntegrations(config, options);
  const raw = Buffer.from('{"prepay_id":"wx_test_prepay_001"}');
  const verified = api.parseJsapiOrderResponse(raw, responseHeaders(raw));
  const params = api.signJsapiParameters(verified.prepayId);
  assert.equal(params.signType, "RSA");
  assert.ok(
    verify(
      "RSA-SHA256",
      Buffer.from(
        `${params.appId}\n${params.timeStamp}\n${params.nonceStr}\n${params.package}\n`,
      ),
      merchant.publicKey,
      Buffer.from(params.paySign, "base64"),
    ),
  );
  assert.throws(
    () =>
      api.parseJsapiOrderResponse(
        Buffer.concat([raw, Buffer.from(" ")]),
        responseHeaders(raw),
      ),
    hasCode("INVALID_SIGNATURE"),
  );
  assert.throws(
    () => api.signJsapiParameters("prepay\nspoofed"),
    hasCode("INVALID_INPUT"),
  );
});

test("通知验签后 AES256GCM 解密并核对商户、订单、金额、付款人", () => {
  const api = createIntegrations(config, options);
  const message = paymentNotification();
  const result = api.verifyAndDecryptNotification(
    message.raw,
    message.headers,
    expected,
  );
  assert.equal(result.id, "notification-001");
  assert.equal(result.transaction.amount.total, 1200);
  for (const override of [
    { mchid: "1900000002" },
    { appid: "wxother" },
    { out_trade_no: "OTHER_ORDER" },
    { amount: { total: 1, currency: "CNY" } },
    { payer: { openid: "other" } },
  ]) {
    const other = paymentNotification(override);
    assert.throws(
      () =>
        api.verifyAndDecryptNotification(other.raw, other.headers, expected),
      hasCode("PAYMENT_MISMATCH"),
    );
  }
  const corrupt = paymentNotification({}, true);
  assert.throws(
    () =>
      api.verifyAndDecryptNotification(corrupt.raw, corrupt.headers, expected),
    hasCode("INVALID_CIPHERTEXT"),
  );
  const wrongState = paymentNotification({ trade_state: "NOTPAY" });
  assert.throws(
    () =>
      api.verifyAndDecryptNotification(
        wrongState.raw,
        wrongState.headers,
        expected,
      ),
    hasCode("INVALID_INPUT"),
  );
});

test("通知拒绝未知平台公钥、过期时间、伪造签名及签名探针", () => {
  const api = createIntegrations(config, options);
  const { raw, headers } = paymentNotification();
  for (const [name, value] of [
    ["Wechatpay-Serial", "PUB_KEY_ID_UNKNOWN"],
    ["Wechatpay-Signature", "WECHATPAY/SIGNTEST/test"],
    ["Wechatpay-Signature", Buffer.alloc(256).toString("base64")],
    ["Wechatpay-Nonce", "invalid nonce"],
  ]) {
    const changed = new Headers(headers);
    changed.set(name!, value!);
    assert.throws(
      () => api.verifyAndDecryptNotification(raw, changed, expected),
      hasCode("INVALID_SIGNATURE"),
    );
  }
  for (const offset of [-301, 301])
    assert.throws(
      () =>
        api.verifyAndDecryptNotification(
          raw,
          responseHeaders(raw, String(Number(timestamp) + offset)),
          expected,
        ),
      hasCode("INVALID_SIGNATURE"),
    );
  assert.throws(
    () => api.verifyWechatSignature(Buffer.alloc(1024 * 1024 + 1), headers),
    hasCode("INVALID_SIGNATURE"),
  );
});
