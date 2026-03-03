import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import PostalMime from "postal-mime";
import type { Email } from "postal-mime";
import {
  streamToUint8Array,
  extractHeaders,
  buildPayload,
  postWebhook,
  DEFAULT_MAX_RAW_BYTES,
  WEBHOOK_PATH,
} from "../index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SIMPLE_MIME = [
  "From: Alice <alice@example.com>",
  "To: support@myapp.com",
  "Subject: Hello from Alice",
  "Message-ID: <msg-001@example.com>",
  "Date: Mon, 03 Mar 2026 10:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hi there, this is a test email.",
].join("\r\n");

const THREADED_MIME = [
  "From: Bob <bob@example.com>",
  "To: support@myapp.com",
  "Subject: Re: Project update",
  "Message-ID: <msg-002@example.com>",
  "In-Reply-To: <msg-001@example.com>",
  "References: <msg-001@example.com>",
  "Date: Mon, 03 Mar 2026 11:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Sounds good, let's proceed.",
].join("\r\n");

const HTML_MIME = [
  "From: Carol <carol@example.com>",
  "To: support@myapp.com",
  "Subject: HTML email",
  "Message-ID: <msg-003@example.com>",
  "Date: Mon, 03 Mar 2026 12:00:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/alternative; boundary="boundary42"',
  "",
  "--boundary42",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Plain text version.",
  "--boundary42",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>HTML <strong>version</strong>.</p>",
  "--boundary42--",
].join("\r\n");

const NO_SUBJECT_MIME = [
  "From: dave@example.com",
  "To: support@myapp.com",
  "Message-ID: <msg-004@example.com>",
  "Date: Mon, 03 Mar 2026 13:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "No subject line here.",
].join("\r\n");

function mimeToBytes(mime: string): Uint8Array {
  return new TextEncoder().encode(mime);
}

// ---------------------------------------------------------------------------
// streamToUint8Array
// ---------------------------------------------------------------------------

describe("streamToUint8Array", () => {
  it("collects a single-chunk stream", async () => {
    const data = new TextEncoder().encode("hello world");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });

    const result = await streamToUint8Array(stream);
    expect(result).toEqual(data);
  });

  it("collects a multi-chunk stream", async () => {
    const chunk1 = new TextEncoder().encode("hello ");
    const chunk2 = new TextEncoder().encode("world");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    const result = await streamToUint8Array(stream);
    expect(new TextDecoder().decode(result)).toBe("hello world");
    expect(result.byteLength).toBe(chunk1.byteLength + chunk2.byteLength);
  });

  it("returns empty Uint8Array for empty stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    const result = await streamToUint8Array(stream);
    expect(result.byteLength).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractHeaders
// ---------------------------------------------------------------------------

describe("extractHeaders", () => {
  it("extracts threading headers from a simple email", async () => {
    const parsed = await PostalMime.parse(SIMPLE_MIME);
    const headers = extractHeaders(parsed);

    expect(headers["message-id"]).toBe("<msg-001@example.com>");
    expect(headers["in-reply-to"]).toBeUndefined();
    expect(headers["references"]).toBeUndefined();
  });

  it("extracts in-reply-to and references from a threaded email", async () => {
    const parsed = await PostalMime.parse(THREADED_MIME);
    const headers = extractHeaders(parsed);

    expect(headers["message-id"]).toBe("<msg-002@example.com>");
    expect(headers["in-reply-to"]).toBe("<msg-001@example.com>");
    expect(headers["references"]).toBe("<msg-001@example.com>");
  });

  it("includes date header", async () => {
    const parsed = await PostalMime.parse(SIMPLE_MIME);
    const headers = extractHeaders(parsed);

    expect(headers["date"]).toBeDefined();
  });

  it("does not include non-threading headers", async () => {
    const parsed = await PostalMime.parse(SIMPLE_MIME);
    const headers = extractHeaders(parsed);

    // from/to/subject/content-type should NOT appear in the extracted headers
    expect(headers["from"]).toBeUndefined();
    expect(headers["to"]).toBeUndefined();
    expect(headers["subject"]).toBeUndefined();
    expect(headers["content-type"]).toBeUndefined();
  });

  it("uses postal-mime top-level fields as fallback", async () => {
    // Construct a minimal parsed Email with top-level messageId but no headers
    const fakeEmail = {
      headers: [],
      headerLines: [],
      subject: "Test",
      from: { name: "Test", address: "test@example.com" },
      to: [{ name: "", address: "dest@example.com" }],
      cc: [],
      bcc: [],
      replyTo: [],
      deliveredTo: "",
      returnPath: "",
      sender: { name: "", address: "" },
      messageId: "<fallback-id@example.com>",
      inReplyTo: "<fallback-reply@example.com>",
      references: "<fallback-ref@example.com>",
      date: "",
      html: "",
      text: "",
      attachments: [],
    } satisfies Email;
    const headers = extractHeaders(fakeEmail);
    expect(headers["message-id"]).toBe("<fallback-id@example.com>");
    expect(headers["in-reply-to"]).toBe("<fallback-reply@example.com>");
    expect(headers["references"]).toBe("<fallback-ref@example.com>");
  });
});

// ---------------------------------------------------------------------------
// buildPayload
// ---------------------------------------------------------------------------

describe("buildPayload", () => {
  it("builds a payload from a simple email", async () => {
    const parsed = await PostalMime.parse(SIMPLE_MIME);
    const payload = buildPayload(
      "alice@example.com",
      "support@myapp.com",
      parsed,
      undefined,
    );

    expect(payload.from).toBe("alice@example.com");
    expect(payload.to).toBe("support@myapp.com");
    expect(payload.subject).toBe("Hello from Alice");
    expect(payload.text_body?.trim()).toBe("Hi there, this is a test email.");
    expect(payload.html_body).toBeUndefined();
    expect(payload.raw).toBeUndefined();
    expect(payload.timestamp).toBeDefined();
    expect(new Date(payload.timestamp).getTime()).not.toBeNaN();
    expect(payload.headers["message-id"]).toBe("<msg-001@example.com>");
  });

  it("includes both text and html for multipart emails", async () => {
    const parsed = await PostalMime.parse(HTML_MIME);
    const payload = buildPayload(
      "carol@example.com",
      "support@myapp.com",
      parsed,
      undefined,
    );

    expect(payload.text_body?.trim()).toBe("Plain text version.");
    expect(payload.html_body).toContain("<strong>version</strong>");
  });

  it("uses envelope from when parsed from is missing", async () => {
    const fakeEmail = {
      headers: [],
      headerLines: [],
      subject: "Test",
      from: undefined as unknown as Email["from"],
      to: [],
      cc: [],
      bcc: [],
      replyTo: [],
      deliveredTo: "",
      returnPath: "",
      sender: { name: "", address: "" },
      messageId: "",
      inReplyTo: "",
      references: "",
      date: "",
      html: "",
      text: "body",
      attachments: [],
    } as Email;

    const payload = buildPayload(
      "envelope@example.com",
      "support@myapp.com",
      fakeEmail,
      undefined,
    );
    expect(payload.from).toBe("envelope@example.com");
  });

  it("defaults subject to '(no subject)' when missing", async () => {
    const parsed = await PostalMime.parse(NO_SUBJECT_MIME);
    const payload = buildPayload(
      "dave@example.com",
      "support@myapp.com",
      parsed,
      undefined,
    );

    // postal-mime may return empty string or undefined for missing subjects
    // Our code should handle both
    if (!parsed.subject) {
      expect(payload.subject).toBe("(no subject)");
    } else {
      expect(payload.subject).toBe(parsed.subject);
    }
  });

  it("includes raw MIME when provided", async () => {
    const parsed = await PostalMime.parse(SIMPLE_MIME);
    const payload = buildPayload(
      "alice@example.com",
      "support@myapp.com",
      parsed,
      SIMPLE_MIME,
    );

    expect(payload.raw).toBe(SIMPLE_MIME);
  });

  it("produces a valid ISO timestamp", async () => {
    const parsed = await PostalMime.parse(SIMPLE_MIME);
    const before = Date.now();
    const payload = buildPayload(
      "alice@example.com",
      "support@myapp.com",
      parsed,
      undefined,
    );
    const after = Date.now();

    const ts = new Date(payload.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// postWebhook — retry behaviour
// ---------------------------------------------------------------------------

describe("postWebhook", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  const testPayload = {
    from: "test@example.com",
    to: "support@myapp.com",
    subject: "Test",
    headers: {},
    timestamp: new Date().toISOString(),
  };

  it("returns response on 200", async () => {
    const mockResponse = new Response(
      JSON.stringify({ contact_id: "c1", thread_id: "t1", message_id: "m1" }),
      { status: 200 },
    );
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await postWebhook(
      "https://api.example.com/cloudflare/email",
      "secret",
      testPayload,
    );
    expect(result.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("sends correct headers", async () => {
    const mockResponse = new Response("{}", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    await postWebhook(
      "https://api.example.com/cloudflare/email",
      "my-secret-123",
      testPayload,
    );

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    const headers = callArgs[1].headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Cloudflare-Email-Secret"]).toBe("my-secret-123");
  });

  it("does not retry on 4xx errors", async () => {
    const mockResponse = new Response("Unauthorized", { status: 401 });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    await expect(
      postWebhook(
        "https://api.example.com/cloudflare/email",
        "wrong-secret",
        testPayload,
      ),
    ).rejects.toThrow("Webhook returned 401");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx errors and succeeds on retry", async () => {
    const failResponse = new Response("Internal Server Error", { status: 500 });
    const successResponse = new Response(
      JSON.stringify({ contact_id: "c1", thread_id: "t1", message_id: "m1" }),
      { status: 200 },
    );

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValueOnce(successResponse);

    const result = await postWebhook(
      "https://api.example.com/cloudflare/email",
      "secret",
      testPayload,
    );
    expect(result.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on network errors", async () => {
    const successResponse = new Response(
      JSON.stringify({ contact_id: "c1", thread_id: "t1", message_id: "m1" }),
      { status: 200 },
    );

    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce(successResponse);

    const result = await postWebhook(
      "https://api.example.com/cloudflare/email",
      "secret",
      testPayload,
    );
    expect(result.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("fails after exhausting all retries on 5xx", async () => {
    const failResponse = new Response("Bad Gateway", { status: 502 });
    globalThis.fetch = vi.fn().mockResolvedValue(failResponse);

    await expect(
      postWebhook(
        "https://api.example.com/cloudflare/email",
        "secret",
        testPayload,
      ),
    ).rejects.toThrow("Webhook returned 502");

    // 1 initial + 2 retries = 3 total
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Full MIME → payload integration
// ---------------------------------------------------------------------------

describe("MIME parsing integration", () => {
  it("parses a simple email end-to-end", async () => {
    const rawBytes = mimeToBytes(SIMPLE_MIME);
    const parsed = await PostalMime.parse(rawBytes);
    const payload = buildPayload(
      "alice@example.com",
      "support@myapp.com",
      parsed,
      undefined,
    );

    expect(payload.from).toBe("alice@example.com");
    expect(payload.to).toBe("support@myapp.com");
    expect(payload.subject).toBe("Hello from Alice");
    expect(payload.text_body).toContain("test email");
    expect(payload.headers["message-id"]).toBe("<msg-001@example.com>");
  });

  it("parses a threaded reply end-to-end", async () => {
    const rawBytes = mimeToBytes(THREADED_MIME);
    const parsed = await PostalMime.parse(rawBytes);
    const payload = buildPayload(
      "bob@example.com",
      "support@myapp.com",
      parsed,
      undefined,
    );

    expect(payload.subject).toBe("Re: Project update");
    expect(payload.headers["message-id"]).toBe("<msg-002@example.com>");
    expect(payload.headers["in-reply-to"]).toBe("<msg-001@example.com>");
    expect(payload.headers["references"]).toBe("<msg-001@example.com>");
  });

  it("parses a multipart email end-to-end", async () => {
    const rawBytes = mimeToBytes(HTML_MIME);
    const parsed = await PostalMime.parse(rawBytes);
    const payload = buildPayload(
      "carol@example.com",
      "support@myapp.com",
      parsed,
      undefined,
    );

    expect(payload.text_body?.trim()).toBe("Plain text version.");
    expect(payload.html_body).toContain("<strong>version</strong>");
  });
});
