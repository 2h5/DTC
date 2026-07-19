"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const STORE_VERSION = 1;

function emptyState() {
  return { version: STORE_VERSION, orders: {}, events: {} };
}

function assertState(state) {
  if (
    !state ||
    state.version !== STORE_VERSION ||
    !state.orders ||
    typeof state.orders !== "object" ||
    Array.isArray(state.orders) ||
    !state.events ||
    typeof state.events !== "object" ||
    Array.isArray(state.events)
  ) {
    throw new Error("Order store has an unsupported or corrupt structure; refusing to continue.");
  }
  for (const [orderID, order] of Object.entries(state.orders)) {
    if (!order || order.orderID !== orderID || typeof order.tokenHash !== "string" || typeof order.status !== "string") {
      throw new Error("Order store contains a corrupt order record; refusing to continue.");
    }
  }
  for (const [eventID, event] of Object.entries(state.events)) {
    if (!event || event.eventID !== eventID || typeof event.eventType !== "string") {
      throw new Error("Order store contains a corrupt webhook record; refusing to continue.");
    }
  }
}

class JsonOrderStore {
  constructor(options) {
    this.directory = options.directory;
    this.filePath = path.join(this.directory, "checkout-state.json");
    this.clock = options.clock || (() => new Date());
    this.state = null;
    this.queue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      assertState(parsed);
      this.state = parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.state = emptyState();
      await this.#persist(this.state);
    }
    return this;
  }

  getOrder(orderID) {
    this.#assertReady();
    const order = this.state.orders[orderID];
    return order ? structuredClone(order) : null;
  }

  getEvent(eventID) {
    this.#assertReady();
    const event = this.state.events[eventID];
    return event ? structuredClone(event) : null;
  }

  listOrders() {
    this.#assertReady();
    return Object.values(this.state.orders).map((record) => structuredClone(record));
  }

  async createOrder(record) {
    return this.#mutate((draft) => {
      if (draft.orders[record.orderID]) throw new Error("Duplicate PayPal order ID in local store.");
      draft.orders[record.orderID] = structuredClone(record);
      return structuredClone(record);
    });
  }

  async updateOrder(orderID, patchOrUpdater) {
    return this.#mutate((draft) => {
      const existing = draft.orders[orderID];
      if (!existing) return null;
      const patch = typeof patchOrUpdater === "function" ? patchOrUpdater(structuredClone(existing)) : patchOrUpdater;
      const updated = { ...existing, ...patch, orderID, updatedAt: this.clock().toISOString() };
      draft.orders[orderID] = updated;
      return structuredClone(updated);
    });
  }

  async recordWebhook(event, orderID, orderPatch) {
    return this.#mutate((draft) => {
      if (draft.events[event.eventID]) return { duplicate: true, order: orderID ? structuredClone(draft.orders[orderID] || null) : null };
      draft.events[event.eventID] = structuredClone(event);
      let order = null;
      if (orderID && draft.orders[orderID] && orderPatch) {
        const existing = draft.orders[orderID];
        order = {
          ...existing,
          ...orderPatch,
          orderID,
          updatedAt: this.clock().toISOString(),
        };
        draft.orders[orderID] = order;
      }
      return { duplicate: false, order: order ? structuredClone(order) : null };
    });
  }

  #assertReady() {
    if (!this.state) throw new Error("Order store has not been initialized.");
  }

  async #mutate(mutator) {
    this.#assertReady();
    const operation = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      const result = mutator(draft);
      assertState(draft);
      await this.#persist(draft);
      this.state = draft;
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async #persist(state) {
    const tempPath = `${this.filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    const handle = await fs.open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tempPath, this.filePath);
      if (process.platform !== "win32") {
        const directoryHandle = await fs.open(this.directory, "r");
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }
}

module.exports = { JsonOrderStore, STORE_VERSION, assertState };
