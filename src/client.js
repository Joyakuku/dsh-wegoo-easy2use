/**
 * client.js — 浏览器侧入口（手写，无需构建）。
 *
 * 宿主用 window.__ModuleLoader__.load({ id, factory }) 加载浏览器插件，
 * factory 拿到 require 垫片（react 由宿主提供），返回 { apply, inject }。
 *
 * 数据通路 = 插件路由：POST /dsh-wegoo/<endpoint>，
 * 信封 { type:'client-request', rpcId, method, payload } → { type:'server-response', rpcId, result }。
 */
(() => {
  const MODULE_ID = 'dsh-wegoo-easy2use';

  const loader = window.__ModuleLoader__;
  if (!loader || typeof loader.load !== 'function') return;

  loader.load({
    id: MODULE_ID,
    factory(require2) {
      const React = require2('react');
      const h = React.createElement;

      const s = {
        card: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0' },
        row: { display: 'flex', alignItems: 'center', gap: 8 },
        label: { width: 120, flex: '0 0 auto', fontSize: 13, opacity: 0.85 },
        input: {
          flex: '1 1 auto', minWidth: 0, padding: '5px 8px', fontSize: 13,
          border: '1px solid rgba(128,128,128,0.35)', borderRadius: 6,
          background: 'transparent', color: 'inherit',
        },
        select: {
          flex: '1 1 auto', minWidth: 0, padding: '5px 8px', fontSize: 13,
          border: '1px solid rgba(128,128,128,0.35)', borderRadius: 6,
          background: 'transparent', color: 'inherit',
        },
        group: { fontSize: 12, fontWeight: 600, opacity: 0.75, marginTop: 4 },
        actions: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 },
        button: {
          padding: '5px 12px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
          border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit',
          whiteSpace: 'nowrap',
        },
        status: { fontSize: 12, opacity: 0.7 },
        warn: { fontSize: 12, color: '#d4373f' },
        hint: { fontSize: 11.5, opacity: 0.6 },
      };

      /** 插件路由调用：POST 到 /dsh-wegoo/<endpoint>，用宿主认的信封格式。 */
      async function rpc(endpoint, payload) {
        const rpcId = `wegoo-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const res = await fetch(new URL(`dsh-wegoo/${endpoint}`, document.baseURI), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: payload || {} }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const envelope = await res.json();
        if (!envelope || envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
          throw new Error('插件路由返回的信封不合法');
        }
        const result = envelope.result;
        if (!result || result.ok !== true) {
          throw new Error((result && result.error && result.error.message) || '调用被拒绝');
        }
        return result.value;
      }

      function Field({ label, value, onChange, type, placeholder }) {
        return h('div', { style: s.row },
          h('span', { style: s.label }, label),
          h('input', {
            style: s.input,
            type: type || 'text',
            value: value === undefined || value === null ? '' : String(value),
            placeholder: placeholder || '',
            onChange: (e) => onChange(e.target.value),
          }));
      }

      function Toggle({ label, checked, onChange }) {
        return h('div', { style: s.row },
          h('span', { style: s.label }, label),
          h('input', { type: 'checkbox', checked: !!checked, onChange: (e) => onChange(e.target.checked) }));
      }

      /** 模型下拉：列表来自服务端用该 key 扫出来的结果。 */
      function ModelPicker({ label, value, options, loading, onRefresh, onPick }) {
        const known = options.some((m) => m.id === value);
        return h('div', { style: s.row },
          h('span', { style: s.label }, label),
          h('select', {
            style: s.select,
            value: known ? value : '',
            onChange: (e) => onPick(e.target.value),
          },
            h('option', { value: '' }, options.length ? '（请选择）' : '（先点右侧获取）'),
            ...options.map((m) => h('option', { key: m.id, value: m.id }, `${m.id} · ${m.priceLabel}`)),
            known ? null : (value ? h('option', { key: '__cur', value }, `${value}（当前值，不在列表里）`) : null)),
          h('button', { style: s.button, onClick: onRefresh, disabled: loading }, loading ? '获取中…' : '获取模型'));
      }

      function WegooConfigPanel() {
        const [cfg, setCfg] = React.useState(null);
        const [err, setErr] = React.useState('');
        const [note, setNote] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const [models, setModels] = React.useState({ image: [], video: [] });
        const [loading, setLoading] = React.useState({ image: false, video: false });
        const [keys, setKeys] = React.useState({ image: '', video: '' });

        const loadModels = React.useCallback(async (kind, apiKey) => {
          setLoading((l) => ({ ...l, [kind]: true }));
          try {
            const r = await rpc('models', { kind, apiKey: apiKey || '' });
            const list = (r && r.models) || [];
            setModels((m) => ({ ...m, [kind]: list }));
            setCfg((c) => {
              if (!c) return c;
              const cur = c[kind] || {};
              if (cur.defaultModel) return c;
              const first = list.find((x) => x.fixedUsd) || list[0];
              if (!first) return c;
              return { ...c, [kind]: { ...cur, defaultModel: first.id } };
            });
            return list;
          } catch (e) {
            setNote(`获取模型失败：${(e && e.message) || e}`);
            return [];
          } finally {
            setLoading((l) => ({ ...l, [kind]: false }));
          }
        }, []);

        React.useEffect(() => {
          let alive = true;
          rpc('get', {})
            .then((r) => {
              if (!alive || !r) return;
              setCfg(r);
              if (r.imageKeySet) void loadModels('image', '');
              if (r.videoKeySet) void loadModels('video', '');
            })
            .catch((e) => { if (alive) setErr(String((e && e.message) || e)); });
          return () => { alive = false; };
        }, [loadModels]);

        if (err) return h('div', { style: s.warn }, `读取配置失败：${err}`);
        if (!cfg) return h('div', { style: s.status }, '读取配置…');

        const patch = (fn) => {
          setCfg((c) => {
            const next = JSON.parse(JSON.stringify(c));
            fn(next);
            return next;
          });
          setNote('');
        };
        const img = cfg.image || {};
        const vid = cfg.video || {};
        const lim = cfg.limits || {};

        const save = async () => {
          setBusy(true);
          setNote('保存中…');
          try {
            await rpc('set', {
              patch: {
                image: { enabled: !!img.enabled, apiKey: keys.image || img.apiKey || '', defaultModel: img.defaultModel || '', maxUsdPerCall: Number(img.maxUsdPerCall) || 0 },
                video: { enabled: !!vid.enabled, apiKey: keys.video || vid.apiKey || '', defaultModel: vid.defaultModel || '', maxUsdPerCall: Number(vid.maxUsdPerCall) || 0 },
                limits: {
                  perCallUsd: Number(lim.perCallUsd) || 0,
                  totalUsd: Number(lim.totalUsd) || 0,
                  totalScope: lim.totalScope || 'day',
                  perMinute: Number(lim.perMinute) || 0,
                },
              },
            });
            const fresh = await rpc('get', {});
            if (fresh) setCfg(fresh);
            setKeys({ image: '', video: '' });
            setNote('已保存 · 下一次工具调用生效');
          } catch (e) {
            setNote(`保存失败：${(e && e.message) || e}`);
          } finally {
            setBusy(false);
          }
        };

        const keyInput = (kind, current) => h('div', { style: s.row },
          h('span', { style: s.label }, 'API Key'),
          h('input', {
            style: s.input,
            type: 'password',
            value: keys[kind],
            placeholder: current ? '已设置（留空不改）' : 'sk-...',
            onChange: (e) => {
              const v = e.target.value;
              setKeys((k) => ({ ...k, [kind]: v }));
            },
          }));

        return h('div', { style: s.card },
          h('div', { style: s.group }, '图像'),
          h(Toggle, { label: '允许调用', checked: img.enabled, onChange: (v) => patch((n) => { n.image = { ...(n.image || {}), enabled: v }; }) }),
          keyInput('image', img.apiKey),
          h(ModelPicker, {
            label: '默认模型',
            value: img.defaultModel,
            options: models.image,
            loading: loading.image,
            onRefresh: () => loadModels('image', keys.image),
            onPick: (v) => patch((n) => { n.image = { ...(n.image || {}), defaultModel: v }; }),
          }),

          h('div', { style: s.group }, '视频'),
          h(Toggle, { label: '允许调用', checked: vid.enabled, onChange: (v) => patch((n) => { n.video = { ...(n.video || {}), enabled: v }; }) }),
          keyInput('video', vid.apiKey),
          h(ModelPicker, {
            label: '默认模型',
            value: vid.defaultModel,
            options: models.video,
            loading: loading.video,
            onRefresh: () => loadModels('video', keys.video),
            onPick: (v) => patch((n) => { n.video = { ...(n.video || {}), defaultModel: v }; }),
          }),

          h('div', { style: s.group }, '限额'),
          h(Field, { label: '单次上限 USD', value: lim.perCallUsd, onChange: (v) => patch((n) => { n.limits = { ...(n.limits || {}), perCallUsd: v }; }) }),
          h(Field, { label: '总额上限 USD', value: lim.totalUsd, onChange: (v) => patch((n) => { n.limits = { ...(n.limits || {}), totalUsd: v }; }) }),
          h(Field, { label: '每分钟次数', value: lim.perMinute, onChange: (v) => patch((n) => { n.limits = { ...(n.limits || {}), perMinute: v }; }) }),

          h('div', { style: s.actions },
            h('button', { style: s.button, onClick: save, disabled: busy }, busy ? '保存中…' : '保存'),
            note ? h('span', { style: s.status }, note) : null),
          h('div', { style: s.hint }, '填好 Key 先点「获取模型」拉列表再选；保存后下一次工具调用生效。'));
      }

      /**
       * 右上角悬浮结算窗：纯 DOM，不依赖 slot / React，5 秒刷新。
       *
       * 动画不被轮询打断的关键：骨架只建一次，之后轮询只改 textContent / style.width / className，
       * 列表行按 entry.id 复用，所以进行中的 transition / animation 不会因为节点被重建而中断。
       */
      const EASE = 'cubic-bezier(.22,1,.36,1)';
      const BADGE_CSS = `
        #wegoo-cost-badge{position:fixed;top:104px;left:0;z-index:2147483647;
          font:12px/1.5 -apple-system,"SF Pro Text","Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif;
          color:#1d1d1f;-webkit-font-smoothing:antialiased;user-select:none;cursor:pointer;
          font-variant-numeric:tabular-nums}
        #wegoo-cost-badge *{box-sizing:border-box}
        .wg-pill{display:inline-flex;align-items:center;gap:8px;padding:7px 13px 7px 11px;
          border-radius:999px;background:#fff;border:1px solid #ececf1;
          box-shadow:0 6px 20px rgba(17,24,39,.08);transform-origin:top right;
          transition:opacity 160ms ease,transform 240ms ${EASE}}
        .wg-open .wg-pill{opacity:0;transform:scale(.96)}
        .wg-dot{width:7px;height:7px;border-radius:50%;background:#30c463;box-shadow:0 0 0 3px rgba(48,196,99,.14);flex:0 0 auto;
          transition:background-color 240ms ease,box-shadow 240ms ease}
        .wg-dot.bad{background:#ff453a;box-shadow:0 0 0 3px rgba(255,69,58,.16)}
        .wg-pill .n{color:#6e6e73;font-weight:500;font-size:12.5px}
        .wg-pill .a{font-weight:650;font-size:12.5px;letter-spacing:-.01em}
        .wg-pill .c{color:#98989d;font-size:9px;margin-left:1px}
        .wg-card{position:absolute;top:0;right:0;width:372px;background:#fff;border:1px solid #ececf1;border-radius:18px;
          box-shadow:0 18px 48px rgba(17,24,39,.10),0 2px 8px rgba(17,24,39,.05);overflow:hidden;
          transform-origin:top right;transform:scale(.96) translateY(-4px);opacity:0;
          visibility:hidden;pointer-events:none;
          transition:transform 240ms ${EASE},opacity 240ms ${EASE},visibility 0s linear 240ms}
        .wg-open .wg-card{transform:none;opacity:1;visibility:visible;pointer-events:auto;transition-delay:0s}
        .wg-head{padding:15px 17px 12px;border-bottom:1px solid #ececf1}
        .wg-top{display:flex;align-items:baseline;justify-content:space-between}
        .wg-title{font-size:12.5px;font-weight:650;display:flex;align-items:center;gap:7px}
        .wg-total{font-size:23px;font-weight:680;letter-spacing:-.025em;font-variant-numeric:tabular-nums}
        .wg-total i{font-style:normal;font-size:14px;font-weight:600;color:#98989d;margin-right:1px}
        .wg-bar{height:6px;border-radius:3px;background:#f4f4f7;margin:12px 0 8px;overflow:hidden}
        .wg-bar>i{display:block;width:0;height:100%;border-radius:3px;background:linear-gradient(90deg,#30c463,#34d17a);
          transition:width .6s ${EASE}}
        .wg-bar>i.bad{background:linear-gradient(90deg,#ff453a,#ff6961)}
        .wg-meta{display:flex;justify-content:space-between;font-size:11.5px;color:#6e6e73}
        .wg-meta b{color:#1d1d1f;font-weight:600}
        .wg-meta .r{color:#98989d}
        .wg-seg{position:relative;display:flex;background:#f4f4f7;padding:2px;border-radius:9px;margin-top:11px}
        .wg-seg-thumb{position:absolute;top:2px;bottom:2px;left:2px;width:calc((100% - 4px) / 3);border-radius:7px;
          background:#fff;box-shadow:0 1px 3px rgba(17,24,39,.09);transition:transform 240ms ${EASE}}
        .wg-seg span{position:relative;z-index:1;flex:1;text-align:center;font-size:11.5px;padding:5px 0;
          color:#6e6e73;font-weight:550;transition:color 160ms ease}
        .wg-seg span.on{color:#1d1d1f}
        .wg-list{max-height:260px;overflow-y:auto;overscroll-behavior:contain;--wg-ft:0px;--wg-fb:0px;
          -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 var(--wg-ft),#000 calc(100% - var(--wg-fb)),transparent 100%);
          mask-image:linear-gradient(to bottom,transparent 0,#000 var(--wg-ft),#000 calc(100% - var(--wg-fb)),transparent 100%)}
        .wg-list.wg-up{--wg-ft:12px}
        .wg-list.wg-down{--wg-fb:12px}
        .wg-row{display:flex;align-items:center;gap:9px;padding:10px 17px;border-bottom:1px solid #f4f4f7;
          transition:background-color 40ms linear}
        .wg-row:last-child{border-bottom:none}
        .wg-row:hover{background:#f7f7fa}
        @keyframes wg-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        .wg-in{animation:wg-rise 280ms ${EASE} both}
        .wg-t{font-size:10.5px;color:#98989d;width:52px;flex:0 0 auto;font-variant-numeric:tabular-nums}
        .wg-chip{font-size:10px;font-weight:600;padding:2.5px 7px;border-radius:6px;flex:0 0 auto;letter-spacing:.01em}
        .wg-chip.img{color:#6e5cf6;background:#f1eeff}
        .wg-chip.vid{color:#0a84ff;background:#e9f3ff}
        .wg-chip.sub{color:#b26a00;background:#fff3e0}
        .wg-l{flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .wg-r{text-align:right;flex:0 0 auto;min-width:92px;font-variant-numeric:tabular-nums}
        .wg-r .v{display:inline-block;font-size:12.5px;font-weight:650;letter-spacing:-.01em}
        .wg-r .q{font-size:10.5px;color:#98989d;margin-top:1px}
        .wg-amt{border-radius:4px;font-variant-numeric:tabular-nums;
          transition:background-color 200ms ease,box-shadow 200ms ease}
        .wg-amt.wg-flash{background-color:rgba(255,204,0,.28);box-shadow:0 0 0 2px rgba(255,204,0,.28);transition:none}
        .wg-foot{display:flex;align-items:center;justify-content:space-between;padding:8px 17px;
          border-top:1px solid #ececf1;font-size:10.5px;color:#98989d}
        .wg-live{display:flex;align-items:center;gap:6px}
        .wg-live i{width:5px;height:5px;border-radius:50%;background:#30c463;font-style:normal;transition:background-color 240ms ease}
        .wg-live.off i{background:#c7c7cc}
        .wg-empty{padding:22px 16px 20px;text-align:center}
        .wg-empty[hidden]{display:none}
        .wg-empty .e1{font-size:12.5px;font-weight:550;color:#6e6e73}
        .wg-empty .e2{font-size:11px;color:#98989d;margin-top:3px}
        .wg-empty .e2:empty{display:none}
        @media (prefers-reduced-motion: reduce){
          #wegoo-cost-badge,#wegoo-cost-badge *{animation:none !important;transition:none !important}
          #wegoo-cost-badge .wg-amt.wg-flash{background-color:transparent;box-shadow:none}
        }
      `;

      const SCOPE_LABEL = { day: '今日', session: '本次会话', all: '累计' };
      const SCOPES = Object.keys(SCOPE_LABEL);
      const KIND_CHIP = {
        image: ['img', 'IMAGE'],
        video: ['vid', 'VIDEO'],
        subagent: ['sub', 'AGENT'],
      };

      /** 空列表文案：[标题, 提示]。 */
      const EMPTY_COPY = {
        day: ['今天还没有花一分钱', '生成图片或视频后，账单会实时出现在这里'],
        session: ['这次对话还没有花费', '在当前对话里生成图片或视频后，会出现在这里'],
        all: ['还没有任何记录', '第一次生成图片或视频后，就会从这里开始记账'],
        noSession: ['还没认出当前对话', '在对话里发一条消息，就会开始按对话统计'],
        loading: ['正在读取账本…', ''],
        offline: ['暂时连不上本地服务', '每 5 秒会自动重试，不影响已记录的账单'],
      };

      /** 静态骨架：只在挂载时写一次，之后只按 data-ref 改文本 / 宽度 / className。 */
      const BADGE_SKELETON = [
        '<div class="wg-pill" data-ref="pill" role="button" aria-expanded="false">',
        '<span class="wg-dot" data-ref="pillDot"></span><span class="n">wegoo</span>',
        '<span class="a wg-amt" data-ref="pillAmt">…</span><span class="c">▾</span>',
        '</div>',
        '<div class="wg-card" data-ref="card">',
        '<div class="wg-head">',
        '<div class="wg-top">',
        '<div class="wg-title"><span class="wg-dot" data-ref="titleDot"></span>wegoo 结算</div>',
        '<div class="wg-total"><i>$</i><span class="wg-amt" data-ref="total">—</span></div>',
        '</div>',
        '<div class="wg-bar"><i data-ref="bar"></i></div>',
        '<div class="wg-meta">',
        '<span><span data-ref="metaScope">今日</span> <b data-ref="metaSpent">—</b> / <span data-ref="metaLimit">—</span></span>',
        '<span class="r">剩余 <span data-ref="remaining">—</span></span>',
        '</div>',
        '<div class="wg-seg" data-ref="seg"><i class="wg-seg-thumb" data-ref="thumb"></i>',
        SCOPES.map((key) => `<span data-scope="${key}">${SCOPE_LABEL[key]}</span>`).join(''),
        '</div>',
        '</div>',
        '<div class="wg-list" data-ref="list">',
        '<div class="wg-rows" data-ref="rows"></div>',
        '<div class="wg-empty" data-ref="empty"><div class="e1" data-ref="emptyTitle"></div><div class="e2" data-ref="emptyHint"></div></div>',
        '</div>',
        '<div class="wg-foot">',
        '<span class="wg-live" data-ref="live"><i></i><span data-ref="liveText">实时</span></span>',
        '<span>单次上限 <span data-ref="perCall">—</span> · 每 5 秒刷新</span>',
        '</div>',
        '</div>',
      ].join('');

      /** 右上角悬浮结算窗：纯 DOM，不依赖 slot / React，5 秒刷新。 */
      function mountBadge(rpc) {
        if (document.getElementById('wegoo-cost-badge')) return;
        const ensureStyle = () => {
          let style = document.getElementById('wegoo-cost-badge-style');
          if (!style) {
            style = document.createElement('style');
            style.id = 'wegoo-cost-badge-style';
            (document.head || document.documentElement).appendChild(style);
          }
          if (style.textContent !== BADGE_CSS) style.textContent = BADGE_CSS;
        };
        ensureStyle();

        // 首次渲染：建骨架、留引用。之后不再整块重写。
        const root = document.createElement('div');
        root.id = 'wegoo-cost-badge';
        root.innerHTML = BADGE_SKELETON;
        document.body.appendChild(root);

        const refs = {};
        root.querySelectorAll('[data-ref]').forEach((el) => { refs[el.getAttribute('data-ref')] = el; });
        const segItems = Array.from(refs.seg.querySelectorAll('[data-scope]'));
        /** entry.id → { el, t, chip, l, v, q } */
        const rowMap = new Map();

        let open = false;
        let data = null;
        let scope = null;
        let stale = false;
        let lastSessionId;
        let seq = 0;
        let reported = false;

        const money = (v) => (Number.isFinite(Number(v)) ? `$${Number(v).toFixed(4)}` : '—');
        const clock = (ts) => {
          const d = new Date(ts || Date.now());
          const p = (n) => String(n).padStart(2, '0');
          return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        };

        const place = () => {
          const w = root.offsetWidth || 0;
          const vw = window.innerWidth || document.documentElement.clientWidth || 0;
          root.style.left = `${Math.max(8, vw - w - 20)}px`;
          root.style.top = '104px';
          if (!reported && w > 0) {
            reported = true;
            const r = root.getBoundingClientRect();
            rpc('ping', {
              stage: 'rect', x: Math.round(r.x), y: Math.round(r.y),
              w: Math.round(r.width), h: Math.round(r.height),
              vw, vh: window.innerHeight,
            }).catch(() => {});
          }
        };

        const quoteText = (q) => {
          if (!Array.isArray(q)) return '无报价';
          return q[1] !== q[0]
            ? `报价 $${Number(q[0]).toFixed(2)}~${Number(q[1]).toFixed(2)}`
            : `报价 ${money(q[0])}`;
        };

        // ---- 只改 textContent / style.width / className 的小工具（值没变就不碰 DOM）

        /** 金额变化：加 wg-flash，200ms 后移除。 */
        const flash = (node) => {
          clearTimeout(node.__wgFlash);
          node.classList.add('wg-flash');
          node.__wgFlash = setTimeout(() => node.classList.remove('wg-flash'), 200);
        };
        const setText = (node, text, flashOnChange) => {
          const next = String(text);
          if (node.textContent === next) return;
          const hadValue = node.__wgSet === true; // 骨架占位符 → 首个真实值不算「变化」
          node.textContent = next;
          node.__wgSet = true;
          if (flashOnChange && hadValue) flash(node);
        };
        const setClass = (node, cls) => {
          if (node.className !== cls) node.className = cls;
        };
        const setWidth = (node, width) => {
          if (node.__wgWidth === width) return;
          node.__wgWidth = width;
          node.style.width = width;
        };

        /** 新行入场：淡入 + 上移 6px；同一批新行 animation-delay 递增 25ms，最多错开 5 行。 */
        const enter = (el, order) => {
          el.style.animationDelay = `${Math.min(order, 4) * 25}ms`;
          el.classList.add('wg-in');
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            el.classList.remove('wg-in');
            el.style.animationDelay = '';
          };
          el.addEventListener('animationend', finish, { once: true });
          setTimeout(finish, 700); // 减少动态模式下没有 animationend，靠它收尾
        };

        /** 滑块：translateX 到当前口径。 */
        const paintSeg = (active) => {
          const idx = Math.max(0, SCOPES.indexOf(active));
          const transform = `translateX(${idx * 100}%)`;
          if (refs.thumb.__wgTransform !== transform) {
            refs.thumb.__wgTransform = transform;
            refs.thumb.style.transform = transform;
          }
          for (const el of segItems) setClass(el, el.getAttribute('data-scope') === active ? 'on' : '');
        };

        /** 上下渐隐：只在那一侧还有内容可滚时出现。 */
        const paintFade = () => {
          const el = refs.list;
          el.classList.toggle('wg-up', el.scrollTop > 1);
          el.classList.toggle('wg-down', el.scrollTop + el.clientHeight < el.scrollHeight - 1);
        };
        refs.list.addEventListener('scroll', paintFade, { passive: true });
        refs.list.addEventListener('animationend', paintFade);

        const showEmpty = ([title, hint]) => {
          setText(refs.emptyTitle, title);
          setText(refs.emptyHint, hint);
          if (refs.empty.hidden) {
            refs.empty.hidden = false;
            enter(refs.empty, 0);
          }
        };
        const hideEmpty = () => {
          if (!refs.empty.hidden) refs.empty.hidden = true;
        };

        const makeRow = () => {
          const make = (tag, cls) => {
            const el = document.createElement(tag);
            el.className = cls;
            return el;
          };
          const el = make('div', 'wg-row');
          const t = make('span', 'wg-t');
          const chip = make('span', 'wg-chip');
          const l = make('span', 'wg-l');
          const r = make('div', 'wg-r');
          const v = make('div', 'v wg-amt');
          const q = make('div', 'q');
          r.append(v, q);
          el.append(t, chip, l, r);
          return { el, t, chip, l, v, q };
        };

        const fillRow = (row, e) => {
          const [cls, text] = KIND_CHIP[e.kind] || ['img', String(e.kind || '?').toUpperCase()];
          const label = String(e.label || '');
          setText(row.t, clock(e.at));
          setClass(row.chip, `wg-chip ${cls}`);
          setText(row.chip, text);
          setText(row.l, label);
          if (row.l.title !== label) row.l.title = label;
          setText(row.v, money(e.settledUsd), true);
          setText(row.q, quoteText(e.quoteUsd));
        };

        const resetRows = () => {
          for (const row of rowMap.values()) row.el.remove();
          rowMap.clear();
        };

        /** 按 id 对齐列表：新增插入、消失删除、只有顺序不对才 insertBefore。 */
        const syncRows = (entries) => {
          const wanted = [];
          const ids = new Set();
          for (const e of entries) {
            if (!e) continue;
            const id = String(e.id != null ? e.id : `${e.at}|${e.kind}|${e.label}`);
            if (ids.has(id)) continue;
            ids.add(id);
            wanted.push([id, e]);
          }
          for (const [id, row] of rowMap) {
            if (!ids.has(id)) {
              row.el.remove();
              rowMap.delete(id);
            }
          }
          let fresh = 0;
          wanted.forEach(([id, e], i) => {
            let row = rowMap.get(id);
            if (!row) {
              row = makeRow();
              rowMap.set(id, row);
              enter(row.el, fresh);
              fresh += 1;
            }
            fillRow(row, e);
            const at = refs.rows.children[i] || null;
            if (at !== row.el) refs.rows.insertBefore(row.el, at);
          });
          return wanted.length;
        };

        const paint = () => {
          const active = scope || (data && data.scope) || 'day';
          paintSeg(active);
          setText(refs.metaScope, SCOPE_LABEL[active] || '今日');
          setClass(refs.live, stale ? 'wg-live off' : 'wg-live');
          setText(refs.liveText, stale ? '重连中…' : '实时');

          if (!data) {
            showEmpty(stale ? EMPTY_COPY.offline : EMPTY_COPY.loading);
            return;
          }

          const limit = Number(data.limit) || 0;
          const spent = Number(data.spent) || 0;
          const remaining = Number.isFinite(Number(data.remaining))
            ? Number(data.remaining)
            : Math.max(0, limit - spent);
          const ratio = limit > 0 ? Math.min(1, spent / limit) : 0;
          const over = limit > 0 && spent >= limit;
          const dotCls = over ? 'wg-dot bad' : 'wg-dot';

          setClass(refs.pillDot, dotCls);
          setClass(refs.titleDot, dotCls);
          setText(refs.pillAmt, money(spent), true);
          setText(refs.total, spent.toFixed(4), true);
          setText(refs.metaSpent, money(spent));
          setText(refs.metaLimit, money(limit));
          setText(refs.remaining, money(remaining));
          setText(refs.perCall, money(data.perCallUsd));
          setWidth(refs.bar, `${(ratio * 100).toFixed(1)}%`);
          setClass(refs.bar, over ? 'bad' : '');

          const count = syncRows(Array.isArray(data.entries) ? data.entries : []);
          if (count > 0) hideEmpty();
          else if (active === 'session' && !data.sessionId) showEmpty(EMPTY_COPY.noSession);
          else showEmpty(EMPTY_COPY[active] || EMPTY_COPY.day);
          paintFade();
        };

        const refresh = async () => {
          const mine = ++seq;
          let next = null;
          try {
            next = await rpc('ledger', scope ? { scope } : {});
          } catch (e) {
            next = null;
          }
          if (mine !== seq) return; // 期间又发了新请求（比如刚切口径），旧结果作废
          if (next) {
            stale = false;
            // 会话变了：本次会话口径整块重渲染（清掉旧行，新行重新入场），列表回到顶部。
            const sid = next.sessionId == null ? null : String(next.sessionId);
            if (lastSessionId !== undefined && sid !== lastSessionId) {
              if ((scope || next.scope) === 'session') resetRows();
              refs.list.scrollTop = 0;
            }
            lastSessionId = sid;
            data = next;
          } else {
            stale = true; // 保留上一份数据，只把「实时」灯变灰
          }
          paint();
          place();
        };

        const setOpen = (next) => {
          open = next;
          root.classList.toggle('wg-open', open);
          refs.pill.setAttribute('aria-expanded', open ? 'true' : 'false');
          if (open) paintFade();
          place();
        };

        root.addEventListener('click', (event) => {
          const target = event.target && event.target.closest ? event.target.closest('[data-scope]') : null;
          if (target) {
            const next = target.getAttribute('data-scope');
            if (next && next !== (scope || (data && data.scope))) {
              scope = next;
              paint(); // 滑块先动，不等网络
              void refresh();
            }
            return;
          }
          setOpen(!open);
        });

        window.addEventListener('resize', place);

        paint();

        const tick = async () => {
          // 自愈：宿主重渲染可能把 body 上的节点摘掉，发现没了就挂回去。
          if (!root.isConnected && document.body) {
            document.body.appendChild(root);
            rpc('ping', { stage: 'remounted', kids: document.body.childElementCount }).catch(() => {});
          }
          ensureStyle();
          await refresh();
          setTimeout(tick, 5000);
        };
        void tick();
      }
      function apply(ctx) {
        WegooConfigPanel.__rpc = rpc;
        rpc('ping', { stage: 'apply', ua: navigator.userAgent.slice(0, 40) }).catch(() => {});
        try {
          mountBadge(rpc);
          const el = document.getElementById('wegoo-cost-badge');
          rpc('ping', { stage: 'mounted', connected: !!(el && el.isConnected), bodyKids: document.body ? document.body.childElementCount : -1 }).catch(() => {});
        } catch (e) {
          rpc('ping', { stage: 'mount-failed', error: String((e && e.message) || e) }).catch(() => {});
        }
        ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
          name: 'plugins.detail.actions',
          id: 'dsh-wegoo-easy2use-config',
          order: 40,
          inject: () => ({}),
        }, WegooConfigPanel));
      }

      return { apply, inject: ['slots'] };
    },
  });
})();
