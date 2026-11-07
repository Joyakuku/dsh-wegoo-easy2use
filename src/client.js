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

      const PACKAGE_NAME = 'dsh-wegoo-easy2use';

      /** `plugins.detail.actions` 是列表插槽，每个插件详情页都会渲染；靠 subject.pkg.name 认领自己的页面。 */
      function pluginPackageName(subject) {
        const pkg = subject && typeof subject === 'object' ? subject.pkg : undefined;
        const name = pkg && typeof pkg === 'object' ? pkg.name : undefined;
        return typeof name === 'string' ? name : undefined;
      }

      const FORM_CSS = `
        #wegoo-form{font:12.5px/1.5 -apple-system,"SF Pro Text","Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif;
          color:#1d1d1f;-webkit-font-smoothing:antialiased;max-width:760px}
        #wegoo-form *{box-sizing:border-box}
        .wgf-card{width:100%;background:#fff;border:1px solid #ececf1;border-radius:16px;
          box-shadow:0 16px 42px rgba(17,24,39,.07),0 2px 6px rgba(17,24,39,.04);overflow:hidden}
        .wgf-sec{padding:18px 22px 20px;border-bottom:1px solid #f4f4f7}
        .wgf-sec:last-of-type{border-bottom:none}
        .wgf-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
        .wgf-title{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:650}
        .wgf-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
        .wgf-dot.img{background:#6e5cf6;box-shadow:0 0 0 3px #f1eeff}
        .wgf-dot.vid{background:#0a84ff;box-shadow:0 0 0 3px #e9f3ff}
        .wgf-dot.lim{background:#30c463;box-shadow:0 0 0 3px #eafaf0}
        .wgf-sub{font-size:11.5px;color:#98989d;margin-top:3px;font-weight:400}
        .wgf-sw{position:relative;width:38px;height:22px;border-radius:11px;background:#d8d8de;
          transition:background .18s;flex:0 0 auto;border:none;padding:0;cursor:pointer}
        .wgf-sw.on{background:#30c463}
        .wgf-sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
          background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .18s}
        .wgf-sw.on::after{transform:translateX(16px)}
        .wgf-field{display:grid;grid-template-columns:168px 1fr;gap:14px;align-items:start;margin-bottom:14px}
        .wgf-field:last-child{margin-bottom:0}
        .wgf-lab{padding-top:7px}
        .wgf-lab b{font-weight:550;font-size:12.5px}
        .wgf-lab span{display:block;font-size:11px;color:#98989d;margin-top:3px;line-height:1.45}
        .wgf-ctl{display:flex;gap:8px;align-items:center;min-width:0}
        .wgf-inp{flex:1;min-width:0;height:34px;padding:0 11px;border:1px solid #ececf1;border-radius:9px;background:#fff;
          font-size:12.5px;color:#1d1d1f;outline:none;transition:border-color .15s,box-shadow .15s;
          font-variant-numeric:tabular-nums;font-family:inherit}
        .wgf-inp:focus{border-color:#bfb6ff;box-shadow:0 0 0 3px rgba(110,92,246,.14)}
        .wgf-inp.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
        .wgf-btn{height:34px;padding:0 13px;border-radius:9px;border:1px solid #ececf1;background:#fff;font-size:12.5px;
          color:#1d1d1f;cursor:pointer;white-space:nowrap;transition:background .15s;font-family:inherit}
        .wgf-btn:hover:not(:disabled){background:#f4f4f7}
        .wgf-btn:disabled{opacity:.5;cursor:default}
        .wgf-btn.primary{background:#1d1d1f;border-color:#1d1d1f;color:#fff;font-weight:550}
        .wgf-btn.primary:hover:not(:disabled){background:#000}
        .wgf-btn.ghost{border-color:transparent;background:transparent;color:#6e6e73}
        .wgf-sel{position:relative;flex:1;min-width:0}
        .wgf-sel select{width:100%;height:34px;appearance:none;border:1px solid #ececf1;border-radius:9px;
          background:#fff;font-size:12.5px;color:#1d1d1f;padding:0 108px 0 11px;outline:none;cursor:pointer;font-family:inherit}
        .wgf-sel select:focus{border-color:#bfb6ff;box-shadow:0 0 0 3px rgba(110,92,246,.14)}
        .wgf-sel .chev{position:absolute;right:92px;top:50%;transform:translateY(-50%);font-size:9px;
          color:#98989d;pointer-events:none}
        .wgf-tag{position:absolute;right:9px;top:50%;transform:translateY(-50%);font-size:10.5px;font-weight:600;
          color:#1f9254;background:#eafaf0;padding:2px 7px;border-radius:6px;pointer-events:none;white-space:nowrap}
        .wgf-hint{font-size:11px;color:#98989d;margin-top:6px;display:flex;align-items:center;gap:5px}
        .wgf-hint.ok{color:#1f9254}
        .wgf-hint.bad{color:#ff453a}
        .wgf-hint i{width:4px;height:4px;border-radius:50%;background:currentColor;flex:0 0 auto}
        .wgf-row3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
        .wgf-box{border:1px solid #ececf1;border-radius:11px;padding:10px 12px;background:#fff}
        .wgf-box.err{border-color:#ff453a}
        .wgf-box b{display:block;font-size:11px;color:#98989d;font-weight:500;margin-bottom:6px}
        .wgf-box .v{display:flex;align-items:baseline;gap:5px}
        .wgf-box input{border:none;outline:none;width:100%;font-size:16px;font-weight:650;letter-spacing:-.01em;
          font-variant-numeric:tabular-nums;color:#1d1d1f;background:transparent;padding:0;font-family:inherit}
        .wgf-box .u{font-size:11px;color:#98989d}
        .wgf-meter{margin-top:12px}
        .wgf-meter .top{display:flex;justify-content:space-between;font-size:11.5px;color:#6e6e73;margin-bottom:6px}
        .wgf-meter .top b{color:#1d1d1f;font-weight:600;font-variant-numeric:tabular-nums}
        .wgf-bar{height:6px;border-radius:3px;background:#f4f4f7;overflow:hidden}
        .wgf-bar>i{display:block;height:100%;border-radius:3px;
          background:linear-gradient(90deg,#30c463,#34d17a);transition:width .5s cubic-bezier(.22,1,.36,1)}
        .wgf-bar>i.bad{background:linear-gradient(90deg,#ff453a,#ff6961)}
        .wgf-foot{display:flex;align-items:center;justify-content:space-between;padding:13px 22px;
          background:#fcfcfd;border-top:1px solid #ececf1;gap:12px}
        .wgf-dirty{display:flex;align-items:center;gap:7px;font-size:11.5px;color:#b26a00;min-width:0}
        .wgf-dirty i{width:6px;height:6px;border-radius:50%;background:#b26a00;flex:0 0 auto}
        .wgf-dirty.saved{color:#98989d}
        .wgf-dirty.saved i{background:#30c463}
        .wgf-dirty.bad{color:#ff453a}
        .wgf-dirty.bad i{background:#ff453a}
        .wgf-acts{display:flex;gap:8px;align-items:center;flex:0 0 auto}
        .wgf-gear{height:28px;padding:0 10px;border-radius:8px;border:1px solid #ececf1;background:#fff;
          font-size:11.5px;color:#6e6e73;cursor:pointer;white-space:nowrap;font-family:inherit;margin-right:10px}
        .wgf-gear:hover{background:#f4f4f7;color:#1d1d1f}
        .wgf-gear.hot{border-color:#bfb6ff;color:#6e5cf6;background:#f1eeff}
        .wgf-mask{position:fixed;inset:0;background:rgba(17,24,39,.28);display:flex;align-items:center;
          justify-content:center;z-index:2147483600;padding:24px}
        .wgf-modal{width:520px;max-width:100%;background:#fff;border-radius:16px;overflow:hidden;
          box-shadow:0 24px 64px rgba(17,24,39,.24);font-size:12.5px;color:#1d1d1f}
        .wgf-modal-h{padding:16px 20px 12px;border-bottom:1px solid #f4f4f7}
        .wgf-modal-h b{font-size:13.5px;font-weight:650}
        .wgf-modal-h p{margin-top:4px;font-size:11.5px;color:#98989d}
        .wgf-modal-b{padding:16px 20px}
        .wgf-ta{width:100%;min-height:96px;padding:10px 11px;border:1px solid #ececf1;border-radius:10px;
          font:12.5px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none;resize:vertical;color:#1d1d1f}
        .wgf-ta:focus{border-color:#bfb6ff;box-shadow:0 0 0 3px rgba(110,92,246,.14)}
        .wgf-modal-f{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;background:#fcfcfd;
          border-top:1px solid #ececf1}
        .wgf-warn{padding:16px 22px;color:#ff453a;font-size:12px}
        .wgf-loading{padding:22px;color:#98989d;font-size:12px}
      `;

      const QUOTA = 500000;

      const numOr = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
      const clone = (v) => JSON.parse(JSON.stringify(v));

      /** 只取面板真正编辑的字段，用于脏状态比较。 */
      function draftOf(cfg) {
        return {
          image: {
            enabled: Boolean(cfg?.image?.enabled),
            defaultModel: cfg?.image?.defaultModel || '',
            maxUsdPerCall: numOr(cfg?.image?.maxUsdPerCall),
          },
          video: {
            enabled: Boolean(cfg?.video?.enabled),
            defaultModel: cfg?.video?.defaultModel || '',
            maxUsdPerCall: numOr(cfg?.video?.maxUsdPerCall),
          },
          limits: {
            perCallUsd: numOr(cfg?.limits?.perCallUsd),
            totalUsd: numOr(cfg?.limits?.totalUsd),
            totalScope: cfg?.limits?.totalScope || 'day',
            perMinute: numOr(cfg?.limits?.perMinute),
          },
        };
      }

      /** 模型行的价格标签：固定价直接给单价，按量给个量级。 */
      function priceTagOf(list, id) {
        const found = (list || []).find((m) => m.id === id);
        if (!found) return '';
        if (Number.isFinite(Number(found.fixedUsd)) && Number(found.fixedUsd) > 0) {
          return `$${Number(found.fixedUsd).toFixed(4)} / 次`;
        }
        const perMillion = /约\s*\$([\d.]+)\s*\/\s*1M/.exec(String(found.priceLabel || ''));
        if (perMillion) return `按量 $${perMillion[1]}/M`;
        return '按量计费';
      }

      function WegooConfigPanel() {
        const [saved, setSaved] = React.useState(null);
        const [draft, setDraft] = React.useState(null);
        const [keys, setKeys] = React.useState({ image: '', video: '' });
        const [models, setModels] = React.useState({ image: [], video: [] });
        const [loading, setLoading] = React.useState({ image: false, video: false });
        const [ledger, setLedger] = React.useState(null);
        const [err, setErr] = React.useState('');
        const [note, setNote] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const [touched, setTouched] = React.useState(false);
        const [editing, setEditing] = React.useState(null);

        const loadModels = React.useCallback(async (kind, key) => {
          setLoading((l) => ({ ...l, [kind]: true }));
          try {
            const r = await rpc('models', { kind, apiKey: key || '' });
            const list = (r && r.models) || [];
            setModels((m) => ({ ...m, [kind]: list }));
            return list;
          } catch (e) {
            setNote(`拉取模型失败：${(e && e.message) || e}`);
            return [];
          } finally {
            setLoading((l) => ({ ...l, [kind]: false }));
          }
        }, []);

        // 每 5 秒和宿主对一次账：外部改了配置（工具、直接编辑文件）或花了钱，
        // 表单和预算条都要跟上。用户有未保存修改时不覆盖输入框，只更新已保存快照。
        const dirtyRef = React.useRef(false);
        React.useEffect(() => {
          let alive = true;
          let first = true;
          const pull = async () => {
            try {
              const [cfg, led] = await Promise.all([rpc('get', {}), rpc('ledger', {})]);
              if (!alive) return;
              if (cfg) {
                // 值没变就不 setState，避免每 5 秒重建一次整棵表单导致输入框失焦。
                setSaved((prev) => (JSON.stringify(prev) === JSON.stringify(cfg) ? prev : cfg));
                if (!dirtyRef.current) {
                  setDraft((d) => {
                    const next = draftOf(cfg);
                    return JSON.stringify(d) === JSON.stringify(next) ? d : next;
                  });
                }
                if (first) {
                  first = false;
                  if (cfg.imageKeySet) void loadModels('image', '');
                  if (cfg.videoKeySet) void loadModels('video', '');
                }
              }
              if (led) setLedger((prev) => (ledgerKey(prev) === ledgerKey(led) ? prev : led));
            } catch (e) {
              if (alive && first) setErr(String((e && e.message) || e));
            }
          };
          void pull();
          const timer = setInterval(() => { void pull(); }, 5000);
          return () => { alive = false; clearInterval(timer); };
        }, [loadModels]);

        if (err) return h('div', { className: 'wgf-warn' }, `读取配置失败：${err}`);
        if (!saved || !draft) return h('div', { className: 'wgf-loading' }, '读取配置…');

        const patch = (fn) => {
          setDraft((d) => {
            const next = clone(d);
            fn(next);
            return next;
          });
          setTouched(true);
          setNote('');
        };

        const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(saved)) || Boolean(keys.image || keys.video);
        dirtyRef.current = dirty || Boolean(keys.image || keys.video);
        const limitsBad = !(draft.limits.perCallUsd > 0) || !(draft.limits.totalUsd > 0) || !(draft.limits.perMinute > 0);

        const save = async () => {
          if (limitsBad) {
            setNote('限额必须都是大于 0 的数字');
            return;
          }
          setBusy(true);
          setNote('保存中…');
          try {
            await rpc('set', {
              patch: {
                image: { ...draft.image, apiKey: keys.image || '' },
                video: { ...draft.video, apiKey: keys.video || '' },
                limits: draft.limits,
              },
            });
            const fresh = await rpc('get', {});
            if (fresh) {
              setSaved(fresh);
              setDraft(draftOf(fresh));
            }
            setKeys({ image: '', video: '' });
            setTouched(false);
            setNote('已保存 · 下一次工具调用生效');
            rpc('ledger', {}).then((l) => { if (l) setLedger(l); }).catch(() => {});
          } catch (e) {
            setNote(`保存失败：${(e && e.message) || e}`);
          } finally {
            setBusy(false);
          }
        };

        const reset = () => {
          setDraft(draftOf(saved));
          setKeys({ image: '', video: '' });
          setTouched(false);
          setNote('');
        };

        const keyHint = (kind) => {
          if (keys[kind]) return { cls: '', text: '未保存 · 输入后需点保存' };
          if (saved && saved[`${kind}KeySet`]) {
            const n = models[kind].length;
            return { cls: 'ok', text: n > 0 ? `已设置 · 已拉取到 ${n} 个可用模型` : '已设置 · 尚未拉取模型列表' };
          }
          return { cls: 'bad', text: '未设置 · 填写后保存' };
        };

        const section = (kind, title, sub, dotClass, keyLabel, keyHintText, modelHint) => {
          const draftKind = draft[kind];
          const hint = keyHint(kind);
          const tag = priceTagOf(models[kind], draftKind.defaultModel);
          return h('section', { className: 'wgf-sec', key: kind },
            h('div', { className: 'wgf-head' },
              h('div', null,
                h('div', { className: 'wgf-title' },
                  h('span', { className: `wgf-dot ${dotClass}` }),
                  title),
                h('div', { className: 'wgf-sub' }, sub)),
              h('div', { style: { display: 'flex', alignItems: 'center' } },
                h('button', {
                  type: 'button',
                  className: 'wgf-gear',
                  title: '编辑这个技能什么时候触发',
                  onClick: () => {
                    setEditing({ kind, text: '', loading: true });
                    rpc('skill', { action: 'get' })
                      .then((r) => setEditing({ kind, text: (r && r.description) || '', loading: false }))
                      .catch(() => setEditing({ kind, text: '', loading: false }));
                  },
                }, '触发描述'),
                h('button', {
                  type: 'button',
                  className: `wgf-sw${draftKind.enabled ? ' on' : ''}`,
                  'aria-label': `启用${title}`,
                  onClick: () => patch((n) => { n[kind].enabled = !n[kind].enabled; }),
                }))),

            h('div', { className: 'wgf-field' },
              h('div', { className: 'wgf-lab' },
                h('b', null, 'API Key'),
                h('span', null, keyLabel)),
              h('div', null,
                h('div', { className: 'wgf-ctl' },
                  h('input', {
                    className: 'wgf-inp mono',
                    type: 'password',
                    value: keys[kind],
                    placeholder: saved && saved[`${kind}KeySet`] ? '已保存，留空即不修改' : 'sk-...',
                    onChange: (e) => {
                      const v = e.target.value;
                      setKeys((k) => ({ ...k, [kind]: v }));
                      setTouched(true);
                      setNote('');
                    },
                  }),
                  keys[kind]
                    ? h('button', {
                        type: 'button',
                        className: 'wgf-btn',
                        onClick: () => {
                          setKeys((k) => ({ ...k, [kind]: '' }));
                          setTouched(true);
                        },
                      }, '清空')
                    : null),
                h('div', { className: `wgf-hint ${hint.cls}` }, h('i'), hint.text))),

            h('div', { className: 'wgf-field' },
              h('div', { className: 'wgf-lab' },
                h('b', null, '默认模型'),
                h('span', null, modelHint)),
              h('div', { className: 'wgf-ctl' },
                h('div', { className: 'wgf-sel' },
                  h('select', {
                    value: draftKind.defaultModel,
                    onChange: (e) => {
                      const v = e.target.value;
                      patch((n) => { n[kind].defaultModel = v; });
                    },
                  },
                    draftKind.defaultModel
                      ? null
                      : h('option', { value: '' }, models[kind].length ? '请选择模型' : '先拉取模型列表'),
                    models[kind].some((m) => m.id === draftKind.defaultModel)
                      ? null
                      : (draftKind.defaultModel
                          ? h('option', { value: draftKind.defaultModel }, `${draftKind.defaultModel}（不在当前列表）`)
                          : null),
                    models[kind].map((m) => h('option', { key: m.id, value: m.id }, m.id))),
                  h('span', { className: 'chev' }, '▾'),
                  tag ? h('span', { className: 'wgf-tag' }, tag) : null),
                h('button', {
                  type: 'button',
                  className: 'wgf-btn',
                  disabled: loading[kind],
                  onClick: () => loadModels(kind, keys[kind]),
                }, loading[kind] ? '拉取中…' : '刷新'))));
        };

        const spentUsd = ledger ? Number(ledger.spent) || 0 : 0;
        const limitUsd = ledger ? Number(ledger.limit) || 0 : 0;
        const over = limitUsd > 0 && spentUsd >= limitUsd;
        const ratio = limitUsd > 0 ? Math.min(1, spentUsd / limitUsd) : 0;

        const parseWords = (text) => Array.from(new Set(
          String(text || '')
            .split(/[\n,，、;；]+/)
            .map((w) => w.trim())
            .filter(Boolean),
        ));

        const modal = editing
          ? h('div', {
              className: 'wgf-mask',
              onClick: (e) => { if (e.target === e.currentTarget) setEditing(null); },
            },
              h('div', { className: 'wgf-modal' },
                h('div', { className: 'wgf-modal-h' },
                  h('b', null, 'wegoo-visual · 触发描述'),
                  h('p', null, '这是一段技能描述，模型按它的语义判断「什么任务该生成图/视频」。'
                    + '不需要出现固定的关键词——写清楚适用与不适用的场景即可。')),
                h('div', { className: 'wgf-modal-b' },
                  editing.loading
                    ? h('div', { style: { padding: '18px 0', color: '#98989d' } }, '读取技能描述…')
                    : h('textarea', {
                        className: 'wgf-ta',
                        style: { minHeight: '150px' },
                        value: editing.text,
                        placeholder: '用 wegoo 生成图像或视频。适用于：产品设计图、Logo、demo 配图…',
                        onChange: (e) => setEditing({ ...editing, text: e.target.value }),
                      }),
                  h('div', { style: { fontSize: 11, color: '#98989d', marginTop: 8, lineHeight: 1.55 } },
                    '保存后会写入 ~/.dsh/skills/wegoo-visual/SKILL.md 的 description 字段，'
                    + '技能目录是实时监听的，无需重启即可生效。')),
                h('div', { className: 'wgf-modal-f' },
                  h('button', { type: 'button', className: 'wgf-btn ghost', onClick: () => setEditing(null) }, '取消'),
                  h('button', {
                    type: 'button',
                    className: 'wgf-btn primary',
                    disabled: editing.loading,
                    onClick: async () => {
                      try {
                        await rpc('skill', { action: 'set', description: editing.text });
                        setEditing(null);
                        setNote('触发描述已保存');
                      } catch (e) {
                        setNote(`保存失败：${(e && e.message) || e}`);
                      }
                    },
                  }, '保存描述'))))
          : null;

        return h('div', { id: 'wegoo-form' },
          h('div', { className: 'wgf-card' },
            section('image', '图像生成', '固定价按张计费，报价即结算', 'img',
              'Image Lite / Image Plus 分组', null, '影响 wegoo_image 的默认值'),
            section('video', '视频生成', '按 token 计费，事前按秒单价推算', 'vid',
              'Video Plus 分组', null, 'sd2.0-* 与 wan3-* 需要参考图'),

            h('section', { className: 'wgf-sec', key: 'limits' },
              h('div', { className: 'wgf-head' },
                h('div', null,
                  h('div', { className: 'wgf-title' },
                    h('span', { className: 'wgf-dot lim' }),
                    '预算限额'),
                  h('div', { className: 'wgf-sub' }, '超限直接拒绝，不会发出上游请求'))),

              h('div', { className: 'wgf-row3' },
                h('div', { className: `wgf-box${draft.limits.perCallUsd > 0 ? '' : ' err'}` },
                  h('b', null, '单次上限'),
                  h('div', { className: 'v' },
                    h('input', {
                      type: 'number', min: '0', step: '0.01', value: draft.limits.perCallUsd,
                      onChange: (e) => { const v = e.target.value; patch((n) => { n.limits.perCallUsd = v === '' ? 0 : Number(v); }); },
                    }),
                    h('span', { className: 'u' }, 'USD'))),
                h('div', { className: `wgf-box${draft.limits.totalUsd > 0 ? '' : ' err'}` },
                  h('b', null, '每日总额'),
                  h('div', { className: 'v' },
                    h('input', {
                      type: 'number', min: '0', step: '0.5', value: draft.limits.totalUsd,
                      onChange: (e) => { const v = e.target.value; patch((n) => { n.limits.totalUsd = v === '' ? 0 : Number(v); }); },
                    }),
                    h('span', { className: 'u' }, 'USD'))),
                h('div', { className: `wgf-box${draft.limits.perMinute > 0 ? '' : ' err'}` },
                  h('b', null, '每分钟次数'),
                  h('div', { className: 'v' },
                    h('input', {
                      type: 'number', min: '1', step: '1', value: draft.limits.perMinute,
                      onChange: (e) => { const v = e.target.value; patch((n) => { n.limits.perMinute = v === '' ? 0 : Number(v); }); },
                    }),
                    h('span', { className: 'u' }, '次')))),

              ledger
                ? h('div', { className: 'wgf-meter' },
                    h('div', { className: 'top' },
                      h('span', null, '今日已用 ', h('b', null, `$${spentUsd.toFixed(4)}`), ` / $${limitUsd.toFixed(4)}`),
                      h('span', null, `剩余 $${Math.max(0, limitUsd - spentUsd).toFixed(4)}`)),
                    h('div', { className: 'wgf-bar' },
                      h('i', { className: over ? 'bad' : '', style: { width: `${(ratio * 100).toFixed(1)}%` } })))
                : null),

            h('div', { className: 'wgf-foot' },
              h('div', {
                className: `wgf-dirty${limitsBad && touched ? ' bad' : dirty ? '' : ' saved'}`,
              },
                h('i'),
                limitsBad && touched
                  ? '限额必须大于 0'
                  : note || (dirty ? '有未保存的更改' : '已保存')),
              h('div', { className: 'wgf-acts' },
                h('button', { type: 'button', className: 'wgf-btn ghost', onClick: reset, disabled: busy || !dirty }, '重置'),
                h('button', { type: 'button', className: 'wgf-btn primary', onClick: save, disabled: busy || !dirty }, busy ? '保存中…' : '保存')))),
          modal);
      }
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

      const EASE = 'cubic-bezier(.22,1,.36,1)';

      /** 账本指纹：忽略 now 之类每次都会变的字段，只比较真正影响显示的内容。 */
      function ledgerKey(l) {
        if (!l) return 'none';
        const rows = (l.entries || []).map((e) => `${e.id}:${e.settledUsd}`).join(',');
        return `${l.spent}|${l.limit}|${l.remaining}|${l.scope}|${rows}`;
      }

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
      /** 门卫：不是本插件的详情页就不渲染（本身不含 hooks，安全）。 */
      /** 表单样式只在自己的详情页注入一次。 */
      function ensureFormStyle() {
        if (typeof document === 'undefined' || !document.head) return;
        if (document.getElementById('wegoo-form-style')) return;
        const style = document.createElement('style');
        style.id = 'wegoo-form-style';
        style.textContent = FORM_CSS;
        document.head.appendChild(style);
      }

      function WegooConfigGate(props) {
        if (pluginPackageName(props && props.subject) !== PACKAGE_NAME) return null;
        ensureFormStyle();
        return h(WegooConfigPanel, props);
      }

      function apply(ctx) {
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
        }, WegooConfigGate));
      }

      return { apply, inject: ['slots'] };
    },
  });
})();
