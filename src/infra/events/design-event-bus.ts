import { EventEmitter } from "node:events";
import type { RigEnvelope } from "@/contracts/agent-events";

/**
 * 设计会话事件总线（agent-ui-design §4.2，P1）。
 *
 * 进程内 EventEmitter：service 每产生一条富事件就 publish，SSE 订阅者实时收到。
 * dev/单机部署够用；多实例部署时把 publish/subscribe 换成 Redis pub/sub 等外置实现，
 * 接口不变。globalThis 缓存与 db client 同款，规避 Next dev 热重载丢订阅者。
 */

const CHANNEL_PREFIX = "design:";

type BusStore = { __rigmateDesignBus?: EventEmitter };

const globalStore = globalThis as unknown as BusStore;

export function designEventBus(): EventEmitter {
  if (!globalStore.__rigmateDesignBus) {
    const bus = new EventEmitter();
    // 每个打开的会话页是一个订阅者，给足余量
    bus.setMaxListeners(64);
    globalStore.__rigmateDesignBus = bus;
  }
  return globalStore.__rigmateDesignBus;
}

export function publishRigEvent(envelope: RigEnvelope): void {
  designEventBus().emit(CHANNEL_PREFIX + envelope.requestId, envelope);
}

/** 返回退订函数；订阅必须先于回放查询，避免「查库与订阅之间」的事件缝隙 */
export function subscribeRigEvents(
  requestId: string,
  listener: (envelope: RigEnvelope) => void,
): () => void {
  const channel = CHANNEL_PREFIX + requestId;
  designEventBus().on(channel, listener);
  return () => {
    designEventBus().off(channel, listener);
  };
}
