#!/usr/bin/env node

// node_modules/@hono/node-server/dist/index.mjs
import { createServer as createServerHTTP } from "http";
import { Http2ServerRequest as Http2ServerRequest2 } from "http2";
import { Http2ServerRequest } from "http2";
import { Readable } from "stream";
import crypto from "crypto";
var RequestError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RequestError";
  }
};
var toRequestError = (e) => {
  if (e instanceof RequestError) {
    return e;
  }
  return new RequestError(e.message, { cause: e });
};
var GlobalRequest = global.Request;
var Request2 = class extends GlobalRequest {
  constructor(input, options) {
    if (typeof input === "object" && getRequestCache in input) {
      input = input[getRequestCache]();
    }
    if (typeof options?.body?.getReader !== "undefined") {
      ;
      options.duplex ??= "half";
    }
    super(input, options);
  }
};
var newHeadersFromIncoming = (incoming) => {
  const headerRecord = [];
  const rawHeaders = incoming.rawHeaders;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const { [i]: key, [i + 1]: value } = rawHeaders;
    if (key.charCodeAt(0) !== /*:*/
    58) {
      headerRecord.push([key, value]);
    }
  }
  return new Headers(headerRecord);
};
var wrapBodyStream = /* @__PURE__ */ Symbol("wrapBodyStream");
var newRequestFromIncoming = (method, url, headers, incoming, abortController) => {
  const init = {
    method,
    headers,
    signal: abortController.signal
  };
  if (method === "TRACE") {
    init.method = "GET";
    const req = new Request2(url, init);
    Object.defineProperty(req, "method", {
      get() {
        return "TRACE";
      }
    });
    return req;
  }
  if (!(method === "GET" || method === "HEAD")) {
    if ("rawBody" in incoming && incoming.rawBody instanceof Buffer) {
      init.body = new ReadableStream({
        start(controller) {
          controller.enqueue(incoming.rawBody);
          controller.close();
        }
      });
    } else if (incoming[wrapBodyStream]) {
      let reader;
      init.body = new ReadableStream({
        async pull(controller) {
          try {
            reader ||= Readable.toWeb(incoming).getReader();
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
            } else {
              controller.enqueue(value);
            }
          } catch (error) {
            controller.error(error);
          }
        }
      });
    } else {
      init.body = Readable.toWeb(incoming);
    }
  }
  return new Request2(url, init);
};
var getRequestCache = /* @__PURE__ */ Symbol("getRequestCache");
var requestCache = /* @__PURE__ */ Symbol("requestCache");
var incomingKey = /* @__PURE__ */ Symbol("incomingKey");
var urlKey = /* @__PURE__ */ Symbol("urlKey");
var headersKey = /* @__PURE__ */ Symbol("headersKey");
var abortControllerKey = /* @__PURE__ */ Symbol("abortControllerKey");
var getAbortController = /* @__PURE__ */ Symbol("getAbortController");
var requestPrototype = {
  get method() {
    return this[incomingKey].method || "GET";
  },
  get url() {
    return this[urlKey];
  },
  get headers() {
    return this[headersKey] ||= newHeadersFromIncoming(this[incomingKey]);
  },
  [getAbortController]() {
    this[getRequestCache]();
    return this[abortControllerKey];
  },
  [getRequestCache]() {
    this[abortControllerKey] ||= new AbortController();
    return this[requestCache] ||= newRequestFromIncoming(
      this.method,
      this[urlKey],
      this.headers,
      this[incomingKey],
      this[abortControllerKey]
    );
  }
};
[
  "body",
  "bodyUsed",
  "cache",
  "credentials",
  "destination",
  "integrity",
  "mode",
  "redirect",
  "referrer",
  "referrerPolicy",
  "signal",
  "keepalive"
].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    get() {
      return this[getRequestCache]()[k];
    }
  });
});
["arrayBuffer", "blob", "clone", "formData", "json", "text"].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    value: function() {
      return this[getRequestCache]()[k]();
    }
  });
});
Object.setPrototypeOf(requestPrototype, Request2.prototype);
var newRequest = (incoming, defaultHostname) => {
  const req = Object.create(requestPrototype);
  req[incomingKey] = incoming;
  const incomingUrl = incoming.url || "";
  if (incomingUrl[0] !== "/" && // short-circuit for performance. most requests are relative URL.
  (incomingUrl.startsWith("http://") || incomingUrl.startsWith("https://"))) {
    if (incoming instanceof Http2ServerRequest) {
      throw new RequestError("Absolute URL for :path is not allowed in HTTP/2");
    }
    try {
      const url2 = new URL(incomingUrl);
      req[urlKey] = url2.href;
    } catch (e) {
      throw new RequestError("Invalid absolute URL", { cause: e });
    }
    return req;
  }
  const host = (incoming instanceof Http2ServerRequest ? incoming.authority : incoming.headers.host) || defaultHostname;
  if (!host) {
    throw new RequestError("Missing host header");
  }
  let scheme;
  if (incoming instanceof Http2ServerRequest) {
    scheme = incoming.scheme;
    if (!(scheme === "http" || scheme === "https")) {
      throw new RequestError("Unsupported scheme");
    }
  } else {
    scheme = incoming.socket && incoming.socket.encrypted ? "https" : "http";
  }
  const url = new URL(`${scheme}://${host}${incomingUrl}`);
  if (url.hostname.length !== host.length && url.hostname !== host.replace(/:\d+$/, "")) {
    throw new RequestError("Invalid host header");
  }
  req[urlKey] = url.href;
  return req;
};
var responseCache = /* @__PURE__ */ Symbol("responseCache");
var getResponseCache = /* @__PURE__ */ Symbol("getResponseCache");
var cacheKey = /* @__PURE__ */ Symbol("cache");
var GlobalResponse = global.Response;
var Response2 = class _Response {
  #body;
  #init;
  [getResponseCache]() {
    delete this[cacheKey];
    return this[responseCache] ||= new GlobalResponse(this.#body, this.#init);
  }
  constructor(body, init) {
    let headers;
    this.#body = body;
    if (init instanceof _Response) {
      const cachedGlobalResponse = init[responseCache];
      if (cachedGlobalResponse) {
        this.#init = cachedGlobalResponse;
        this[getResponseCache]();
        return;
      } else {
        this.#init = init.#init;
        headers = new Headers(init.#init.headers);
      }
    } else {
      this.#init = init;
    }
    if (typeof body === "string" || typeof body?.getReader !== "undefined" || body instanceof Blob || body instanceof Uint8Array) {
      ;
      this[cacheKey] = [init?.status || 200, body, headers || init?.headers];
    }
  }
  get headers() {
    const cache = this[cacheKey];
    if (cache) {
      if (!(cache[2] instanceof Headers)) {
        cache[2] = new Headers(
          cache[2] || { "content-type": "text/plain; charset=UTF-8" }
        );
      }
      return cache[2];
    }
    return this[getResponseCache]().headers;
  }
  get status() {
    return this[cacheKey]?.[0] ?? this[getResponseCache]().status;
  }
  get ok() {
    const status = this.status;
    return status >= 200 && status < 300;
  }
};
["body", "bodyUsed", "redirected", "statusText", "trailers", "type", "url"].forEach((k) => {
  Object.defineProperty(Response2.prototype, k, {
    get() {
      return this[getResponseCache]()[k];
    }
  });
});
["arrayBuffer", "blob", "clone", "formData", "json", "text"].forEach((k) => {
  Object.defineProperty(Response2.prototype, k, {
    value: function() {
      return this[getResponseCache]()[k]();
    }
  });
});
Object.setPrototypeOf(Response2, GlobalResponse);
Object.setPrototypeOf(Response2.prototype, GlobalResponse.prototype);
async function readWithoutBlocking(readPromise) {
  return Promise.race([readPromise, Promise.resolve().then(() => Promise.resolve(void 0))]);
}
function writeFromReadableStreamDefaultReader(reader, writable, currentReadPromise) {
  const cancel = (error) => {
    reader.cancel(error).catch(() => {
    });
  };
  writable.on("close", cancel);
  writable.on("error", cancel);
  (currentReadPromise ?? reader.read()).then(flow, handleStreamError);
  return reader.closed.finally(() => {
    writable.off("close", cancel);
    writable.off("error", cancel);
  });
  function handleStreamError(error) {
    if (error) {
      writable.destroy(error);
    }
  }
  function onDrain() {
    reader.read().then(flow, handleStreamError);
  }
  function flow({ done, value }) {
    try {
      if (done) {
        writable.end();
      } else if (!writable.write(value)) {
        writable.once("drain", onDrain);
      } else {
        return reader.read().then(flow, handleStreamError);
      }
    } catch (e) {
      handleStreamError(e);
    }
  }
}
function writeFromReadableStream(stream, writable) {
  if (stream.locked) {
    throw new TypeError("ReadableStream is locked.");
  } else if (writable.destroyed) {
    return;
  }
  return writeFromReadableStreamDefaultReader(stream.getReader(), writable);
}
var buildOutgoingHttpHeaders = (headers) => {
  const res = {};
  if (!(headers instanceof Headers)) {
    headers = new Headers(headers ?? void 0);
  }
  const cookies = [];
  for (const [k, v] of headers) {
    if (k === "set-cookie") {
      cookies.push(v);
    } else {
      res[k] = v;
    }
  }
  if (cookies.length > 0) {
    res["set-cookie"] = cookies;
  }
  res["content-type"] ??= "text/plain; charset=UTF-8";
  return res;
};
var X_ALREADY_SENT = "x-hono-already-sent";
if (typeof global.crypto === "undefined") {
  global.crypto = crypto;
}
var outgoingEnded = /* @__PURE__ */ Symbol("outgoingEnded");
var handleRequestError = () => new Response(null, {
  status: 400
});
var handleFetchError = (e) => new Response(null, {
  status: e instanceof Error && (e.name === "TimeoutError" || e.constructor.name === "TimeoutError") ? 504 : 500
});
var handleResponseError = (e, outgoing) => {
  const err = e instanceof Error ? e : new Error("unknown error", { cause: e });
  if (err.code === "ERR_STREAM_PREMATURE_CLOSE") {
    console.info("The user aborted a request.");
  } else {
    console.error(e);
    if (!outgoing.headersSent) {
      outgoing.writeHead(500, { "Content-Type": "text/plain" });
    }
    outgoing.end(`Error: ${err.message}`);
    outgoing.destroy(err);
  }
};
var flushHeaders = (outgoing) => {
  if ("flushHeaders" in outgoing && outgoing.writable) {
    outgoing.flushHeaders();
  }
};
var responseViaCache = async (res, outgoing) => {
  let [status, body, header] = res[cacheKey];
  let hasContentLength = false;
  if (!header) {
    header = { "content-type": "text/plain; charset=UTF-8" };
  } else if (header instanceof Headers) {
    hasContentLength = header.has("content-length");
    header = buildOutgoingHttpHeaders(header);
  } else if (Array.isArray(header)) {
    const headerObj = new Headers(header);
    hasContentLength = headerObj.has("content-length");
    header = buildOutgoingHttpHeaders(headerObj);
  } else {
    for (const key in header) {
      if (key.length === 14 && key.toLowerCase() === "content-length") {
        hasContentLength = true;
        break;
      }
    }
  }
  if (!hasContentLength) {
    if (typeof body === "string") {
      header["Content-Length"] = Buffer.byteLength(body);
    } else if (body instanceof Uint8Array) {
      header["Content-Length"] = body.byteLength;
    } else if (body instanceof Blob) {
      header["Content-Length"] = body.size;
    }
  }
  outgoing.writeHead(status, header);
  if (typeof body === "string" || body instanceof Uint8Array) {
    outgoing.end(body);
  } else if (body instanceof Blob) {
    outgoing.end(new Uint8Array(await body.arrayBuffer()));
  } else {
    flushHeaders(outgoing);
    await writeFromReadableStream(body, outgoing)?.catch(
      (e) => handleResponseError(e, outgoing)
    );
  }
  ;
  outgoing[outgoingEnded]?.();
};
var isPromise = (res) => typeof res.then === "function";
var responseViaResponseObject = async (res, outgoing, options = {}) => {
  if (isPromise(res)) {
    if (options.errorHandler) {
      try {
        res = await res;
      } catch (err) {
        const errRes = await options.errorHandler(err);
        if (!errRes) {
          return;
        }
        res = errRes;
      }
    } else {
      res = await res.catch(handleFetchError);
    }
  }
  if (cacheKey in res) {
    return responseViaCache(res, outgoing);
  }
  const resHeaderRecord = buildOutgoingHttpHeaders(res.headers);
  if (res.body) {
    const reader = res.body.getReader();
    const values = [];
    let done = false;
    let currentReadPromise = void 0;
    if (resHeaderRecord["transfer-encoding"] !== "chunked") {
      let maxReadCount = 2;
      for (let i = 0; i < maxReadCount; i++) {
        currentReadPromise ||= reader.read();
        const chunk = await readWithoutBlocking(currentReadPromise).catch((e) => {
          console.error(e);
          done = true;
        });
        if (!chunk) {
          if (i === 1) {
            await new Promise((resolve) => setTimeout(resolve));
            maxReadCount = 3;
            continue;
          }
          break;
        }
        currentReadPromise = void 0;
        if (chunk.value) {
          values.push(chunk.value);
        }
        if (chunk.done) {
          done = true;
          break;
        }
      }
      if (done && !("content-length" in resHeaderRecord)) {
        resHeaderRecord["content-length"] = values.reduce((acc, value) => acc + value.length, 0);
      }
    }
    outgoing.writeHead(res.status, resHeaderRecord);
    values.forEach((value) => {
      ;
      outgoing.write(value);
    });
    if (done) {
      outgoing.end();
    } else {
      if (values.length === 0) {
        flushHeaders(outgoing);
      }
      await writeFromReadableStreamDefaultReader(reader, outgoing, currentReadPromise);
    }
  } else if (resHeaderRecord[X_ALREADY_SENT]) {
  } else {
    outgoing.writeHead(res.status, resHeaderRecord);
    outgoing.end();
  }
  ;
  outgoing[outgoingEnded]?.();
};
var getRequestListener = (fetchCallback, options = {}) => {
  const autoCleanupIncoming = options.autoCleanupIncoming ?? true;
  if (options.overrideGlobalObjects !== false && global.Request !== Request2) {
    Object.defineProperty(global, "Request", {
      value: Request2
    });
    Object.defineProperty(global, "Response", {
      value: Response2
    });
  }
  return async (incoming, outgoing) => {
    let res, req;
    try {
      req = newRequest(incoming, options.hostname);
      let incomingEnded = !autoCleanupIncoming || incoming.method === "GET" || incoming.method === "HEAD";
      if (!incomingEnded) {
        ;
        incoming[wrapBodyStream] = true;
        incoming.on("end", () => {
          incomingEnded = true;
        });
        if (incoming instanceof Http2ServerRequest2) {
          ;
          outgoing[outgoingEnded] = () => {
            if (!incomingEnded) {
              setTimeout(() => {
                if (!incomingEnded) {
                  setTimeout(() => {
                    incoming.destroy();
                    outgoing.destroy();
                  });
                }
              });
            }
          };
        }
      }
      outgoing.on("close", () => {
        const abortController = req[abortControllerKey];
        if (abortController) {
          if (incoming.errored) {
            req[abortControllerKey].abort(incoming.errored.toString());
          } else if (!outgoing.writableFinished) {
            req[abortControllerKey].abort("Client connection prematurely closed.");
          }
        }
        if (!incomingEnded) {
          setTimeout(() => {
            if (!incomingEnded) {
              setTimeout(() => {
                incoming.destroy();
              });
            }
          });
        }
      });
      res = fetchCallback(req, { incoming, outgoing });
      if (cacheKey in res) {
        return responseViaCache(res, outgoing);
      }
    } catch (e) {
      if (!res) {
        if (options.errorHandler) {
          res = await options.errorHandler(req ? e : toRequestError(e));
          if (!res) {
            return;
          }
        } else if (!req) {
          res = handleRequestError();
        } else {
          res = handleFetchError(e);
        }
      } else {
        return handleResponseError(e, outgoing);
      }
    }
    try {
      return await responseViaResponseObject(res, outgoing, options);
    } catch (e) {
      return handleResponseError(e, outgoing);
    }
  };
};
var createAdaptorServer = (options) => {
  const fetchCallback = options.fetch;
  const requestListener = getRequestListener(fetchCallback, {
    hostname: options.hostname,
    overrideGlobalObjects: options.overrideGlobalObjects,
    autoCleanupIncoming: options.autoCleanupIncoming
  });
  const createServer = options.createServer || createServerHTTP;
  const server = createServer(options.serverOptions || {}, requestListener);
  return server;
};
var serve = (options, listeningListener) => {
  const server = createAdaptorServer(options);
  server.listen(options?.port ?? 3e3, options.hostname, () => {
    const serverInfo = server.address();
    listeningListener && listeningListener(serverInfo);
  });
  return server;
};

// node_modules/hono/dist/utils/mime.js
var getMimeType = (filename, mimes = baseMimes) => {
  const regexp = /\.([a-zA-Z0-9]+?)$/;
  const match2 = filename.match(regexp);
  if (!match2) {
    return;
  }
  let mimeType = mimes[match2[1].toLowerCase()];
  if (mimeType && mimeType.startsWith("text")) {
    mimeType += "; charset=utf-8";
  }
  return mimeType;
};
var _baseMimes = {
  aac: "audio/aac",
  avi: "video/x-msvideo",
  avif: "image/avif",
  av1: "video/av1",
  bin: "application/octet-stream",
  bmp: "image/bmp",
  css: "text/css",
  csv: "text/csv",
  eot: "application/vnd.ms-fontobject",
  epub: "application/epub+zip",
  gif: "image/gif",
  gz: "application/gzip",
  htm: "text/html",
  html: "text/html",
  ico: "image/x-icon",
  ics: "text/calendar",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  jsonld: "application/ld+json",
  map: "application/json",
  mid: "audio/x-midi",
  midi: "audio/x-midi",
  mjs: "text/javascript",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  oga: "audio/ogg",
  ogv: "video/ogg",
  ogx: "application/ogg",
  opus: "audio/opus",
  otf: "font/otf",
  pdf: "application/pdf",
  png: "image/png",
  rtf: "application/rtf",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  ts: "video/mp2t",
  ttf: "font/ttf",
  txt: "text/plain",
  wasm: "application/wasm",
  webm: "video/webm",
  weba: "audio/webm",
  webmanifest: "application/manifest+json",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xhtml: "application/xhtml+xml",
  xml: "application/xml",
  zip: "application/zip",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  gltf: "model/gltf+json",
  glb: "model/gltf-binary"
};
var baseMimes = _baseMimes;

// node_modules/@hono/node-server/dist/serve-static.mjs
import { createReadStream, statSync, existsSync } from "fs";
import { join } from "path";
import { versions } from "process";
import { Readable as Readable2 } from "stream";
var COMPRESSIBLE_CONTENT_TYPE_REGEX = /^\s*(?:text\/[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i;
var ENCODINGS = {
  br: ".br",
  zstd: ".zst",
  gzip: ".gz"
};
var ENCODINGS_ORDERED_KEYS = Object.keys(ENCODINGS);
var pr54206Applied = () => {
  const [major, minor] = versions.node.split(".").map((component) => parseInt(component));
  return major >= 23 || major === 22 && minor >= 7 || major === 20 && minor >= 18;
};
var useReadableToWeb = pr54206Applied();
var createStreamBody = (stream) => {
  if (useReadableToWeb) {
    return Readable2.toWeb(stream);
  }
  const body = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => {
        controller.enqueue(chunk);
      });
      stream.on("error", (err) => {
        controller.error(err);
      });
      stream.on("end", () => {
        controller.close();
      });
    },
    cancel() {
      stream.destroy();
    }
  });
  return body;
};
var getStats = (path) => {
  let stats;
  try {
    stats = statSync(path);
  } catch {
  }
  return stats;
};
var tryDecode = (str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
};
var tryDecodeURI = (str) => tryDecode(str, decodeURI);
var serveStatic = (options = { root: "" }) => {
  const root = options.root || "";
  const optionPath = options.path;
  if (root !== "" && !existsSync(root)) {
    console.error(`serveStatic: root path '${root}' is not found, are you sure it's correct?`);
  }
  return async (c, next) => {
    if (c.finalized) {
      return next();
    }
    let filename;
    if (optionPath) {
      filename = optionPath;
    } else {
      try {
        filename = tryDecodeURI(c.req.path);
        if (/(?:^|[\/\\])\.\.(?:$|[\/\\])/.test(filename)) {
          throw new Error();
        }
      } catch {
        await options.onNotFound?.(c.req.path, c);
        return next();
      }
    }
    let path = join(
      root,
      !optionPath && options.rewriteRequestPath ? options.rewriteRequestPath(filename, c) : filename
    );
    let stats = getStats(path);
    if (stats && stats.isDirectory()) {
      const indexFile = options.index ?? "index.html";
      path = join(path, indexFile);
      stats = getStats(path);
    }
    if (!stats) {
      await options.onNotFound?.(path, c);
      return next();
    }
    const mimeType = getMimeType(path);
    c.header("Content-Type", mimeType || "application/octet-stream");
    if (options.precompressed && (!mimeType || COMPRESSIBLE_CONTENT_TYPE_REGEX.test(mimeType))) {
      const acceptEncodingSet = new Set(
        c.req.header("Accept-Encoding")?.split(",").map((encoding) => encoding.trim())
      );
      for (const encoding of ENCODINGS_ORDERED_KEYS) {
        if (!acceptEncodingSet.has(encoding)) {
          continue;
        }
        const precompressedStats = getStats(path + ENCODINGS[encoding]);
        if (precompressedStats) {
          c.header("Content-Encoding", encoding);
          c.header("Vary", "Accept-Encoding", { append: true });
          stats = precompressedStats;
          path = path + ENCODINGS[encoding];
          break;
        }
      }
    }
    let result;
    const size = stats.size;
    const range = c.req.header("range") || "";
    if (c.req.method == "HEAD" || c.req.method == "OPTIONS") {
      c.header("Content-Length", size.toString());
      c.status(200);
      result = c.body(null);
    } else if (!range) {
      c.header("Content-Length", size.toString());
      result = c.body(createStreamBody(createReadStream(path)), 200);
    } else {
      c.header("Accept-Ranges", "bytes");
      c.header("Date", stats.birthtime.toUTCString());
      const parts = range.replace(/bytes=/, "").split("-", 2);
      const start = parseInt(parts[0], 10) || 0;
      let end = parseInt(parts[1], 10) || size - 1;
      if (size < end - start + 1) {
        end = size - 1;
      }
      const chunksize = end - start + 1;
      const stream = createReadStream(path, { start, end });
      c.header("Content-Length", chunksize.toString());
      c.header("Content-Range", `bytes ${start}-${end}/${stats.size}`);
      result = c.body(createStreamBody(stream), 206);
    }
    await options.onFound?.(path, c);
    return result;
  };
};

// src/worker/server.ts
import { existsSync as existsSync6, readFileSync as readFileSync3 } from "fs";
import { join as join4, dirname } from "path";
import { fileURLToPath } from "url";

// node_modules/hono/dist/compose.js
var compose = (middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
  };
};

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/body.js
var parseBody = async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
};
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
var handleParsingAllValues = (form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
};
var handleParsingNestedValues = (form, key, value) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
};

// node_modules/hono/dist/utils/url.js
var splitPath = (path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
};
var splitRoutingPath = (routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
};
var extractGroupsFromPath = (path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
};
var replaceGroupMarks = (paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
};
var patternCache = {};
var getPattern = (label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey2 = `${label}#${next}`;
    if (!patternCache[cacheKey2]) {
      if (match2[2]) {
        patternCache[cacheKey2] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey2, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey2] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey2];
  }
  return null;
};
var tryDecode2 = (str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
};
var tryDecodeURI2 = (str) => tryDecode2(str, decodeURI);
var getPath = (request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI2(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
};
var getPathNoStrict = (request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
};
var mergePath = (base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
};
var checkOptionalParameter = (path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
};
var _decodeURI = (value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode2(value, decodeURIComponent_) : value;
};
var _getQueryParam = (url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
};
var getQueryParam = _getQueryParam;
var getQueryParams = (url, key) => {
  return _getQueryParam(url, key, true);
};
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var tryDecodeURIComponent = (str) => tryDecode2(str, decodeURIComponent_);
var HonoRequest = class {
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = (key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  };
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
};
var resolveCallback = async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
};

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = (contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
};
var createResponseInstance = (body, init) => new Response(body, init);
var Context = class {
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = (layout) => this.#layout = layout;
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = () => this.#layout;
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = (name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  };
  status = (status) => {
    this.#status = status;
  };
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  };
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = (key) => {
    return this.#var ? this.#var.get(key) : void 0;
  };
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, { status, headers: responseHeaders });
  }
  newResponse = (...args) => this.#newResponse(...args);
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  };
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = (object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  };
  html = (html, arg, headers) => {
    const res = (html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers));
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = (location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  };
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = () => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  };
};

// node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = (c) => {
  return c.text("404 Not Found", 404);
};
var errorHandler = (err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
};
var Hono = class _Hono {
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res;
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = (handler) => {
    this.errorHandler = handler;
    return this;
  };
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = (handler) => {
    this.#notFoundHandler = handler;
    return this;
  };
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = (request) => request;
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    };
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = { basePath: this._basePath, path, method, handler };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  };
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  };
};

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = ((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  });
  this.match = match2;
  return match2(method, path);
}

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
var Node = class _Node {
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node();
        if (name !== "") {
          node.#varIndex = context.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node();
      }
    }
    node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
var RegExpRouter = class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = (children) => {
  for (const _ in children) {
    return true;
  }
  return false;
};
var Node2 = class _Node2 {
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// src/db/database.ts
import Database from "better-sqlite3";
import { getLoadablePath } from "sqlite-vec";

// src/utils/paths.ts
import { existsSync as existsSync2, mkdirSync } from "fs";
import { join as join2 } from "path";
import { homedir } from "os";
var DATA_DIR = join2(homedir(), ".memory-lite");
function getDataDir() {
  if (!existsSync2(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  return DATA_DIR;
}
function getDbPath() {
  return join2(getDataDir(), "data.db");
}
function getPidPath() {
  return join2(getDataDir(), "worker.pid");
}
function getSettingsPath() {
  return join2(getDataDir(), "settings.json");
}
function getLogPath() {
  return join2(getDataDir(), "worker.log");
}

// src/utils/logger.ts
import { appendFileSync } from "fs";
var logPath = null;
function getPath2() {
  if (!logPath) logPath = getLogPath();
  return logPath;
}
function timestamp() {
  const d = /* @__PURE__ */ new Date();
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
function write(level, component, message, data) {
  const parts = [`[${timestamp()}]`, `[${level.padEnd(5)}]`, `[${component}]`, message];
  if (data !== void 0) {
    try {
      parts.push(typeof data === "string" ? data : JSON.stringify(data));
    } catch {
    }
  }
  const line = parts.join(" ") + "\n";
  try {
    appendFileSync(getPath2(), line);
  } catch {
    process.stderr.write(line);
  }
}
var logger = {
  debug: (component, message, data) => write("DEBUG", component, message, data),
  info: (component, message, data) => write("INFO", component, message, data),
  warn: (component, message, data) => write("WARN", component, message, data),
  error: (component, message, data) => write("ERROR", component, message, data)
};

// src/db/database.ts
var db = null;
var dbReady = false;
function isDbReady() {
  return dbReady;
}
var SCHEMA_VERSION = 3;
var SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_session_id TEXT UNIQUE NOT NULL,
  project TEXT NOT NULL,
  user_prompt TEXT,
  memory_session_id TEXT,
  status TEXT CHECK(status IN ('active','completed')) NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at_epoch DESC);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  facts TEXT,
  narrative TEXT,
  files_read TEXT,
  files_modified TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_session ON observations(session_id);
CREATE INDEX IF NOT EXISTS idx_obs_project ON observations(project, created_at_epoch DESC);
CREATE INDEX IF NOT EXISTS idx_obs_hash ON observations(content_hash, created_at_epoch);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  request TEXT,
  investigated TEXT,
  learned TEXT,
  completed TEXT,
  next_steps TEXT,
  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sum_project ON summaries(project, created_at_epoch DESC);

CREATE TABLE IF NOT EXISTS pending_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('observation','summary')),
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing')),
  created_at_epoch INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pm_session ON pending_messages(content_session_id, status);

CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  title, narrative, facts,
  content='observations', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, title, narrative, facts)
  VALUES (new.id, new.title, new.narrative, new.facts);
END;

CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, narrative, facts)
  VALUES ('delete', old.id, old.title, old.narrative, old.facts);
END;

CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, narrative, facts)
  VALUES ('delete', old.id, old.title, old.narrative, old.facts);
  INSERT INTO observations_fts(rowid, title, narrative, facts)
  VALUES (new.id, new.title, new.narrative, new.facts);
END;
`;
var MIGRATIONS = {
  3: (db2) => {
    db2.exec(`
      CREATE TABLE IF NOT EXISTS summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );
      INSERT INTO summaries_new SELECT * FROM summaries;
      DROP TABLE summaries;
      ALTER TABLE summaries_new RENAME TO summaries;
      CREATE INDEX IF NOT EXISTS idx_sum_project ON summaries(project, created_at_epoch DESC);
      CREATE INDEX IF NOT EXISTS idx_sum_session ON summaries(session_id);
    `);
  }
};
function initializeSchema(database) {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("cache_size = 10000");
  database.pragma("busy_timeout = 5000");
  database.pragma("mmap_size = 268435456");
  let currentVersion = 0;
  try {
    const row = database.prepare("SELECT version FROM schema_version LIMIT 1").get();
    currentVersion = row?.version || 0;
  } catch {
  }
  if (currentVersion < 1) {
    database.exec(SCHEMA_SQL);
    currentVersion = SCHEMA_VERSION;
  }
  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (migrate) {
      migrate(database);
    }
  }
  database.prepare("INSERT OR REPLACE INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
}
function tryLoadSqliteVec(database) {
  try {
    database.loadExtension(getLoadablePath());
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS observations_vec USING vec0(
        observation_id INTEGER PRIMARY KEY,
        embedding float[1024]
      )
    `);
    logger.info("db", "sqlite-vec loaded successfully");
  } catch (err) {
    logger.info("db", "sqlite-vec not available \u2014 semantic search disabled, FTS5 still works");
  }
}
function getDb() {
  if (db) return db;
  getDataDir();
  db = new Database(getDbPath());
  initializeSchema(db);
  tryLoadSqliteVec(db);
  dbReady = true;
  return db;
}
function closeDb() {
  if (db) {
    db.close();
    db = null;
    dbReady = false;
  }
}

// src/utils/hash.ts
import { createHash } from "crypto";
function computeContentHash(sessionId, title, narrative) {
  return createHash("sha256").update((sessionId || "") + (title || "") + (narrative || "")).digest("hex").slice(0, 16);
}

// src/db/queries.ts
var DEDUP_WINDOW_MS = 3e4;
function createSession(contentSessionId, project, prompt) {
  const db2 = getDb();
  const now = Date.now();
  const iso = new Date(now).toISOString();
  db2.prepare(
    `INSERT OR IGNORE INTO sessions (content_session_id, project, user_prompt, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?)`
  ).run(contentSessionId, project, prompt || null, iso, now);
  if (prompt) {
    db2.prepare(
      `UPDATE sessions SET user_prompt = ? WHERE content_session_id = ? AND user_prompt IS NULL`
    ).run(prompt, contentSessionId);
  }
  return db2.prepare("SELECT * FROM sessions WHERE content_session_id = ?").get(contentSessionId);
}
function completeSession(contentSessionId) {
  getDb().prepare(
    `UPDATE sessions SET status = 'completed' WHERE content_session_id = ?`
  ).run(contentSessionId);
}
function getSessionByContentId(contentSessionId) {
  return getDb().prepare("SELECT * FROM sessions WHERE content_session_id = ?").get(contentSessionId);
}
function setMemorySessionId(contentSessionId, memorySessionId) {
  getDb().prepare(
    "UPDATE sessions SET memory_session_id = ? WHERE content_session_id = ?"
  ).run(memorySessionId, contentSessionId);
}
function getMemorySessionId(contentSessionId) {
  const row = getDb().prepare(
    "SELECT memory_session_id FROM sessions WHERE content_session_id = ?"
  ).get(contentSessionId);
  return row?.memory_session_id || null;
}
function storeObservation(sessionId, project, obs, contentSessionId) {
  const db2 = getDb();
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const contentHash = computeContentHash(contentSessionId, obs.title, obs.narrative);
  const existing = db2.prepare(
    "SELECT id FROM observations WHERE content_hash = ? AND created_at_epoch > ?"
  ).get(contentHash, now - DEDUP_WINDOW_MS);
  if (existing) {
    return { id: existing.id, deduplicated: true };
  }
  const result = db2.prepare(
    `INSERT INTO observations (session_id, project, type, title, facts, narrative, files_read, files_modified, content_hash, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    project,
    obs.type,
    obs.title,
    JSON.stringify(obs.facts),
    obs.narrative,
    JSON.stringify(obs.files_read),
    JSON.stringify(obs.files_modified),
    contentHash,
    iso,
    now
  );
  return { id: Number(result.lastInsertRowid), deduplicated: false };
}
function getRecentObservations(project, limit) {
  return getDb().prepare(
    "SELECT * FROM observations WHERE project = ? ORDER BY created_at_epoch DESC LIMIT ?"
  ).all(project, limit);
}
function storeSummary(sessionId, project, summary) {
  const result = getDb().prepare(
    `INSERT INTO summaries (session_id, project, request, investigated, learned, completed, next_steps, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    project,
    summary.request,
    summary.investigated,
    summary.learned,
    summary.completed,
    summary.next_steps,
    (/* @__PURE__ */ new Date()).toISOString(),
    Date.now()
  );
  return Number(result.lastInsertRowid);
}
function getRecentSummaries(project, limit) {
  return getDb().prepare(
    "SELECT * FROM summaries WHERE project = ? ORDER BY created_at_epoch DESC LIMIT ?"
  ).all(project, limit);
}
var MAX_FTS_TOKENS = 32;
function sanitizeFtsQuery(query3) {
  const cleaned = query3.replace(/["\u201C\u201D]/g, "");
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0).slice(0, MAX_FTS_TOKENS);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(" ");
}
function searchObservationsFts(query3, project, limit = 10) {
  const db2 = getDb();
  const safeQuery = sanitizeFtsQuery(query3);
  if (project) {
    return db2.prepare(
      `SELECT o.id, o.title, o.narrative, o.facts, o.project, o.created_at, f.rank
       FROM observations_fts f
       JOIN observations o ON o.id = f.rowid
       WHERE observations_fts MATCH ? AND o.project = ?
       ORDER BY f.rank
       LIMIT ?`
    ).all(safeQuery, project, limit);
  }
  return db2.prepare(
    `SELECT o.id, o.title, o.narrative, o.facts, o.project, o.created_at, f.rank
     FROM observations_fts f
     JOIN observations o ON o.id = f.rowid
     WHERE observations_fts MATCH ?
     ORDER BY f.rank
     LIMIT ?`
  ).all(safeQuery, limit);
}
function searchObservationsIndex(filters) {
  const db2 = getDb();
  const limit = filters.limit || 20;
  const offset = filters.offset || 0;
  const conditions = ["observations_fts MATCH ?"];
  const params = [sanitizeFtsQuery(filters.query)];
  if (filters.project) {
    conditions.push("o.project = ?");
    params.push(filters.project);
  }
  if (filters.type) {
    conditions.push("o.type = ?");
    params.push(filters.type);
  }
  if (filters.dateStart) {
    conditions.push("o.created_at >= ?");
    params.push(filters.dateStart);
  }
  if (filters.dateEnd) {
    conditions.push("o.created_at <= ?");
    params.push(filters.dateEnd);
  }
  params.push(limit, offset);
  return db2.prepare(
    `SELECT o.id, o.type, o.title, o.narrative, o.facts, o.created_at, f.rank
     FROM observations_fts f
     JOIN observations o ON o.id = f.rowid
     WHERE ${conditions.join(" AND ")}
     ORDER BY f.rank
     LIMIT ? OFFSET ?`
  ).all(...params);
}
function getObservationsByIds(ids) {
  if (ids.length === 0) return [];
  const db2 = getDb();
  const placeholders = ids.map(() => "?").join(",");
  return db2.prepare(
    `SELECT * FROM observations WHERE id IN (${placeholders}) ORDER BY created_at_epoch ASC`
  ).all(...ids);
}
function deleteObservation(id) {
  const db2 = getDb();
  try {
    db2.prepare("DELETE FROM observations_vec WHERE observation_id = ?").run(id);
  } catch {
  }
  const result = db2.prepare("DELETE FROM observations WHERE id = ?").run(id);
  return result.changes > 0;
}
function deleteSummary(id) {
  const result = getDb().prepare("DELETE FROM summaries WHERE id = ?").run(id);
  return result.changes > 0;
}
function deleteSession(id) {
  const db2 = getDb();
  try {
    db2.prepare("DELETE FROM observations_vec WHERE observation_id IN (SELECT id FROM observations WHERE session_id = ?)").run(id);
  } catch {
  }
  const result = db2.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  return result.changes > 0;
}
function getTimelineAroundObservation(anchorId, depthBefore = 5, depthAfter = 5, project) {
  const db2 = getDb();
  const anchor = db2.prepare("SELECT * FROM observations WHERE id = ?").get(anchorId);
  if (!anchor) return { anchor: null, before: [], after: [] };
  const projectFilter = project ? "AND project = ?" : "";
  const projectParams = project ? [project] : [];
  const before = db2.prepare(
    `SELECT * FROM observations
     WHERE created_at_epoch < ? ${projectFilter}
     ORDER BY created_at_epoch DESC LIMIT ?`
  ).all(anchor.created_at_epoch, ...projectParams, depthBefore);
  const after = db2.prepare(
    `SELECT * FROM observations
     WHERE created_at_epoch > ? ${projectFilter}
     ORDER BY created_at_epoch ASC LIMIT ?`
  ).all(anchor.created_at_epoch, ...projectParams, depthAfter);
  return { anchor, before: before.reverse(), after };
}

// src/worker/summarizer.ts
import { query } from "@anthropic-ai/claude-agent-sdk";

// src/worker/xml-parser.ts
function extractField(content, fieldName) {
  const regex = new RegExp(`<${fieldName}>([\\s\\S]*?)</${fieldName}>`);
  const match2 = regex.exec(content);
  if (!match2) return null;
  const trimmed = match2[1].trim();
  return trimmed === "" ? null : trimmed;
}
function extractArray(content, arrayName, elementName) {
  const arrayRegex = new RegExp(`<${arrayName}>([\\s\\S]*?)</${arrayName}>`);
  const arrayMatch = arrayRegex.exec(content);
  if (!arrayMatch) return [];
  const elements = [];
  const elementRegex = new RegExp(`<${elementName}>([\\s\\S]*?)</${elementName}>`, "g");
  let match2;
  while ((match2 = elementRegex.exec(arrayMatch[1])) !== null) {
    const trimmed = match2[1].trim();
    if (trimmed) elements.push(trimmed);
  }
  return elements;
}
var VALID_TYPES = /* @__PURE__ */ new Set(["bugfix", "feature", "refactor", "discovery", "decision", "change", "skip"]);
function parseObservationXml(text) {
  const obsRegex = /<observation>([\s\S]*?)<\/observation>/;
  const match2 = obsRegex.exec(text);
  if (!match2) return null;
  const content = match2[1];
  const rawType = extractField(content, "type") || "discovery";
  const type = VALID_TYPES.has(rawType) ? rawType : (() => {
    logger.warn("xml-parser", `Unknown observation type "${rawType}", defaulting to "discovery"`);
    return "discovery";
  })();
  return {
    type,
    title: extractField(content, "title"),
    facts: extractArray(content, "facts", "fact"),
    narrative: extractField(content, "narrative"),
    files_read: extractArray(content, "files_read", "file"),
    files_modified: extractArray(content, "files_modified", "file")
  };
}
function parseSummaryXml(text) {
  const summaryRegex = /<summary>([\s\S]*?)<\/summary>/;
  const match2 = summaryRegex.exec(text);
  if (!match2) return null;
  const content = match2[1];
  return {
    request: extractField(content, "request"),
    investigated: extractField(content, "investigated"),
    learned: extractField(content, "learned"),
    completed: extractField(content, "completed"),
    next_steps: extractField(content, "next_steps")
  };
}

// src/worker/prompts.ts
var OBSERVER_SYSTEM_PROMPT = `You are a specialized observer creating searchable memory FOR FUTURE SESSIONS.

CRITICAL: Record what was LEARNED/BUILT/FIXED/DEPLOYED/CONFIGURED, not what you (the observer) are doing.

You do not have access to tools. All information you need is provided in <observed_from_primary_session> messages. Create observations from what you observe \u2014 no investigation needed.

Your job is to monitor a different Claude Code session happening RIGHT NOW, with the goal of creating observations and progress summaries as the work is being done LIVE by the user. You are NOT the one doing the work \u2014 you are ONLY observing and recording.

WHAT TO RECORD
--------------
Focus on deliverables and capabilities:
- What the system NOW DOES differently (new capabilities)
- What shipped to users/production (features, fixes, configs, docs)
- Bugs found with root cause analysis
- Non-obvious gotchas and workarounds
- Architecture decisions with rationale
- API behaviors or quirks discovered

Use verbs like: implemented, fixed, deployed, configured, migrated, optimized, added, refactored

GOOD: "Authentication now supports OAuth2 with PKCE flow"
GOOD: "Worker crashes because sqlite-vec isn't loaded before query \u2014 fixed by moving loadExtension to init"
BAD: "Analyzed authentication implementation and stored findings"
BAD: "File X was read" / "Function Y was added"

WHEN TO SKIP
------------
Skip routine operations \u2014 output nothing if:
- Empty status checks or simple file listings
- Package installations with no errors
- Repetitive operations you've already documented
- File reads that reveal nothing surprising
- Routine edits (import changes, formatting, config tweaks)
- CSS/style-only changes
- Removing debug/logging statements

**No output necessary if skipping.**

OBSERVATION TYPES (use exactly one):
- bugfix: something was broken, now fixed
- feature: new capability added
- refactor: code restructured, behavior unchanged
- discovery: learning about existing system (only if non-obvious insight)
- decision: architectural/design choice with rationale
- change: generic modification (docs, config, misc)

OUTPUT FORMAT
-------------
\`\`\`xml
<observation>
  <type>bugfix | feature | refactor | discovery | decision | change</type>
  <title>Short title capturing the core action (5-10 words)</title>
  <facts>
    <fact>Concise self-contained statement with specifics (filenames, values)</fact>
    <fact>Another specific fact</fact>
  </facts>
  <narrative>What was done, how it works, why it matters (2-3 sentences)</narrative>
  <files_read>
    <file>path/to/file</file>
  </files_read>
  <files_modified>
    <file>path/to/file</file>
  </files_modified>
</observation>
\`\`\`

IMPORTANT: Never reference yourself or your own actions. Do not output anything other than the observation XML. Spend your tokens wisely on useful observations. If there's nothing worth recording, output nothing.`;
var OBSERVATION_EXTRACTION_PROMPT = `You observe a Claude Code session and extract structured observations for FUTURE sessions.

WHAT TO RECORD \u2014 focus on deliverables and knowledge:
- What the system NOW DOES differently (new capabilities, fixes, configs)
- Bugs found with root cause ("X broke because Y")
- Non-obvious gotchas and workarounds
- Architecture decisions with rationale
- API behaviors or quirks discovered

WHEN TO SKIP \u2014 output nothing if the tool use is:
- Empty status checks, simple file listings, package installs with no errors
- Repetitive operations already documented
- File reads that reveal nothing surprising
- Routine edits with no interesting context (import changes, formatting)
If skipping, output ONLY: <observation><type>skip</type></observation>

TYPES:
- bugfix: something was broken, now fixed
- feature: new capability added
- refactor: code restructured, behavior unchanged
- discovery: learning about existing system (only if non-obvious insight)
- decision: architectural/design choice with rationale
- change: generic modification (docs, config, misc)

FORMAT:
\`\`\`xml
<observation>
  <type>bugfix | feature | refactor | discovery | decision | change</type>
  <title>Short title capturing the core action (5-10 words)</title>
  <facts>
    <fact>Concise self-contained statement with specifics (filenames, values, behaviors)</fact>
  </facts>
  <narrative>What was done, how it works, why it matters (2-3 sentences)</narrative>
  <files_read>
    <file>path/to/file</file>
  </files_read>
  <files_modified>
    <file>path/to/file</file>
  </files_modified>
</observation>
\`\`\`

CRITICAL RULES:
- Record what was LEARNED/BUILT/FIXED, not that you are observing
- NO generic titles like "File X was read" or "Function Y was added" \u2014 capture the INSIGHT
- facts must be specific and self-contained (no pronouns, include file paths and values)
- Output ONLY the XML block, nothing else`;
var SUMMARY_SYSTEM_PROMPT = `You are a development session summarizer. Given the last assistant message from a coding session, produce a structured summary.

Output format:
\`\`\`xml
<summary>
  <request>What the user originally asked for</request>
  <investigated>What was explored or researched</investigated>
  <learned>Key findings or discoveries</learned>
  <completed>What was actually done/implemented</completed>
  <next_steps>What remains to be done</next_steps>
</summary>
\`\`\`

Rules:
- Be concise (1-3 sentences per field)
- Focus on actionable information
- Output ONLY the XML block, nothing else`;
var CLEANUP_SYSTEM_PROMPT = `You are an extremely aggressive memory quality filter. Your job is to DELETE everything that won't help a developer in a FUTURE session. Only KEEP observations that contain genuinely actionable technical knowledge.

DELETE (the vast majority of items should be deleted):
- "X was added/created/updated/modified" \u2014 knowing a file was edited is useless, the code itself is the source of truth
- "Build succeeded/failed" \u2014 ephemeral build status
- "Task/plan created/updated/completed" \u2014 meta-tooling noise
- "Tool search performed", "Dependencies found", "File structure explored" \u2014 discovery that leads nowhere specific
- "Plugin installed/uninstalled", "Worker started/restarted" \u2014 operational noise
- Self-referential observations about the memory plugin itself being developed (unless they contain a real gotcha)
- Summaries of sessions where nothing meaningful was accomplished
- Anything where the title alone tells you everything and there's no deeper insight
- "X function/component/route was implemented" \u2014 the code exists, no need to remember it was created
- Redundant entries that repeat information from other items
- CSS/style changes, import changes, config tweaks \u2014 trivial mechanical edits

KEEP (only if they contain specific technical knowledge you can't easily re-derive):
- Bugs found with root cause analysis ("X broke because Y")
- Non-obvious gotchas and workarounds ("matcher must be * because resume sessions are missed")
- Architecture decisions with rationale ("chose Hono over Express because ESM compatibility")
- API behaviors or quirks discovered ("Agent SDK doesn't stream tokens despite includePartialMessages")
- Integration issues between systems
- Performance findings with specifics

When in doubt, DELETE. A smaller, high-signal context is far more valuable than a large noisy one.

Output format (one line per item, in order):
<decisions>
<item id="ID">KEEP|DELETE: reason</item>
</decisions>`;
function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "... [truncated]";
}
function buildInitPrompt(project, userPrompt) {
  return `${OBSERVER_SYSTEM_PROMPT}

MEMORY PROCESSING START
=======================
Session started for project: ${project}
${userPrompt ? `User request: ${userPrompt}` : ""}`;
}
function buildObservationPrompt(toolName, toolInput, toolResponse, cwd) {
  return `<observed_from_primary_session>
  <what_happened>${toolName}</what_happened>
  <occurred_at>${(/* @__PURE__ */ new Date()).toISOString()}</occurred_at>${cwd ? `
  <working_directory>${cwd}</working_directory>` : ""}
  <parameters>${truncate(toolInput, 2e3)}</parameters>
  <outcome>${truncate(toolResponse, 3e3)}</outcome>
</observed_from_primary_session>`;
}
function buildSummaryPrompt(lastAssistantMessage) {
  return `--- MODE SWITCH: PROGRESS SUMMARY ---
Do NOT output <observation> tags. This is a summary request, not an observation request.
Your response MUST use <summary> tags ONLY.

Write progress notes of what was done, what was learned, and what's next.

Claude's Full Response to User:
${truncate(lastAssistantMessage, 5e3)}

Respond in this XML format:
<summary>
  <request>What the user originally asked for</request>
  <investigated>What was explored or researched</investigated>
  <learned>Key findings or discoveries</learned>
  <completed>What was actually done/implemented</completed>
  <next_steps>What remains to be done</next_steps>
</summary>

Output ONLY the summary XML, nothing else.`;
}

// src/worker/summarizer.ts
async function runQuery(systemPrompt, userMessage) {
  try {
    const conversation = query({
      prompt: userMessage,
      options: {
        model: "claude-sonnet-4-6",
        systemPrompt,
        maxTurns: 1,
        tools: []
        // no tools — pure text generation
      }
    });
    let resultText = "";
    for await (const message of conversation) {
      if (message.type === "result" && message.subtype === "success") {
        resultText = message.result;
      }
    }
    return resultText || null;
  } catch (error) {
    logger.error("summarizer", "Agent SDK query failed", error);
    return null;
  }
}
async function extractObservation(toolName, toolInput, toolResponse, cwd) {
  const userMessage = `Tool: ${toolName}
Working directory: ${cwd || "unknown"}
Input: ${truncate(toolInput, 2e3)}
Output: ${truncate(toolResponse, 3e3)}`;
  const text = await runQuery(OBSERVATION_EXTRACTION_PROMPT, userMessage);
  if (!text) return null;
  return parseObservationXml(text);
}
async function generateSummary(lastAssistantMessage) {
  const text = await runQuery(SUMMARY_SYSTEM_PROMPT, lastAssistantMessage);
  if (!text) return null;
  return parseSummaryXml(text);
}
async function reviewForCleanup(items) {
  if (items.length === 0) return [];
  const itemList = items.map(
    (i) => `[${i.type}#${i.id}] ${i.text}`
  ).join("\n\n");
  const text = await runQuery(CLEANUP_SYSTEM_PROMPT, itemList);
  if (!text) return [];
  return parseCleanupResults(text, items);
}
function parseCleanupResults(text, items) {
  const results = [];
  const itemRegex = /<item id="(?:(?:observation|summary)#)?(\d+)">(KEEP|DELETE):\s*(.*?)<\/item>/g;
  let match2;
  while ((match2 = itemRegex.exec(text)) !== null) {
    const id = parseInt(match2[1]);
    const item = items.find((i) => i.id === id);
    if (item) {
      results.push({
        id,
        type: item.type,
        action: match2[2].toLowerCase(),
        reason: match2[3].trim()
      });
    }
  }
  return results;
}

// src/worker/observer.ts
import { execSync } from "child_process";
import { existsSync as existsSync4, mkdirSync as mkdirSync2 } from "fs";
import { join as join3 } from "path";
import { homedir as homedir2 } from "os";
import { query as query2 } from "@anthropic-ai/claude-agent-sdk";

// src/worker/durable-queue.ts
import { EventEmitter } from "events";

// src/db/pending-store.ts
var STUCK_TIMEOUT_MS = 6e4;
var MAX_PENDING_PER_SESSION = 200;
function enqueuePending(contentSessionId, kind, prompt) {
  const db2 = getDb();
  const count = getPendingCount(contentSessionId);
  if (count >= MAX_PENDING_PER_SESSION) {
    db2.prepare(
      "DELETE FROM pending_messages WHERE id IN (SELECT id FROM pending_messages WHERE content_session_id = ? ORDER BY id ASC LIMIT 1)"
    ).run(contentSessionId);
  }
  const result = db2.prepare(
    "INSERT INTO pending_messages (content_session_id, kind, prompt, created_at_epoch) VALUES (?, ?, ?, ?)"
  ).run(contentSessionId, kind, prompt, Date.now());
  return Number(result.lastInsertRowid);
}
function claimNextPending(contentSessionId) {
  const db2 = getDb();
  db2.prepare(
    "UPDATE pending_messages SET status = ? WHERE content_session_id = ? AND status = ? AND created_at_epoch < ?"
  ).run("pending", contentSessionId, "processing", Date.now() - STUCK_TIMEOUT_MS);
  const msg = db2.transaction(() => {
    const row = db2.prepare(
      "SELECT * FROM pending_messages WHERE content_session_id = ? AND status = ? ORDER BY id ASC LIMIT 1"
    ).get(contentSessionId, "pending");
    if (!row) return null;
    db2.prepare("UPDATE pending_messages SET status = ?, created_at_epoch = ? WHERE id = ?").run("processing", Date.now(), row.id);
    return { ...row, status: "processing" };
  })();
  return msg;
}
function deletePending(id) {
  getDb().prepare("DELETE FROM pending_messages WHERE id = ?").run(id);
}
function forceUnstickAll(contentSessionId) {
  return getDb().prepare(
    "UPDATE pending_messages SET status = ? WHERE content_session_id = ? AND status = ?"
  ).run("pending", contentSessionId, "processing").changes;
}
function getPendingCount(contentSessionId) {
  const row = getDb().prepare(
    "SELECT COUNT(*) as count FROM pending_messages WHERE content_session_id = ?"
  ).get(contentSessionId);
  return row.count;
}
function forceUnstickAllGlobal() {
  return getDb().prepare(
    "UPDATE pending_messages SET status = 'pending' WHERE status = 'processing'"
  ).run().changes;
}
function getSessionsWithPendingMessages() {
  const rows = getDb().prepare(
    "SELECT DISTINCT content_session_id FROM pending_messages"
  ).all();
  return rows.map((r) => r.content_session_id);
}

// src/worker/durable-queue.ts
var IDLE_TIMEOUT_MS = 3 * 60 * 1e3;
var DurableQueue = class {
  emitter = new EventEmitter();
  closed = false;
  contentSessionId;
  signal;
  constructor(contentSessionId, signal) {
    this.contentSessionId = contentSessionId;
    this.signal = signal;
  }
  push(kind, prompt) {
    const id = enqueuePending(this.contentSessionId, kind, prompt);
    this.emitter.emit("message");
    return id;
  }
  close() {
    this.closed = true;
    this.emitter.emit("message");
  }
  async *[Symbol.asyncIterator]() {
    let iterCount = 0;
    while (!this.closed && !this.signal?.aborted) {
      iterCount++;
      let msg = null;
      try {
        msg = claimNextPending(this.contentSessionId);
      } catch (err) {
        logger.error("queue", `Error claiming message (iter=${iterCount}), backing off`, err);
        await new Promise((resolve) => setTimeout(resolve, 1e3));
        continue;
      }
      if (msg) {
        logger.info("queue", `Claimed message id=${msg.id} kind=${msg.kind} (iter=${iterCount}) for ${this.contentSessionId}`);
        yield msg;
        continue;
      }
      logger.info("queue", `No pending messages, waiting (iter=${iterCount}) for ${this.contentSessionId}`);
      const gotMessage = await new Promise((resolve) => {
        const onMessage = () => {
          clearTimeout(timer);
          this.signal?.removeEventListener("abort", onAbort);
          resolve(true);
        };
        const onAbort = () => {
          clearTimeout(timer);
          this.emitter.removeListener("message", onMessage);
          resolve(false);
        };
        const timer = setTimeout(() => {
          this.emitter.removeListener("message", onMessage);
          this.signal?.removeEventListener("abort", onAbort);
          resolve(false);
        }, IDLE_TIMEOUT_MS);
        this.emitter.once("message", onMessage);
        this.signal?.addEventListener("abort", onAbort, { once: true });
      });
      if (!gotMessage) {
        if (this.signal?.aborted) {
          logger.info("queue", `Aborted signal received (iter=${iterCount}) for ${this.contentSessionId}`);
          break;
        }
        logger.info("queue", `Idle timeout, final check (iter=${iterCount}) for ${this.contentSessionId}`);
        const recovered = claimNextPending(this.contentSessionId);
        if (recovered) {
          logger.info("queue", `Recovered stuck message id=${recovered.id} (iter=${iterCount})`);
          yield recovered;
          continue;
        }
        logger.info("queue", `No stuck messages, exiting iterator for ${this.contentSessionId}`);
        break;
      }
    }
    logger.info("queue", `Iterator exited (iter=${iterCount}, closed=${this.closed}, aborted=${this.signal?.aborted}) for ${this.contentSessionId}`);
  }
};

// src/utils/settings.ts
import { existsSync as existsSync3, readFileSync, writeFileSync } from "fs";
var DEFAULTS = {
  WORKER_PORT: 37888,
  OBSERVATION_COUNT: 50,
  FULL_OBSERVATION_COUNT: 5,
  SUMMARY_COUNT: 3,
  OLLAMA_URL: "http://localhost:11434",
  OLLAMA_MODEL: "bge-m3",
  SKIP_TOOLS: "Read,Glob,Grep,LSP"
};
var cached = null;
function getSettings() {
  if (cached) return cached;
  const path = getSettingsPath();
  if (!existsSync3(path)) {
    writeFileSync(path, JSON.stringify(DEFAULTS, null, 2));
    cached = { ...DEFAULTS };
    return cached;
  }
  try {
    const raw2 = JSON.parse(readFileSync(path, "utf-8"));
    cached = { ...DEFAULTS, ...raw2 };
    return cached;
  } catch {
    cached = { ...DEFAULTS };
    return cached;
  }
}
function getSetting(key) {
  const envVal = process.env[`MEMORY_LITE_${key}`];
  if (envVal !== void 0) {
    const def = DEFAULTS[key];
    if (typeof def === "number") return Number(envVal);
    return envVal;
  }
  return getSettings()[key];
}
function getAllSettings() {
  return { ...getSettings() };
}
function updateSettings(partial) {
  const current = getSettings();
  const updated = { ...current, ...partial };
  const path = getSettingsPath();
  writeFileSync(path, JSON.stringify(updated, null, 2));
  cached = updated;
  return updated;
}

// src/embeddings/embeddings.ts
async function generateEmbedding(text) {
  const ollamaUrl = getSetting("OLLAMA_URL");
  const model = getSetting("OLLAMA_MODEL");
  try {
    const response = await fetch(`${ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text })
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.embeddings?.[0]) return null;
    return new Float32Array(data.embeddings[0]);
  } catch {
    return null;
  }
}
var EXPECTED_EMBEDDING_DIM = 1024;
function storeEmbedding(db2, observationId, embedding) {
  if (embedding.length !== EXPECTED_EMBEDDING_DIM) {
    logger.error("embeddings", `Dimension mismatch: got ${embedding.length}, expected ${EXPECTED_EMBEDDING_DIM}. Skipping storage.`);
    return false;
  }
  try {
    db2.prepare(
      "INSERT OR REPLACE INTO observations_vec (observation_id, embedding) VALUES (CAST(? AS INTEGER), vec_f32(?))"
    ).run(observationId, Buffer.from(embedding.buffer));
    return true;
  } catch (error) {
    logger.error("embeddings", "Failed to store embedding", error);
    return false;
  }
}
async function searchSemantic(db2, query3, limit = 10) {
  const embedding = await generateEmbedding(query3);
  if (!embedding) return [];
  try {
    const results = db2.prepare(
      `SELECT observation_id, distance
       FROM observations_vec
       WHERE embedding MATCH vec_f32(?)
       ORDER BY distance
       LIMIT ?`
    ).all(Buffer.from(embedding.buffer), limit);
    return results.map((r) => ({
      observationId: r.observation_id,
      distance: r.distance
    }));
  } catch (error) {
    logger.error("embeddings", "Semantic search failed", error);
    return [];
  }
}
async function embedObservation(db2, observationId, title, narrative, facts) {
  const parts = [];
  if (title) parts.push(title);
  if (narrative) parts.push(narrative);
  if (facts.length > 0) parts.push(facts.join(". "));
  const text = parts.join(" \u2014 ");
  if (!text) return false;
  const embedding = await generateEmbedding(text);
  if (!embedding) return false;
  return storeEmbedding(db2, observationId, embedding);
}

// src/worker/message-processor.ts
function processMessage(msg, text, contentSessionId, pendingResults) {
  if (msg.kind === "observation" && text) {
    processObservation(msg, text, contentSessionId, pendingResults);
  } else if (msg.kind === "summary" && text) {
    processSummary(msg, text, contentSessionId, pendingResults);
  } else {
    deletePending(msg.id);
    resolvePending(msg.id, null, pendingResults);
  }
}
function processObservation(msg, text, contentSessionId, pendingResults) {
  const parsed = parseObservationXml(text);
  if (parsed && parsed.type !== "skip") {
    const session = getSessionByContentId(contentSessionId);
    if (session) {
      try {
        const result = storeObservation(session.id, session.project, parsed, contentSessionId);
        deletePending(msg.id);
        if (!result.deduplicated) {
          embedObservation(getDb(), result.id, parsed.title, parsed.narrative, parsed.facts).catch((err) => logger.error("message-processor", "embedding failed", err));
        }
      } catch (err) {
        logger.error("message-processor", "Failed to store observation", err);
        return;
      }
    } else {
      deletePending(msg.id);
    }
  } else {
    deletePending(msg.id);
  }
  resolvePending(msg.id, parsed ?? null, pendingResults);
}
function processSummary(msg, text, contentSessionId, pendingResults) {
  const parsed = parseSummaryXml(text);
  if (parsed) {
    const session = getSessionByContentId(contentSessionId);
    if (session) {
      try {
        storeSummary(session.id, session.project, parsed);
        deletePending(msg.id);
      } catch (err) {
        logger.error("message-processor", "Failed to store summary", err);
        return;
      }
    } else {
      deletePending(msg.id);
    }
  } else {
    deletePending(msg.id);
  }
  resolvePending(msg.id, parsed ?? null, pendingResults);
}
function resolvePending(msgId, value, pendingResults) {
  const pending = pendingResults.get(msgId);
  if (pending) {
    pendingResults.delete(msgId);
    pending.resolve(value);
  }
}
function extractAssistantText(message) {
  const content = message?.message?.content;
  if (Array.isArray(content)) {
    return content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  }
  return typeof content === "string" ? content : "";
}

// src/worker/observer-registry.ts
var activeSessions = /* @__PURE__ */ new Map();
var creatingSessions = /* @__PURE__ */ new Set();
function registerObserver(contentSessionId, session) {
  activeSessions.set(contentSessionId, session);
}
function getOrCreateObserver(contentSessionId, project, userPrompt) {
  let session = activeSessions.get(contentSessionId);
  if (session && !session.isDestroyed()) return session;
  if (creatingSessions.has(contentSessionId)) {
    session = activeSessions.get(contentSessionId);
    if (session && !session.isDestroyed()) return session;
  }
  creatingSessions.add(contentSessionId);
  const staleMemorySessionId = getMemorySessionId(contentSessionId);
  if (staleMemorySessionId) {
    logger.warn("observer", `Discarding stale memorySessionId for ${contentSessionId} (SDK context lost on worker restart)`);
  }
  const hasPending = getPendingCount(contentSessionId) > 0;
  if (hasPending) {
    const unstuck = forceUnstickAll(contentSessionId);
    if (unstuck > 0) logger.info("observer", `Force-unstuck ${unstuck} messages for ${contentSessionId}`);
  }
  try {
    session = new ObserverSession(contentSessionId, project, userPrompt, null, 0, registerObserver);
    activeSessions.set(contentSessionId, session);
    logger.info("observer", `Created session for ${contentSessionId} (project: ${project})`);
    return session;
  } finally {
    creatingSessions.delete(contentSessionId);
  }
}
function getObserver(contentSessionId) {
  const session = activeSessions.get(contentSessionId);
  if (session?.isDestroyed()) {
    activeSessions.delete(contentSessionId);
    return void 0;
  }
  return session;
}
function destroyObserver(contentSessionId) {
  const session = activeSessions.get(contentSessionId);
  if (session) {
    session.destroy();
    activeSessions.delete(contentSessionId);
    logger.info("observer", `Destroyed session for ${contentSessionId}`);
  }
}
function destroyAllObservers() {
  for (const [, session] of activeSessions) {
    session.destroy();
  }
  activeSessions.clear();
}
function getActiveSessionIds() {
  return Array.from(activeSessions.keys());
}
function getSessionAge(contentSessionId) {
  const session = activeSessions.get(contentSessionId);
  if (!session) return Infinity;
  return Date.now() - session.lastActivityTime;
}

// src/worker/observer.ts
var OBSERVER_SESSIONS_DIR = join3(homedir2(), ".memory-lite", "observer-sessions");
function ensureObserverSessionsDir() {
  if (!existsSync4(OBSERVER_SESSIONS_DIR)) {
    mkdirSync2(OBSERVER_SESSIONS_DIR, { recursive: true });
  }
  return OBSERVER_SESSIONS_DIR;
}
var cachedClaudePath = null;
function findClaudeExecutable() {
  if (cachedClaudePath) return cachedClaudePath;
  try {
    cachedClaudePath = execSync("which claude", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim().split("\n")[0].trim();
    if (cachedClaudePath) {
      logger.info("observer", `Found claude executable: ${cachedClaudePath}`);
      return cachedClaudePath;
    }
  } catch {
    logger.warn("observer", 'Could not find claude executable via "which claude"');
  }
  return "claude";
}
var MAX_RESTARTS = 3;
var ObserverSession = class _ObserverSession {
  queue;
  pendingResults = /* @__PURE__ */ new Map();
  destroyed = false;
  memorySessionId;
  abortController = new AbortController();
  restartCount;
  conversation = null;
  onReplace;
  lastActivityTime = Date.now();
  contentSessionId;
  project;
  constructor(contentSessionId, project, userPrompt, memorySessionId, restartCount = 0, onReplace) {
    this.contentSessionId = contentSessionId;
    this.project = project;
    this.memorySessionId = memorySessionId || null;
    this.restartCount = restartCount;
    this.onReplace = onReplace || (() => {
    });
    this.queue = new DurableQueue(contentSessionId, this.abortController.signal);
    const unstuck = forceUnstickAll(contentSessionId);
    if (unstuck > 0) logger.info("observer", `Constructor unstuck ${unstuck} messages for ${contentSessionId}`);
    this.runConversation(project, userPrompt);
  }
  async pushObservation(toolName, toolInput, toolResponse, cwd) {
    if (this.destroyed) return null;
    this.lastActivityTime = Date.now();
    const prompt = buildObservationPrompt(toolName, toolInput, toolResponse, cwd);
    const pendingId = this.queue.push("observation", prompt);
    return new Promise((resolve) => {
      this.pendingResults.set(pendingId, { resolve });
    });
  }
  async pushSummary(lastAssistantMessage) {
    if (this.destroyed) return null;
    this.lastActivityTime = Date.now();
    const prompt = buildSummaryPrompt(lastAssistantMessage);
    const pendingId = this.queue.push("summary", prompt);
    return new Promise((resolve) => {
      this.pendingResults.set(pendingId, { resolve });
    });
  }
  destroy() {
    if (this.destroyed) {
      logger.info("observer", `destroy() called but already destroyed for ${this.contentSessionId}`);
      return;
    }
    logger.info("observer", `destroy() starting for ${this.contentSessionId} (hasConversation=${!!this.conversation}, pendingResults=${this.pendingResults.size})`);
    this.destroyed = true;
    this.abortController.abort();
    this.queue.close();
    if (this.conversation) {
      logger.info("observer", `Closing SDK conversation for ${this.contentSessionId}`);
      try {
        this.conversation.close();
      } catch (err) {
        logger.error("observer", `Error closing conversation for ${this.contentSessionId}`, err);
      }
      this.conversation = null;
    }
    for (const [, pending] of this.pendingResults) {
      pending.resolve(null);
    }
    this.pendingResults.clear();
    logger.info("observer", `destroy() completed for ${this.contentSessionId}`);
  }
  isDestroyed() {
    return this.destroyed;
  }
  async runConversation(project, userPrompt) {
    const processingMsgs = [];
    const isResume = !!this.memorySessionId;
    try {
      const self = this;
      const toSDKMessage = (content) => ({
        type: "user",
        message: { role: "user", content },
        session_id: self.contentSessionId,
        parent_tool_use_id: null,
        isSynthetic: true
      });
      const messageGenerator = (async function* () {
        if (!isResume) {
          yield toSDKMessage(buildInitPrompt(project, userPrompt));
        }
        for await (const msg of self.queue) {
          processingMsgs.push(msg);
          yield toSDKMessage(msg.prompt);
        }
      })();
      const claudePath = findClaudeExecutable();
      const observerCwd = ensureObserverSessionsDir();
      const disallowedTools = [
        "Bash",
        "Read",
        "Write",
        "Edit",
        "Grep",
        "Glob",
        "WebFetch",
        "WebSearch",
        "Task",
        "NotebookEdit",
        "AskUserQuestion",
        "TodoWrite"
      ];
      const shouldResume = isResume && this.restartCount === 0;
      logger.info("observer", `Starting SDK query for ${this.contentSessionId} (resume=${shouldResume}, model=claude-sonnet-4-6)`);
      const conversation = query2({
        prompt: messageGenerator,
        options: {
          model: "claude-sonnet-4-6",
          cwd: observerCwd,
          ...shouldResume && this.memorySessionId && { resume: this.memorySessionId },
          disallowedTools,
          abortController: this.abortController,
          pathToClaudeCodeExecutable: claudePath
        }
      });
      this.conversation = conversation;
      const QUERY_IDLE_TIMEOUT_MS = 5 * 60 * 1e3;
      let lastMessageTime = Date.now();
      let sdkMessageCount = 0;
      const idleChecker = setInterval(() => {
        const idleMs = Date.now() - lastMessageTime;
        logger.info("observer", `SDK idle check for ${this.contentSessionId}: ${Math.round(idleMs / 1e3)}s since last message, ${sdkMessageCount} total messages`);
        if (idleMs > QUERY_IDLE_TIMEOUT_MS) {
          logger.warn("observer", `SDK query idle timeout for ${this.contentSessionId}, aborting`);
          this.abortController.abort();
          if (this.conversation) {
            try {
              this.conversation.close();
            } catch {
            }
          }
        }
      }, 3e4);
      idleChecker.unref();
      try {
        logger.info("observer", `Entering SDK for-await loop for ${this.contentSessionId}`);
        for await (const message of conversation) {
          sdkMessageCount++;
          lastMessageTime = Date.now();
          logger.info("observer", `SDK message #${sdkMessageCount} type=${message.type} for ${this.contentSessionId}`);
          if (message.session_id && message.session_id !== this.memorySessionId) {
            const prev = this.memorySessionId;
            this.memorySessionId = message.session_id;
            setMemorySessionId(this.contentSessionId, this.memorySessionId);
            logger.info("observer", `${prev ? "Updated" : "Captured"} memorySessionId for ${this.contentSessionId}`);
          }
          if (message.type === "rate_limit_event") {
            logger.warn("observer", `Rate limited \u2014 SDK will retry automatically for ${this.contentSessionId}`);
            continue;
          }
          if (message.type === "assistant") {
            const text = extractAssistantText(message);
            if (text.length > 0) {
              logger.info("observer", `Assistant response (${text.length} chars) for ${this.contentSessionId}`);
            }
            if (processingMsgs.length > 0 && text) {
              const msg = processingMsgs.shift();
              processMessage(msg, text, this.contentSessionId, this.pendingResults);
            }
          }
          if (message.type === "result") {
            logger.info("observer", `Result for ${this.contentSessionId}: subtype=${message.subtype}`);
          }
        }
      } catch (err) {
        logger.error("observer", `SDK for-await loop error for ${this.contentSessionId}`, err);
        throw err;
      } finally {
        clearInterval(idleChecker);
        this.conversation = null;
        logger.info("observer", `SDK for-await loop exited for ${this.contentSessionId} (${sdkMessageCount} messages processed)`);
      }
    } catch (error) {
      logger.error("observer", `Conversation error for ${this.contentSessionId}`, error);
    } finally {
      if (processingMsgs.length > 0) {
        logger.info("observer", `Resolving ${processingMsgs.length} leftover pending msgs with empty text`);
        for (const leftover of processingMsgs) {
          processMessage(leftover, "", this.contentSessionId, this.pendingResults);
        }
        processingMsgs.length = 0;
      }
      const remainingCount = getPendingCount(this.contentSessionId);
      logger.info("observer", `Conversation ended for ${this.contentSessionId} (remaining=${remainingCount}, restarts=${this.restartCount}/${MAX_RESTARTS}, destroyed=${this.destroyed})`);
      if (remainingCount > 0 && this.restartCount < MAX_RESTARTS) {
        logger.info("observer", `${remainingCount} pending messages remain, restarting (${this.restartCount + 1}/${MAX_RESTARTS})`);
        this.destroyed = true;
        this.abortController.abort();
        this.queue.close();
        if (this.conversation) {
          try {
            this.conversation.close();
          } catch {
          }
          this.conversation = null;
        }
        for (const [, pending] of this.pendingResults) {
          pending.resolve(null);
        }
        this.pendingResults.clear();
        forceUnstickAll(this.contentSessionId);
        const replacement = new _ObserverSession(
          this.contentSessionId,
          this.project,
          void 0,
          this.memorySessionId,
          this.restartCount + 1,
          this.onReplace
        );
        this.onReplace(this.contentSessionId, replacement);
      } else {
        if (remainingCount > 0) {
          logger.warn("observer", `${remainingCount} pending messages remain but max restarts (${MAX_RESTARTS}) exceeded`);
        }
        this.destroy();
      }
    }
  }
};

// src/utils/privacy.ts
function stripPrivateTags(content) {
  return content.replace(/<memory-lite-context>[\s\S]*?<\/memory-lite-context>/g, "").replace(/<private>[\s\S]*?<\/private>/g, "").trim();
}
function isEntirelyPrivate(content) {
  return stripPrivateTags(content).length === 0;
}

// src/worker/routes/sessions.ts
var sessionRoutes = new Hono2();
sessionRoutes.post("/sessions", async (c) => {
  try {
    const { contentSessionId, project, prompt } = await c.req.json();
    if (!contentSessionId) return c.json({ error: "contentSessionId required" }, 400);
    const cleanPrompt = prompt ? stripPrivateTags(prompt) : void 0;
    if (prompt && isEntirelyPrivate(prompt)) {
      return c.json({ sessionId: null, skipped: true });
    }
    const session = createSession(contentSessionId, project || "unknown", cleanPrompt);
    getOrCreateObserver(contentSessionId, project || "unknown", cleanPrompt);
    return c.json({ sessionId: session.id });
  } catch (error) {
    logger.error("routes", "/api/sessions error", error);
    return c.json({ error: "Failed to create session" }, 500);
  }
});
sessionRoutes.post("/sessions/complete", async (c) => {
  try {
    const { contentSessionId } = await c.req.json();
    if (!contentSessionId) return c.json({ error: "contentSessionId required" }, 400);
    completeSession(contentSessionId);
    destroyObserver(contentSessionId);
    return c.json({ ok: true });
  } catch (error) {
    logger.error("routes", "/api/sessions/complete error", error);
    return c.json({ error: "Failed to complete session" }, 500);
  }
});
sessionRoutes.post("/observations", async (c) => {
  try {
    const { contentSessionId, tool_name, tool_input, tool_response, cwd } = await c.req.json();
    if (!contentSessionId || !tool_name) {
      return c.json({ error: "contentSessionId and tool_name required" }, 400);
    }
    const session = getSessionByContentId(contentSessionId);
    if (!session) return c.json({ error: "Session not found" }, 404);
    const skipTools = new Set(
      getSetting("SKIP_TOOLS").split(",").map((s) => s.trim()).filter(Boolean)
    );
    if (skipTools.has(tool_name)) {
      return c.json({ ok: true, skipped: true, reason: "tool_excluded" });
    }
    const cleanInput = stripPrivateTags(tool_input || "");
    const cleanResponse = stripPrivateTags(tool_response || "");
    const observer = getObserver(contentSessionId);
    if (observer) {
      observer.pushObservation(tool_name, cleanInput, cleanResponse, cwd).catch((err) => {
        logger.error("routes", "Observer pushObservation error", err);
      });
      return c.json({ ok: true, queued: true });
    }
    const parsed = await extractObservation(tool_name, cleanInput, cleanResponse, cwd);
    if (!parsed || parsed.type === "skip") {
      return c.json({ ok: true, skipped: true });
    }
    const result = storeObservation(session.id, session.project, parsed, contentSessionId);
    if (!result.deduplicated) {
      embedObservation(getDb(), result.id, parsed.title, parsed.narrative, parsed.facts).catch((err) => logger.error("routes", "embedding failed", err));
    }
    return c.json({ ok: true, observationId: result.id, deduplicated: result.deduplicated });
  } catch (error) {
    logger.error("routes", "/api/observations error", error);
    return c.json({ error: "Failed to store observation" }, 500);
  }
});
sessionRoutes.post("/summarize", async (c) => {
  try {
    const { contentSessionId, last_assistant_message } = await c.req.json();
    if (!contentSessionId) return c.json({ error: "contentSessionId required" }, 400);
    const session = getSessionByContentId(contentSessionId);
    if (!session) return c.json({ error: "Session not found" }, 404);
    if (!last_assistant_message || last_assistant_message.trim().length < 100) {
      return c.json({ ok: true, skipped: true, reason: "no meaningful assistant message" });
    }
    const observer = getObserver(contentSessionId);
    if (observer) {
      observer.pushSummary(last_assistant_message).catch((err) => {
        logger.error("routes", "Observer pushSummary error", err);
      });
      return c.json({ ok: true, queued: true });
    }
    const summary = await generateSummary(last_assistant_message);
    if (!summary) return c.json({ ok: true, skipped: true, reason: "AI summary failed" });
    const hasContent = summary.completed || summary.learned || summary.investigated;
    const isTrivial = hasContent && /nothing|no .*(finding|change|work|action|interaction)/i.test(
      [summary.completed, summary.learned, summary.investigated].filter(Boolean).join(" ")
    );
    if (!hasContent || isTrivial) {
      return c.json({ ok: true, skipped: true, reason: "trivial summary" });
    }
    storeSummary(session.id, session.project, summary);
    return c.json({ ok: true });
  } catch (error) {
    logger.error("routes", "/api/summarize error", error);
    return c.json({ error: "Failed to generate summary" }, 500);
  }
});

// src/worker/formatter.ts
var TYPE_ICONS = {
  bugfix: "\u{1F534}",
  feature: "\u{1F7E2}",
  refactor: "\u{1F7E3}",
  discovery: "\u{1F535}",
  decision: "\u{1F9E0}",
  change: "\u26AA"
};
function typeIcon(type) {
  return TYPE_ICONS[type] || "\u26AA";
}
function truncate2(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}
function estimateTokens(obs) {
  const size = (obs.title || "").length + (obs.narrative || "").length + (obs.facts || "").length;
  return Math.ceil(size / 4);
}
function formatTime(isoDate) {
  return new Date(isoDate).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}
function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}
function formatSearchIndex(results) {
  if (results.length === 0) return "No results found.";
  const lines = [];
  lines.push(`Found ${results.length} result(s):
`);
  lines.push("| ID | Time | T | Title | ~Tokens |");
  lines.push("|----|------|---|-------|---------|");
  let lastTime = "";
  for (const r of results) {
    const time = formatTime(r.created_at);
    const displayTime = time === lastTime ? "\u2033" : time;
    lastTime = time;
    lines.push(
      `| #${r.id} | ${displayTime} | ${typeIcon(r.type)} | ${truncate2(r.title || "Untitled", 60)} | ~${estimateTokens(r)} |`
    );
  }
  lines.push("");
  lines.push("Use `memory_timeline` with an ID to see context, or `memory_get` with IDs to fetch full details.");
  return lines.join("\n");
}
function formatTimeline(before, anchor, after) {
  const all = [...before, anchor, ...after];
  const lines = [];
  lines.push(`Timeline around #${anchor.id}: "${anchor.title || "Untitled"}"
`);
  lines.push(`${before.length} before \u2192 anchor \u2192 ${after.length} after
`);
  const byDay = /* @__PURE__ */ new Map();
  for (const obs of all) {
    const day = formatDate(obs.created_at);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ obs, isAnchor: obs.id === anchor.id });
  }
  for (const [day, items] of byDay) {
    lines.push(`### ${day}`);
    lines.push("| ID | Time | T | Title | ~Tokens |");
    lines.push("|----|------|---|-------|---------|");
    let lastTime = "";
    for (const { obs, isAnchor } of items) {
      const time = formatTime(obs.created_at);
      const displayTime = time === lastTime ? "\u2033" : time;
      lastTime = time;
      const marker = isAnchor ? " \u2190 **ANCHOR**" : "";
      lines.push(
        `| #${obs.id} | ${displayTime} | ${typeIcon(obs.type)} | ${truncate2(obs.title || "Untitled", 60)}${marker} | ~${estimateTokens(obs)} |`
      );
    }
    lines.push("");
  }
  lines.push("Use `memory_get` with specific IDs to fetch full observation details.");
  return lines.join("\n");
}
function formatObservationsFull(observations) {
  if (observations.length === 0) return "No observations found for the given IDs.";
  const lines = [];
  for (const obs of observations) {
    lines.push(`## #${obs.id} \u2014 ${obs.title || "Untitled"}`);
    lines.push(`**Type:** ${typeIcon(obs.type)} ${obs.type} | **Time:** ${formatTime(obs.created_at)} ${formatDate(obs.created_at)}`);
    const facts = parseJsonArray(obs.facts);
    if (facts.length > 0) {
      lines.push(`**Facts:** ${facts.join("; ")}`);
    }
    if (obs.narrative) {
      lines.push(`**Narrative:** ${obs.narrative}`);
    }
    const filesRead = parseJsonArray(obs.files_read);
    const filesMod = parseJsonArray(obs.files_modified);
    if (filesRead.length > 0 || filesMod.length > 0) {
      const parts = [];
      if (filesRead.length > 0) parts.push(`read: ${filesRead.join(", ")}`);
      if (filesMod.length > 0) parts.push(`modified: ${filesMod.join(", ")}`);
      lines.push(`**Files:** ${parts.join(" | ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
function parseJsonArray(json) {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// src/worker/routes/utils.ts
var MAX_LIMIT = 500;
var MAX_DEPTH = 50;
var MAX_BATCH = 100;
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function safeParseInt(value, fallback) {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

// src/worker/routes/search.ts
var searchRoutes = new Hono2();
searchRoutes.get("/search/index", (c) => {
  try {
    const q = c.req.query("q");
    if (!q) return c.json({ error: "q parameter required" }, 400);
    const results = searchObservationsIndex({
      query: q,
      project: c.req.query("project"),
      type: c.req.query("type"),
      dateStart: c.req.query("dateStart"),
      dateEnd: c.req.query("dateEnd"),
      limit: clamp(safeParseInt(c.req.query("limit"), 20), 1, MAX_LIMIT),
      offset: Math.max(0, safeParseInt(c.req.query("offset"), 0))
    });
    const formatted = formatSearchIndex(results);
    return c.json({ content: [{ type: "text", text: formatted }] });
  } catch (error) {
    logger.error("routes", "/api/search/index error", error);
    return c.json({ error: "Search failed" }, 500);
  }
});
searchRoutes.get("/timeline", (c) => {
  try {
    const anchorId = safeParseInt(c.req.query("anchor"), NaN);
    if (isNaN(anchorId)) return c.json({ error: "anchor parameter required (observation ID)" }, 400);
    const depthBefore = clamp(safeParseInt(c.req.query("depth_before"), 5), 1, MAX_DEPTH);
    const depthAfter = clamp(safeParseInt(c.req.query("depth_after"), 5), 1, MAX_DEPTH);
    const project = c.req.query("project");
    const { anchor, before, after } = getTimelineAroundObservation(anchorId, depthBefore, depthAfter, project);
    if (!anchor) return c.json({ error: "Observation not found" }, 404);
    const formatted = formatTimeline(before, anchor, after);
    return c.json({ content: [{ type: "text", text: formatted }] });
  } catch (error) {
    logger.error("routes", "/api/timeline error", error);
    return c.json({ error: "Timeline failed" }, 500);
  }
});
searchRoutes.post("/observations/batch", async (c) => {
  try {
    const { ids } = await c.req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "ids array required" }, 400);
    }
    if (ids.length > MAX_BATCH) {
      return c.json({ error: `Too many IDs (max ${MAX_BATCH})` }, 400);
    }
    const numericIds = ids.map(Number);
    if (numericIds.some(isNaN)) {
      return c.json({ error: "All IDs must be valid integers" }, 400);
    }
    const observations = getObservationsByIds(numericIds);
    const formatted = formatObservationsFull(observations);
    return c.json({ content: [{ type: "text", text: formatted }] });
  } catch (error) {
    logger.error("routes", "/api/observations/batch error", error);
    return c.json({ error: "Batch fetch failed" }, 500);
  }
});
searchRoutes.get("/search", async (c) => {
  try {
    const q = c.req.query("q");
    const project = c.req.query("project");
    const mode = c.req.query("mode") || "fts";
    const limit = clamp(safeParseInt(c.req.query("limit"), 10), 1, MAX_LIMIT);
    if (!q) return c.json({ error: "q parameter required" }, 400);
    if (mode === "semantic") {
      const vecResults = await searchSemantic(getDb(), q, limit);
      if (vecResults.length === 0) {
        return c.json({ results: [], mode: "semantic", message: "No results (Ollama may be unavailable)" });
      }
      const db2 = getDb();
      const enriched = vecResults.map((r) => {
        const obs = db2.prepare("SELECT * FROM observations WHERE id = ?").get(r.observationId);
        return obs ? { ...obs, distance: r.distance } : null;
      }).filter(Boolean);
      return c.json({ results: enriched, mode: "semantic" });
    }
    const results = searchObservationsFts(q, project, limit);
    return c.json({ results, mode: "fts" });
  } catch (error) {
    logger.error("routes", "/api/search error", error);
    return c.json({ error: "Search failed" }, 500);
  }
});

// src/context/generator.ts
function generateContextDetailed(project) {
  const observationCount = getSetting("OBSERVATION_COUNT");
  const fullDetailCount = getSetting("FULL_OBSERVATION_COUNT");
  const summaryCount = getSetting("SUMMARY_COUNT");
  const summaries = getRecentSummaries(project, summaryCount);
  const observations = getRecentObservations(project, observationCount);
  const detailedIds = observations.slice(0, fullDetailCount).map((o) => o.id);
  const context = generateContext(project);
  return {
    context,
    estimatedTokens: Math.ceil(context.length / 4),
    summaries,
    observations,
    detailedIds
  };
}
function generateContext(project) {
  const observationCount = getSetting("OBSERVATION_COUNT");
  const fullDetailCount = getSetting("FULL_OBSERVATION_COUNT");
  const summaryCount = getSetting("SUMMARY_COUNT");
  const summaries = getRecentSummaries(project, summaryCount);
  const observations = getRecentObservations(project, observationCount);
  if (summaries.length === 0 && observations.length === 0) {
    return "";
  }
  const lines = [];
  lines.push(`<memory-lite-context>`);
  lines.push(`# Memory Context | ${project}`);
  lines.push("");
  if (summaries.length > 0) {
    lines.push("## Recent Summaries");
    for (const s of summaries) {
      const date = new Date(s.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
      lines.push(`### ${date} - ${s.request || "Session"}`);
      if (s.completed) lines.push(`- **Completed:** ${s.completed}`);
      if (s.learned) lines.push(`- **Learned:** ${s.learned}`);
      if (s.next_steps) lines.push(`- **Next steps:** ${s.next_steps}`);
      lines.push("");
    }
  }
  if (observations.length > 0) {
    lines.push("## Recent Activity");
    lines.push("| Time | Type | Title | Files |");
    lines.push("|------|------|-------|-------|");
    for (const obs of observations) {
      const time = new Date(obs.created_at).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
      const files = [
        ...parseJsonArray2(obs.files_read),
        ...parseJsonArray2(obs.files_modified)
      ].map((f) => basename(f)).join(", ");
      lines.push(`| ${time} | ${obs.type} | ${obs.title || "-"} | ${files || "-"} |`);
    }
    lines.push("");
    const detailed = observations.slice(0, fullDetailCount);
    if (detailed.length > 0) {
      lines.push(`## Details (last ${detailed.length})`);
      for (const obs of detailed) {
        lines.push(`### #${obs.id} - ${obs.title || "Untitled"}`);
        const facts = parseJsonArray2(obs.facts);
        if (facts.length > 0) {
          lines.push(`**Facts:** ${facts.join("; ")}`);
        }
        if (obs.narrative) {
          lines.push(`**Narrative:** ${obs.narrative}`);
        }
        const filesRead = parseJsonArray2(obs.files_read);
        const filesMod = parseJsonArray2(obs.files_modified);
        if (filesRead.length > 0 || filesMod.length > 0) {
          const parts = [];
          if (filesRead.length > 0) parts.push(`read: ${filesRead.join(", ")}`);
          if (filesMod.length > 0) parts.push(`modified: ${filesMod.join(", ")}`);
          lines.push(`**Files:** ${parts.join(" | ")}`);
        }
        lines.push("");
      }
    }
  }
  lines.push("</memory-lite-context>");
  return lines.join("\n");
}
function parseJsonArray2(json) {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function basename(path) {
  return path.split("/").pop() || path;
}

// src/worker/routes/dashboard.ts
var dashboardRoutes = new Hono2();
dashboardRoutes.get("/dashboard/sessions", (c) => {
  try {
    const project = c.req.query("project");
    const limit = clamp(safeParseInt(c.req.query("limit"), 50), 1, MAX_LIMIT);
    const offset = Math.max(0, safeParseInt(c.req.query("offset"), 0));
    const db2 = getDb();
    const whereClause = project ? "WHERE s.project = ?" : "";
    const params = project ? [project, limit, offset] : [limit, offset];
    const sessions = db2.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM observations o WHERE o.session_id = s.id) as observation_count,
        CASE WHEN sm.id IS NOT NULL THEN json_object(
          'request', sm.request,
          'investigated', sm.investigated,
          'learned', sm.learned,
          'completed', sm.completed,
          'next_steps', sm.next_steps
        ) ELSE NULL END as summary
      FROM sessions s
      LEFT JOIN summaries sm ON sm.session_id = s.id
      ${whereClause}
      ORDER BY s.created_at_epoch DESC
      LIMIT ? OFFSET ?
    `).all(...params);
    const total = db2.prepare(`SELECT COUNT(*) as count FROM sessions ${project ? "WHERE project = ?" : ""}`).get(...project ? [project] : []);
    return c.json({ sessions, total: total.count });
  } catch (error) {
    logger.error("routes", "/api/dashboard/sessions error", error);
    return c.json({ error: "Failed to list sessions" }, 500);
  }
});
dashboardRoutes.get("/dashboard/sessions/:sessionId/observations", (c) => {
  try {
    const sessionId = safeParseInt(c.req.param("sessionId"), NaN);
    const db2 = getDb();
    const observations = db2.prepare(
      "SELECT * FROM observations WHERE session_id = ? ORDER BY created_at_epoch ASC"
    ).all(sessionId);
    return c.json({ observations });
  } catch (error) {
    logger.error("routes", "/api/dashboard/observations error", error);
    return c.json({ error: "Failed to list observations" }, 500);
  }
});
dashboardRoutes.get("/dashboard/projects", (c) => {
  try {
    const db2 = getDb();
    const projects = db2.prepare(`
      SELECT project, COUNT(*) as session_count,
        MAX(created_at) as last_active
      FROM sessions
      GROUP BY project
      ORDER BY last_active DESC
    `).all();
    return c.json({ projects });
  } catch (error) {
    logger.error("routes", "/api/dashboard/projects error", error);
    return c.json({ error: "Failed to list projects" }, 500);
  }
});
dashboardRoutes.get("/dashboard/stats", (c) => {
  try {
    const db2 = getDb();
    const sessions = db2.prepare("SELECT COUNT(*) as count FROM sessions").get();
    const activeSessions2 = db2.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'").get();
    const observations = db2.prepare("SELECT COUNT(*) as count FROM observations").get();
    const summaries = db2.prepare("SELECT COUNT(*) as count FROM summaries").get();
    const projects = db2.prepare("SELECT COUNT(DISTINCT project) as count FROM sessions").get();
    const types = db2.prepare(
      "SELECT type, COUNT(*) as count FROM observations GROUP BY type ORDER BY count DESC"
    ).all();
    const daily = db2.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM observations
      WHERE created_at_epoch > ?
      GROUP BY date(created_at)
      ORDER BY day ASC
    `).all(Date.now() - 7 * 864e5);
    const pendingMessages = db2.prepare("SELECT COUNT(*) as count FROM pending_messages").get();
    const activeObserverIds = getActiveSessionIds();
    return c.json({
      sessions: sessions.count,
      activeSessions: activeSessions2.count,
      observations: observations.count,
      summaries: summaries.count,
      projects: projects.count,
      pendingMessages: pendingMessages.count,
      activeObservers: activeObserverIds.length,
      types,
      daily,
      uptime: Math.floor(process.uptime())
    });
  } catch (error) {
    logger.error("routes", "/api/dashboard/stats error", error);
    return c.json({ error: "Failed to get stats" }, 500);
  }
});
dashboardRoutes.get("/dashboard/feed", (c) => {
  try {
    const project = c.req.query("project");
    const limit = clamp(safeParseInt(c.req.query("limit"), 30), 1, MAX_LIMIT);
    const before = c.req.query("before");
    const db2 = getDb();
    const obsConditions = [];
    const sumConditions = [];
    const params = [];
    if (project) {
      obsConditions.push("o.project = ?");
      sumConditions.push("sm.project = ?");
      params.push(project);
    }
    if (before) {
      obsConditions.push("o.created_at_epoch < ?");
      sumConditions.push("sm.created_at_epoch < ?");
      params.push(safeParseInt(before, 0));
    }
    const obsWhere = obsConditions.length > 0 ? "WHERE " + obsConditions.join(" AND ") : "";
    const sumWhere = sumConditions.length > 0 ? "WHERE " + sumConditions.join(" AND ") : "";
    const obs = db2.prepare(`
      SELECT o.id, o.session_id, o.project, o.type, o.title, o.facts, o.narrative,
        o.files_read, o.files_modified, o.created_at, o.created_at_epoch,
        s.content_session_id,
        'observation' as item_type
      FROM observations o
      JOIN sessions s ON s.id = o.session_id
      ${obsWhere}
      ORDER BY o.created_at_epoch DESC LIMIT ?
    `).all(...params, limit);
    const sums = db2.prepare(`
      SELECT sm.id, sm.session_id, sm.project, sm.request, sm.investigated, sm.learned,
        sm.completed, sm.next_steps, sm.created_at, sm.created_at_epoch,
        s.content_session_id,
        'summary' as item_type
      FROM summaries sm
      JOIN sessions s ON s.id = sm.session_id
      ${sumWhere}
      ORDER BY sm.created_at_epoch DESC LIMIT ?
    `).all(...params, limit);
    const feed = [...obs, ...sums].sort((a, b) => b.created_at_epoch - a.created_at_epoch).slice(0, limit);
    return c.json({ feed });
  } catch (error) {
    logger.error("routes", "/api/dashboard/feed error", error);
    return c.json({ error: "Failed to get feed" }, 500);
  }
});
dashboardRoutes.get("/dashboard/context-preview", (c) => {
  try {
    const project = c.req.query("project") || "unknown";
    const breakdown = generateContextDetailed(project);
    return c.json(breakdown);
  } catch (error) {
    logger.error("routes", "/api/dashboard/context-preview error", error);
    return c.json({ error: "Failed to generate context preview" }, 500);
  }
});

// src/worker/routes/cleanup.ts
var cleanupRoutes = new Hono2();
cleanupRoutes.post("/cleanup/review", async (c) => {
  try {
    const { project } = await c.req.json();
    const proj = project || "unknown";
    const summaries = getRecentSummaries(proj, 20);
    const observations = getRecentObservations(proj, 100);
    const items = [];
    for (const s of summaries) {
      const parts = [s.request, s.completed, s.learned, s.next_steps].filter(Boolean);
      items.push({ id: s.id, type: "summary", text: parts.join(" | ") });
    }
    for (const o of observations) {
      const parts = [o.title, o.narrative].filter(Boolean);
      items.push({ id: o.id, type: "observation", text: `[${o.type}] ${parts.join(" - ")}` });
    }
    return new Response(
      new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const send = (event, data) => {
            controller.enqueue(encoder.encode(`event: ${event}
data: ${JSON.stringify(data)}

`));
          };
          send("items", { items: items.map((i) => ({ id: i.id, type: i.type, text: i.text })) });
          try {
            const results = await reviewForCleanup(items);
            for (const r of results) {
              send("result", r);
              await new Promise((resolve) => setTimeout(resolve, 30));
            }
            send("done", { results, totalReviewed: items.length });
          } catch (err) {
            logger.error("cleanup", "Review failed", err);
            send("done", { results: [], error: String(err) });
          }
          controller.close();
        }
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      }
    );
  } catch (error) {
    logger.error("routes", "/api/cleanup/review error", error);
    return c.json({ error: "Cleanup review failed" }, 500);
  }
});
cleanupRoutes.post("/cleanup/apply", async (c) => {
  try {
    const { deletions } = await c.req.json();
    if (!Array.isArray(deletions)) return c.json({ error: "deletions array required" }, 400);
    let deleted = 0;
    for (const d of deletions) {
      if (d.type === "observation") {
        if (deleteObservation(d.id)) deleted++;
      } else if (d.type === "summary") {
        if (deleteSummary(d.id)) deleted++;
      }
    }
    return c.json({ ok: true, deleted });
  } catch (error) {
    logger.error("routes", "/api/cleanup/apply error", error);
    return c.json({ error: "Cleanup apply failed" }, 500);
  }
});

// src/worker/routes/settings.ts
var settingsRoutes = new Hono2();
settingsRoutes.get("/health", (c) => c.json({ ok: true }));
settingsRoutes.get("/readiness", (c) => {
  if (!isDbReady()) {
    return c.json({ ok: false, reason: "DB not initialized" }, 503);
  }
  return c.json({ ok: true });
});
settingsRoutes.get("/context", (c) => {
  try {
    const project = c.req.query("project") || "unknown";
    const context = generateContext(project);
    return c.json({ context });
  } catch (error) {
    logger.error("routes", "/api/context error", error);
    return c.json({ error: "Failed to generate context" }, 500);
  }
});
settingsRoutes.get("/settings", (c) => {
  try {
    return c.json(getAllSettings());
  } catch (error) {
    logger.error("routes", "GET /api/settings error", error);
    return c.json({ error: "Failed to get settings" }, 500);
  }
});
settingsRoutes.put("/settings", async (c) => {
  try {
    const body = await c.req.json();
    const updated = updateSettings(body);
    return c.json(updated);
  } catch (error) {
    logger.error("routes", "PUT /api/settings error", error);
    return c.json({ error: "Failed to update settings" }, 500);
  }
});
settingsRoutes.get("/debug/sessions", (c) => {
  const sessions = getActiveSessionIds().map((id) => ({
    contentSessionId: id,
    idleMs: Math.round(getSessionAge(id))
  }));
  return c.json({
    activeSessions: sessions,
    uptime: Math.floor(process.uptime()),
    pid: process.pid,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
  });
});
settingsRoutes.delete("/observations/:id", (c) => {
  try {
    const id = safeParseInt(c.req.param("id"), NaN);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
    const deleted = deleteObservation(id);
    if (!deleted) return c.json({ error: "Observation not found" }, 404);
    return c.json({ ok: true });
  } catch (error) {
    logger.error("routes", "DELETE /api/observations error", error);
    return c.json({ error: "Failed to delete observation" }, 500);
  }
});
settingsRoutes.delete("/summaries/:id", (c) => {
  try {
    const id = safeParseInt(c.req.param("id"), NaN);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
    const deleted = deleteSummary(id);
    if (!deleted) return c.json({ error: "Summary not found" }, 404);
    return c.json({ ok: true });
  } catch (error) {
    logger.error("routes", "DELETE /api/summaries error", error);
    return c.json({ error: "Failed to delete summary" }, 500);
  }
});
settingsRoutes.delete("/sessions/:id", (c) => {
  try {
    const id = safeParseInt(c.req.param("id"), NaN);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
    const deleted = deleteSession(id);
    if (!deleted) return c.json({ error: "Session not found" }, 404);
    return c.json({ ok: true });
  } catch (error) {
    logger.error("routes", "DELETE /api/sessions error", error);
    return c.json({ error: "Failed to delete session" }, 500);
  }
});

// src/worker/routes.ts
var app = new Hono2();
app.route("/api", sessionRoutes);
app.route("/api", searchRoutes);
app.route("/api", dashboardRoutes);
app.route("/api", cleanupRoutes);
app.route("/api", settingsRoutes);

// src/worker/lifecycle.ts
import { existsSync as existsSync5, readFileSync as readFileSync2, writeFileSync as writeFileSync2, unlinkSync } from "fs";
var pidPath = getPidPath();
function writePid(port2) {
  const info = { pid: process.pid, port: port2, startedAt: Date.now() };
  writeFileSync2(pidPath, JSON.stringify(info));
}
function removePid() {
  try {
    if (existsSync5(pidPath)) unlinkSync(pidPath);
  } catch (err) {
    logger.warn("worker", "Failed to remove PID file", err);
  }
}
async function checkExistingWorker(port2) {
  if (!existsSync5(pidPath)) return false;
  try {
    const raw2 = readFileSync2(pidPath, "utf-8").trim();
    let oldPid;
    let oldPort = port2;
    try {
      const info = JSON.parse(raw2);
      oldPid = info.pid;
      oldPort = info.port;
    } catch {
      oldPid = parseInt(raw2);
    }
    process.kill(oldPid, 0);
    const res = await fetch(`http://127.0.0.1:${oldPort}/api/health`, { signal: AbortSignal.timeout(2e3) });
    if (res.ok) {
      logger.info("worker", `Another worker already running (PID ${oldPid}). Exiting.`);
      return true;
    }
  } catch {
  }
  removePid();
  return false;
}
var STALE_SESSION_MS = 30 * 60 * 1e3;
var reaperInterval;
function startReaper() {
  reaperInterval = setInterval(() => {
    try {
      for (const id of getActiveSessionIds()) {
        const age = getSessionAge(id);
        if (age > STALE_SESSION_MS) {
          logger.info("reaper", `Destroying stale session ${id} (idle: ${Math.round(age / 1e3)}s)`);
          destroyObserver(id);
        }
      }
    } catch (err) {
      logger.error("reaper", "Error during cleanup", err);
    }
  }, 6e4);
  reaperInterval.unref();
}
var IDLE_SHUTDOWN_MS = 30 * 60 * 1e3;
var lastApiActivity = Date.now();
var idleShutdownInterval;
function installIdleMiddleware(app2) {
  app2.use("/api/*", async (c, next) => {
    lastApiActivity = Date.now();
    await next();
  });
}
function startIdleShutdown() {
  idleShutdownInterval = setInterval(() => {
    if (getActiveSessionIds().length === 0 && Date.now() - lastApiActivity > IDLE_SHUTDOWN_MS) {
      logger.info("worker", "No active sessions and idle for 30min, shutting down");
      shutdown();
    }
  }, 6e4);
  idleShutdownInterval.unref();
}
var shutdownInitiated = false;
function shutdown() {
  if (shutdownInitiated) return;
  shutdownInitiated = true;
  clearInterval(reaperInterval);
  clearInterval(idleShutdownInterval);
  const forceTimer = setTimeout(() => {
    logger.error("worker", "Graceful shutdown timed out after 10s, force exiting");
    process.exit(1);
  }, 1e4);
  forceTimer.unref();
  logger.info("worker", "Shutting down...");
  destroyAllObservers();
  removePid();
  closeDb();
  process.exit(0);
}
function installSignalHandlers() {
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGHUP", shutdown);
}
function recoverPendingMessages() {
  const resetCount = forceUnstickAllGlobal();
  if (resetCount > 0) {
    logger.info("recovery", `Reset ${resetCount} stale processing messages to pending`);
  }
  setTimeout(() => {
    try {
      const sessionIds = getSessionsWithPendingMessages();
      if (sessionIds.length === 0) return;
      logger.info("recovery", `Found ${sessionIds.length} session(s) with orphaned pending messages`);
      for (const contentSessionId of sessionIds) {
        const session = getSessionByContentId(contentSessionId);
        if (!session) {
          logger.warn("recovery", `Session ${contentSessionId} not found in DB, skipping`);
          continue;
        }
        logger.info("recovery", `Creating observer to drain ${contentSessionId} (project: ${session.project})`);
        getOrCreateObserver(contentSessionId, session.project);
      }
    } catch (err) {
      logger.error("recovery", "Failed to recover pending messages", err);
    }
  }, 2e3);
}

// src/worker/server.ts
var __dirname = dirname(fileURLToPath(import.meta.url));
var uiPath = join4(__dirname, "..", "ui");
if (existsSync6(uiPath)) {
  app.get("/", (c) => {
    const html = readFileSync3(join4(uiPath, "index.html"), "utf-8");
    return c.html(html);
  });
  app.use("/*", serveStatic({ root: uiPath }));
}
var port = getSetting("WORKER_PORT");
var alreadyRunning = await checkExistingWorker(port);
if (alreadyRunning) process.exit(0);
writePid(port);
getDb();
installSignalHandlers();
installIdleMiddleware(app);
startReaper();
startIdleShutdown();
recoverPendingMessages();
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  logger.info("worker", `Memory-lite worker running on http://127.0.0.1:${port}`);
});
