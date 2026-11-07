/**
 * session.js — 「当前会话」追踪。
 *
 * 实际结构（对照 deepseek-harness 0.1.6-alpha.1 源码核对过，不是猜的）：
 *
 *   exec（packages/core/tools/src/index.ts → createExecution）
 *     { token, callId, rootCallId, name, signal, agent?, parent?, schema?, arguments,
 *       deferContext(), concludeTurn() }
 *     没有 sessionId / session 字段。
 *   exec.agent（packages/core/agent/src/types.ts + runtime-types.ts）
 *     { id: SessionId, session: Session, options, inbox, status, ctx, ... }
 *   Session（packages/core/session/src/index.ts）
 *     get id(): SessionId   // = header.id，运行时是字符串
 *     header: { id, createdAt, cwd?, parentSession?, origin?: 'subagent', delegationDepth?, ... }
 *
 * 所以按约定的顺序依次尝试 exec.sessionId → exec.session.id → exec.agent.session.id，
 * 实际命中的是 exec.agent.session.id；再兜底 exec.agent.id（同一个 SessionId），
 * 最后才退回 session/event 里记下的最近会话。
 *
 * 子智能体会话（header.origin === 'subagent'）的 parentSession 指向发起它的对话：
 * 它的事件和花费都归到父对话上，不会把「当前会话」抢走。
 */

const EXEC_PROBES = [
  ['exec.sessionId', (exec) => exec?.sessionId],
  ['exec.session.id', (exec) => exec?.session?.id],
  ['exec.agent.session.id', (exec) => exec?.agent?.session?.id],
  ['exec.agent.id', (exec) => exec?.agent?.id],
];

const MAX_LINKS = 500;

function asId(value) {
  return typeof value === 'string' && value ? value : null;
}

export function createSessionTracker() {
  let current = null;
  const parentOf = new Map();

  /** 记下「子会话 → 父会话」。只认 origin === 'subagent'；用户自己 fork 出来的对话算独立对话。 */
  function link(session) {
    const id = asId(session?.id);
    const header = session?.header;
    if (!id || !header || header.origin !== 'subagent') return;
    const parent = asId(header.parentSession);
    if (!parent || parent === id) return;
    if (parentOf.size >= MAX_LINKS) parentOf.delete(parentOf.keys().next().value);
    parentOf.set(id, parent);
  }

  /** 顺着父链走到顶层对话（带环保护）。 */
  function rootOf(id) {
    let cur = asId(id);
    for (let i = 0; cur && i < 16 && parentOf.has(cur); i += 1) cur = parentOf.get(cur);
    return cur;
  }

  return {
    /** session/event 回调里调用：记住最近活跃的顶层对话，返回它的 id。 */
    observe(session) {
      const id = asId(session?.id);
      if (!id) return null;
      link(session);
      current = rootOf(id);
      return current;
    },

    /** 工具执行时调用：优先从 exec 取，取不到退回事件里的最近会话。 */
    fromExec(exec) {
      for (const [field, probe] of EXEC_PROBES) {
        let raw;
        try { raw = asId(probe(exec)); } catch { raw = null; }
        if (!raw) continue;
        try { link(exec?.agent?.session); } catch { /* ignore */ }
        return { id: rootOf(raw), raw, field };
      }
      return { id: current, raw: null, field: current ? 'session/event' : null };
    },

    current() {
      return current;
    },

    rootOf,
  };
}

/**
 * 诊断用：只记字段名和类型，不记值，方便在日志里核对宿主给的真实结构。
 * Session.id 是原型上的 getter，Object.keys 列不出来，所以每个候选字段再单独记一次 typeof。
 */
export function describeExec(exec) {
  const keys = (v) => {
    if (!v || typeof v !== 'object') return null;
    try { return Object.keys(v).slice(0, 40); } catch { return null; }
  };
  const idTypes = {};
  for (const [field, probe] of EXEC_PROBES) {
    try { idTypes[field] = typeof probe(exec); } catch { idTypes[field] = 'throws'; }
  }
  return {
    execKeys: keys(exec),
    agentKeys: keys(exec?.agent),
    sessionKeys: keys(exec?.agent?.session),
    headerKeys: keys(exec?.agent?.session?.header),
    idTypes,
  };
}
