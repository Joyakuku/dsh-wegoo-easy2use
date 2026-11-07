/**
 * relay.js — wegoo（New-API / sub2api 内核）的最小 HTTP 客户端。
 *
 * 只做四件事：读模型、读价目、生成、读请求日志。
 * 所有错误都带上 status 与上游 message，方便面板和工具结果里直接展示。
 */

const DEFAULT_TIMEOUT_MS = 60_000;

async function readPayload(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function upstreamMessage(payload, fallback) {
  return (
    payload?.error?.message
    || payload?.message
    || payload?.error?.code
    || fallback
  );
}

export class Relay {
  constructor({ baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.baseUrl = String(baseUrl || 'https://ai.wegoo.site').replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', key, body, timeoutMs, allowAnonymous = false } = {}) {
    if (!key && !allowAnonymous) throw new Error('wegoo: 未配置 API Key');

    const headers = { Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
      });
    } catch (cause) {
      const err = new Error(`wegoo ${method} ${path} 不可达：${cause?.message || cause}`);
      err.cause = cause;
      throw err;
    }

    const payload = await readPayload(res);
    if (!res.ok) {
      const err = new Error(
        `wegoo ${method} ${path} → HTTP ${res.status}：${upstreamMessage(payload, res.statusText)}`,
      );
      err.status = res.status;
      err.payload = payload;
      throw err;
    }
    return payload;
  }

  /** 当前 key 可见的模型（分组隔离：返回的就是这个 key 能调的）。 */
  models(key) {
    return this.request('/v1/models', { key });
  }

  /** 价目表。公开端点，不带 key 也能读。 */
  pricing(key) {
    return this.request('/api/pricing', { key, allowAnonymous: true });
  }

  /** OpenAI 风格图像生成。 */
  /** 图生图 / 图像编辑：multipart/form-data 带参考图。 */
  async editImage(key, { model, prompt, size, n, imageBuffer, filename, mimeType }) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    if (size) form.append('size', size);
    if (n) form.append('n', String(n));
    form.append('image', new Blob([imageBuffer], { type: mimeType || 'image/png' }), filename || 'image.png');
    let res;
    try {
      res = await fetch(`${this.baseUrl}/v1/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(300_000),
      });
    } catch (cause) {
      throw new Error(`wegoo 图像编辑请求失败：${cause?.message || cause}`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`wegoo POST /v1/images/edits → HTTP ${res.status}：${text.slice(0, 400)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`wegoo 图像编辑返回无法解析：${text.slice(0, 200)}`);
    }
  }

  generateImage(key, body) {
    return this.request('/v1/images/generations', { method: 'POST', key, body, timeoutMs: 180_000 });
  }

  /** 建视频任务。响应形状未经实测，调用方需按多形态解析。 */
  createVideo(key, body) {
    return this.request('/v1/videos', { method: 'POST', key, body, timeoutMs: 120_000 });
  }

  /** 查视频任务。 */
  getVideo(key, id) {
    return this.request(`/v1/videos/${encodeURIComponent(id)}`, { key });
  }

  /** 逐条请求日志（真实账本）。每个 key 只能看到自己的。 */
  logs(key) {
    return this.request('/api/log/token', { key, timeoutMs: 40_000 });
  }

  /** 下载视频任务产物。wegoo 的结果不走 JSON 里的 url，而是这个二进制端点。 */
  async videoContent(key, id) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}/v1/videos/${encodeURIComponent(id)}/content`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(300_000),
      });
    } catch (cause) {
      throw new Error(`wegoo 视频下载失败：${cause?.message || cause}`);
    }
    if (!res.ok) throw new Error(`wegoo 视频下载失败：HTTP ${res.status}`);
    return {
      data: Buffer.from(await res.arrayBuffer()),
      mediaType: res.headers.get('content-type') || 'video/mp4',
    };
  }

  /** 下载二进制（生成结果的 url / content_url）。 */
  async download(url, { timeoutMs = 180_000 } = {}) {
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      throw new Error(`wegoo 下载失败：${cause?.message || cause}`);
    }
    if (!res.ok) throw new Error(`wegoo 下载失败：HTTP ${res.status}`);
    return {
      data: Buffer.from(await res.arrayBuffer()),
      mediaType: res.headers.get('content-type') || 'application/octet-stream',
    };
  }
}
