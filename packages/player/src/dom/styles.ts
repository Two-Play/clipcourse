// SPDX-License-Identifier: MIT
/** Player CSS, injected once per document. All classes use the ccp- prefix. */
export const PLAYER_CSS = `
.ccp-root{--ccp-accent:#4f8cff;--ccp-bar:#14161a;--ccp-fg:#f3f4f6;--ccp-muted:#a1a7b3;
  position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:200px;
  background:#000;color:var(--ccp-fg);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  overflow:hidden;box-sizing:border-box}
.ccp-root:focus{outline:none}
.ccp-root *,.ccp-root *::before,.ccp-root *::after{box-sizing:border-box}
.ccp-viewport{position:relative;flex:1 1 auto;min-height:0;overflow:hidden}
.ccp-stage{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.25;color:#fff;text-align:left}
.ccp-layer{position:absolute;inset:0}
.ccp-clip{position:absolute;display:flex;flex-direction:column;overflow:hidden}
.ccp-clip img,.ccp-clip video{display:block;width:100%;height:100%}
.ccp-clip-shape{overflow:visible}
.ccp-text{margin:0;padding:0;text-transform:none;letter-spacing:normal;text-indent:0;font-family:inherit;line-height:1.25;border:0;background:none;white-space:pre-wrap;overflow-wrap:break-word;font-weight:inherit;color:#fff}
.ccp-clip-box .ccp-text{color:inherit}
.ccp-audio{display:none}
.ccp-clip-highlight,.ccp-clip-progress{pointer-events:none}
.ccp-clip-highlight{overflow:visible}
.ccp-hl-fill{position:absolute;inset:0;opacity:.4}
.ccp-progress-fill{height:100%;width:0;border-radius:inherit}
.ccp-stage .ccp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ccp-captions{position:absolute;left:50%;bottom:5%;transform:translateX(-50%);z-index:100000;
  max-width:80%;width:max-content;padding:.15em .5em;border-radius:6px;background:rgba(0,0,0,.78);
  color:#fff;font-size:44px;line-height:1.3;text-align:center;white-space:pre-line;pointer-events:none}
.ccp-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.35);z-index:2}
.ccp-overlay[hidden],.ccp-root [hidden]{display:none!important}
.ccp-big{display:inline-flex;align-items:center;gap:.5em;padding:.8em 1.6em;font:inherit;font-size:18px;
  font-weight:600;color:#fff;background:var(--ccp-accent);border:0;border-radius:999px;cursor:pointer;
  box-shadow:0 4px 18px rgba(0,0,0,.4)}
.ccp-big:hover{filter:brightness(1.1)}
.ccp-big svg{width:24px;height:24px;fill:currentColor;flex:none}
.ccp-continue{position:absolute;right:24px;bottom:24px;z-index:2}
.ccp-spinner{position:absolute;top:16px;right:16px;width:28px;height:28px;border-radius:50%;
  border:3px solid rgba(255,255,255,.3);border-top-color:#fff;animation:ccp-spin 1s linear infinite;z-index:2}
@keyframes ccp-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ccp-spinner{animation-duration:3s}}
.ccp-controls{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--ccp-bar);
  flex-wrap:wrap}
.ccp-btn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;
  color:var(--ccp-fg);background:transparent;border:0;border-radius:6px;cursor:pointer}
.ccp-btn:hover:not(:disabled){background:rgba(255,255,255,.1)}
.ccp-btn:disabled{opacity:.35;cursor:default}
.ccp-btn[aria-pressed="true"]{color:var(--ccp-accent)}
.ccp-btn svg{width:22px;height:22px;fill:currentColor}
.ccp-root button:focus-visible,.ccp-root input:focus-visible{outline:3px solid var(--ccp-accent);outline-offset:2px}
.ccp-time{font-variant-numeric:tabular-nums;color:var(--ccp-muted);min-width:7.5em;text-align:center}
.ccp-seek{flex:1 1 160px;min-width:100px;accent-color:var(--ccp-accent);height:24px;cursor:pointer}
.ccp-title{flex:1 1 100%;order:-1;color:var(--ccp-muted);font-size:13px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;padding:0 4px}
.ccp-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:0}
.ccp-error{position:absolute;left:16px;top:16px;z-index:3;padding:.4em .8em;border-radius:6px;
  background:#b3261e;color:#fff}
.ccp-seekwrap{position:relative;flex:1 1 160px;min-width:100px;display:flex;align-items:center}
.ccp-seekwrap .ccp-seek{flex:1;width:100%}
.ccp-ticks{position:absolute;left:8px;right:8px;top:50%;height:0;pointer-events:none}
.ccp-tick{position:absolute;top:-8px;width:2px;height:16px;margin-left:-1px;background:#ffd166;border-radius:1px}
.ccp-toc{position:absolute;top:0;bottom:0;left:0;z-index:4;width:min(360px,85%);overflow:auto;padding:12px;
  background:rgba(20,22,26,.97);box-shadow:4px 0 24px rgba(0,0,0,.5)}
.ccp-toc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.ccp-toc-head h2{margin:0;font-size:16px}
.ccp-toc ol{list-style:none;margin:0;padding:0}
.ccp-toc li{margin:2px 0}
.ccp-toc button.ccp-toc-item{display:flex;width:100%;gap:8px;align-items:baseline;text-align:left;padding:8px 10px;
  border:0;border-radius:6px;background:transparent;color:var(--ccp-fg);font:inherit;cursor:pointer}
.ccp-toc button.ccp-toc-item:hover{background:rgba(255,255,255,.08)}
.ccp-toc button[aria-current="true"]{background:rgba(79,140,255,.2)}
.ccp-toc-num{color:var(--ccp-muted);min-width:1.8em}
.ccp-toc-title{flex:1}
.ccp-toc-state{color:#06d6a0;font-size:12px}
.ccp-toc ol ol button.ccp-toc-item{padding:4px 10px 4px 38px;font-size:13px;color:var(--ccp-muted)}
@media (min-width:640px){.ccp-title{flex:0 1 auto;order:0;max-width:40%}}
`;

const STYLE_ID = 'clipcourse-player-styles';

export function injectStyles(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PLAYER_CSS;
  doc.head.append(style);
}

const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;

export const ICONS = {
  play: icon('M8 5v14l11-7z'),
  pause: icon('M6 5h4v14H6zm8 0h4v14h-4z'),
  previous: icon('M6 6h2v12H6zm3.5 6 8.5 6V6z'),
  next: icon('M16 6h2v12h-2zM6 18l8.5-6L6 6z'),
  captions: icon(
    'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1z',
  ),
  contents: icon('M4 6h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8z'),
  close: icon(
    'M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z',
  ),
  replay: icon('M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z'),
};
