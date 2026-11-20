// Stage 2 — DataService / authClient / apiClient 行为测试
// 隔离环境：mock DOM / mock localStorage / 可控 fetch，不触碰真实浏览器数据，不发真实网络请求。
// 运行：node tests/data-service.test.js

const fs = require("fs");
const assert = require("assert");
const path = require("path");

const html = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");
const scriptStart = html.indexOf("<script>") + "<script>".length;
const scriptEnd = html.lastIndexOf("</script>");
let body = html.slice(scriptStart, scriptEnd);
const initMarker = "validateModuleRegistry();";
const initIdx = body.lastIndexOf(initMarker);
if (initIdx > 0) {
    body = body.slice(0, initIdx);
}

function makeElement(tagName = "div") {
    const el = {
        tagName: String(tagName).toUpperCase(),
        type: "",
        className: "",
        children: [],
        dataset: {},
        style: {},
        classList: {
            _set: new Set(),
            add(...c) { c.forEach((x) => this._set.add(x)); },
            remove(...c) { c.forEach((x) => this._set.delete(x)); },
            toggle(c, force) { if (force === undefined ? !this._set.has(c) : force) this._set.add(c); else this._set.delete(c); },
            contains(c) { return this._set.has(c); }
        },
        textContent: "",
        value: "",
        checked: false,
        disabled: false,
        hidden: false,
        isConnected: true,
        parentElement: null,
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k] !== undefined ? this[k] : null; },
        removeAttribute(k) { delete this[k]; },
        hasAttribute(k) { return this[k] !== undefined; },
        _listeners: {},
        addEventListener(type, handler) {
            if (typeof handler !== "function") return;
            (this._listeners[type] = this._listeners[type] || []).push(handler);
        },
        removeEventListener() {},
        dispatchEvent() { return true; },
        append(...nodes) { for (const n of nodes) { this.children.push(n); n.parentElement = this; } },
        appendChild(n) { this.children.push(n); n.parentElement = this; return n; },
        replaceChildren(...nodes) { this.children = nodes.slice(); for (const n of this.children) { n.parentElement = this; } },
        remove() { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; } },
        focus() {},
        scrollIntoView() {},
        click() {},
        reset() {},
        closest() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
    return el;
}

function makeDocument() {
    const byId = new Map();
    return {
        body: makeElement("body"),
        getElementById(id) {
            if (!byId.has(id)) byId.set(id, makeElement("div"));
            return byId.get(id);
        },
        querySelector() { return makeElement("div"); },
        querySelectorAll() { return []; },
        createElement(tag) { return makeElement(tag); },
        createTextNode(text) { const n = makeElement("#text"); n.textContent = String(text); return n; }
    };
}

function makeStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem(k) { return store.has(k) ? store.get(k) : null; },
        setItem(k, v) { store.set(k, String(v)); },
        removeItem(k) { store.delete(k); },
        _store: store
    };
}

function makeWindow(extra = {}) {
    return {
        setTimeout: () => 0,
        clearTimeout: () => {},
        setInterval: () => 0,
        clearInterval: () => {},
        confirm: () => true,
        addEventListener: () => {},
        removeEventListener: () => {},
        ...extra
    };
}

function loadApi(options = {}) {
    const storage = makeStorage(options.seed || {});
    const document = makeDocument();
    const window = makeWindow({
        MY_TECH_LAB_DATA_SOURCE: options.dataSource || "api",
        MY_TECH_LAB_API_BASE: options.apiBase || "https://api.example"
    });
    const fetchImpl = options.fetchImpl || (async () => { throw new Error("no fetch route"); });
    const fn = new Function(
        "document", "localStorage", "window", "fetch", "AbortController", "URL",
        body + "\n; return { MTLLab, DataService, authClient, apiClient };"
    );
    const api = fn(document, storage, window, fetchImpl, AbortController, URL);
    return { api, storage };
}

function okJson(data, status = 200) {
    return { ok: true, status, json: async () => data };
}

const tests = [];

tests.push(async function test_fromApi_maps_fields() {
    const { api } = loadApi();
    const mapped = api.DataService.fromApi({
        id: "u-1", text: "hi", created_at: "2026-01-01T00:00:00Z", version: 3
    });
    assert.deepStrictEqual(mapped, {
        id: "u-1", text: "hi", createdAt: "2026-01-01T00:00:00Z", version: 3
    });
});

tests.push(async function test_listNotes_via_api() {
    const routes = {
        "https://api.example/api/v1/notes": () => okJson([
            { id: "u-1", text: "hi", created_at: "2026-01-01T00:00:00Z", version: 1 }
        ])
    };
    const { api } = loadApi({
        fetchImpl: async (url) => { const r = routes[url]; if (r) return r(); throw new Error("unexpected " + url); }
    });
    const items = await api.DataService.listNotes();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].id, "u-1");
    assert.strictEqual(items[0].createdAt, "2026-01-01T00:00:00Z");
});

tests.push(async function test_update_conflict_409() {
    const { api } = loadApi({
        fetchImpl: async () => ({ ok: false, status: 409 })
    });
    await assert.rejects(
        () => api.DataService.updateNote("u-1", "x", 1),
        (error) => error.name === "ConflictError"
    );
});

tests.push(async function test_auth_remember_and_silent_refresh() {
    const routes = {
        "https://api.example/api/v1/auth/refresh": () => okJson({
            access_token: "new-access", refresh_token: "new-refresh"
        })
    };
    const { api, storage } = loadApi({
        seed: { "my-tech-lab-refresh-token": "old-refresh" },
        fetchImpl: async (url) => { const r = routes[url]; if (r) return r(); throw new Error("unexpected " + url); }
    });

    assert.strictEqual(api.authClient.getAccessToken(), null);
    const ready = await api.authClient.ensureSession();
    assert.strictEqual(ready, true);
    assert.strictEqual(api.authClient.getAccessToken(), "new-access");
    assert.strictEqual(storage.getItem("my-tech-lab-refresh-token"), "new-refresh");

    api.authClient.clearSession();
    assert.strictEqual(api.authClient.getAccessToken(), null);
    assert.strictEqual(storage.getItem("my-tech-lab-refresh-token"), null);
});

(async () => {
    let passed = 0;
    let failed = 0;
    for (const test of tests) {
        try {
            await test();
            passed += 1;
            console.log("ok - " + test.name);
        } catch (error) {
            failed += 1;
            console.error("FAIL - " + test.name);
            console.error(error);
        }
    }
    console.log(`结果：${passed} 通过 / ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
})();
