// Server-rendered pages (login, board overview, messages). No external resources, no external fonts.
import { Lang, MessageKey } from "../../../common/src/i18n"
import { translator } from "./language"

export const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

const css = `
:root{--bg:var(--c-paper);--card:var(--c-white);--ink:var(--c-ink);--muted:var(--c-muted);--line:var(--c-line);--accent:var(--c-green-deep);--accent-ink:#fff;--accent-soft:var(--c-green-tint);--radius:var(--radius-card);--shadow:none}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{font:15px/1.55 var(--font-sans);margin:0;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
h1,h2{font-weight:600;letter-spacing:-.025em}
a{color:inherit;text-decoration:none}
button,input,select{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--c-green);outline-offset:2px}
.btn{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 18px;border:1px solid var(--line);border-radius:var(--radius-btn);background:var(--card);cursor:pointer;font-weight:500;white-space:nowrap;transition:background .16s,border-color .16s,color .16s}
.btn:hover{border-color:var(--ink)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn.primary:hover{background:var(--ink);border-color:var(--ink)}
.btn.ghost{border-color:transparent;background:transparent;color:var(--muted)}
.btn.ghost:hover{border-color:transparent;background:#eceef2;color:var(--ink)}
.field{height:40px;width:100%;padding:0 12px;border:1px solid var(--line);border-radius:var(--radius-btn);background:var(--card)}
.field:focus{outline:none;border-color:var(--c-green)}
.topbar{display:flex;align-items:center;justify-content:space-between;height:72px;padding:0 clamp(16px,4vw,40px);background:var(--card);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:14px}
.brand b{font:700 20px/1.2 var(--font-sans);letter-spacing:-.01em;color:var(--text)}
.page{max-width:1320px;margin:0 auto;padding:32px clamp(16px,4vw,40px) 64px}
.head{display:flex;flex-wrap:wrap;align-items:center;gap:16px 24px;margin-bottom:24px}
.head h1{font-size:30px;line-height:1.15;margin:0}
.head .spacer{flex:1}
.tools{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:24px}
.search{position:relative;flex:1 1 260px;max-width:420px}
.search svg{position:absolute;left:12px;top:11px;width:18px;height:18px;color:var(--muted);pointer-events:none}
.search .field{padding-left:38px}
.seg{display:inline-flex;padding:3px;background:#eceef2;border-radius:var(--radius-btn)}
.seg button{height:34px;padding:0 14px;border:0;border-radius:3px;background:transparent;cursor:pointer;color:var(--muted);font-weight:500}
.seg button[aria-pressed=true]{background:var(--card);color:var(--ink);box-shadow:var(--shadow)}
.sort{width:auto;min-width:190px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:22px}
.tile{position:relative;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);transition:border-color .16s}
.tile:hover{border-color:var(--ink)}
.tile[hidden]{display:none}
.tile .open{position:absolute;inset:0;border-radius:var(--radius);z-index:1}
.thumb{position:relative;aspect-ratio:4/3;overflow:hidden;border-radius:var(--radius) var(--radius) 0 0;border-bottom:1px solid var(--line);background-color:var(--c-paper);background-image:radial-gradient(#d5d9e0 1px,transparent 1.2px);background-size:16px 16px}
.thumb svg.vorschau{position:absolute;inset:0;width:100%;height:100%;padding:10px}
.thumb .leer-hinweis{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:14px}
.badge{position:absolute;left:10px;top:10px;z-index:2;padding:3px 10px;border-radius:var(--radius-btn);background:var(--accent);color:#fff;font-size:12.5px;font-weight:500}
.tile.archiviert .thumb{opacity:.6}
.info{display:flex;align-items:flex-start;gap:8px;padding:12px 8px 14px 16px;min-height:72px}
.info .txt{flex:1;min-width:0}
.name{font-weight:600;letter-spacing:-.01em;font-size:15.5px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{color:var(--muted);font-size:13.5px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.more{position:relative;z-index:3}
.more>button{width:36px;height:36px;border:0;border-radius:var(--radius-btn);background:transparent;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;letter-spacing:1px}
.more>button:hover,.more>button[aria-expanded=true]{background:var(--c-green-tint);color:var(--ink)}
.menu{position:absolute;right:0;bottom:40px;min-width:220px;padding:6px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius-card);box-shadow:var(--shadow-pop);z-index:20}
.menu[hidden]{display:none}
.menu button{display:block;width:100%;text-align:left;padding:9px 12px;border:0;border-radius:var(--radius-btn);background:transparent;cursor:pointer}
.menu button:hover{background:var(--c-green-tint)}
.menu button[disabled]{color:#a4abb8;cursor:default;background:transparent}
.menu hr{border:0;border-top:1px solid var(--line);margin:6px 4px}
.leer{grid-column:1/-1;text-align:center;padding:72px 16px;color:var(--muted)}
.leer strong{display:block;color:var(--ink);font-size:18px;margin-bottom:6px}
.leer[hidden]{display:none}
dialog{border:1px solid var(--line);border-radius:var(--radius-card);padding:0;width:min(440px,calc(100vw - 32px));box-shadow:var(--shadow-pop);color:var(--ink)}
dialog::backdrop{background:rgba(20,24,31,.45)}
dialog form{padding:24px}
dialog h2{margin:0 0 16px;font-size:19px}
dialog .actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
.toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);padding:11px 18px;background:var(--ink);color:#fff;border-radius:var(--radius-btn);opacity:0;pointer-events:none;transition:.2s;z-index:50;max-width:calc(100vw - 32px)}
.toast.show{opacity:1;transform:translate(-50%,0)}
.login{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.login .box{width:min(400px,100%);background:var(--card);border:1px solid var(--line);border-radius:var(--radius-card);padding:40px 36px 36px}
.login h1{font-size:26px;margin:28px 0 4px}
.login p{color:var(--muted);margin:0 0 20px}
.login label{display:block;font-weight:500;margin-bottom:6px}
.login .btn{width:100%;justify-content:center;margin-top:16px}
.err{color:var(--c-danger);margin:14px 0 0}
.msg{max-width:520px;margin:12vh auto;padding:0 20px}
.msg .box{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-card);padding:36px 32px}
.msg h1{font-size:24px;margin:24px 0 8px}
.msg p{color:var(--muted);margin:0}
@media (max-width:640px){
.page{padding-top:20px}
.head h1{font-size:24px}
.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.info{padding:10px 4px 10px 12px;min-height:66px}
.name{font-size:14.5px;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.badge{font-size:11px;padding:2px 8px;white-space:nowrap;left:6px;top:6px}.meta{font-size:12.5px;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.thumb svg.vorschau{padding:6px}
.sort{flex:1}
.search{max-width:none}
.menu{right:-4px}
.btn.hide-sm span{display:none}
}
@media (max-width:380px){.grid{grid-template-columns:1fr}}
`

const layout = (lang: Lang, title: string, body: string, script = "") =>
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow"><link rel="icon" type="image/svg+xml" href="/brand/favicon.svg"><link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png"><link rel="apple-touch-icon" href="/brand/apple-touch-icon.png"><link rel="stylesheet" href="/brand/tokens.css"><title>${esc(title)}</title><style>${css}</style></head><body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`

const logo = `<span class="brand"><b>Post-it Chaos</b></span>`

/** `error` is an i18n key (so the message follows the page language). */
export const loginPage = (lang: Lang, error?: MessageKey, next?: string) => {
    const t = translator(lang)
    return layout(
        lang,
        `${t("login.title")} – ${t("app.name")}`,
        `<div class="login"><form class="box" method="post" action="/login">
${logo}
<h1>${esc(t("login.title"))}</h1><p>${esc(t("login.subtitle"))}</p>
<label for="pw">${esc(t("login.password"))}</label>
<input class="field" id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<input type="hidden" name="next" value="${esc(next ?? "")}">
<button class="btn primary" type="submit">${esc(t("login.submit"))}</button>
${error ? `<p class="err" role="alert">${esc(t(error))}</p>` : ""}
</form></div>`,
    )
}

/** `title` and `text` are i18n keys. */
export const messagePage = (lang: Lang, title: MessageKey, text: MessageKey) => {
    const t = translator(lang)
    return layout(
        lang,
        `${t(title)} – ${t("app.name")}`,
        `<div class="msg"><div class="box">${logo}<h1>${esc(t(title))}</h1><p>${esc(t(text))}</p></div></div>`,
    )
}

export type BoardTile = {
    id: string
    name: string
    shareUrl: string | null
    modifiedAt: number // ms
    modifiedLabel: string // "3 hours ago"
    archived: boolean
    neu: number
    svg: string | null // ready-made server-rendered SVG (no user text in it); null = loaded on demand
    leer: boolean
}

const tileHtml = (lang: Lang, b: BoardTile) => {
    const t = translator(lang)
    const untitled = t("common.untitled")
    const neuLabel = (n: number) => (n === 1 ? t("overview.newGuestComment") : t("overview.newGuestComments", { n }))
    const id = esc(encodeURIComponent(b.id))
    return `<article class="tile${b.archived ? " archiviert" : ""}" data-id="${esc(b.id)}" data-name="${esc(b.name.toLowerCase())}" data-title="${esc(b.name || untitled)}" data-ts="${b.modifiedAt}" data-archived="${b.archived ? 1 : 0}"${b.svg === null ? " data-lazy=\"1\"" : ""}${b.shareUrl ? ` data-link="${esc(b.shareUrl)}"` : ""}>
<a class="open" href="/b/${id}" aria-label="${esc(t("overview.openBoard", { name: b.name || untitled }))}"></a>
<div class="thumb">${b.svg ?? ""}${b.leer ? `<div class="leer-hinweis">${esc(t("overview.stillEmpty"))}</div>` : ""}${b.neu > 0 ? `<span class="badge">${esc(neuLabel(b.neu))}</span>` : ""}</div>
<div class="info"><div class="txt"><div class="name" title="${esc(b.name)}">${esc(b.name || untitled)}</div><div class="meta">${esc(t("overview.lastEdited", { when: b.modifiedLabel }))}</div></div>
<div class="more"><button type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t("overview.menuFor", { name: b.name || untitled }))}">&#8943;</button>
<div class="menu" role="menu" hidden>
<button type="button" role="menuitem" data-act="copy"${b.shareUrl ? "" : " disabled"}>${esc(t("overview.copyGuestLink"))}</button>
<button type="button" role="menuitem" data-act="rotate">${esc(t("overview.renewGuestLink"))}</button>
<button type="button" role="menuitem" data-act="revoke"${b.shareUrl ? "" : " disabled"}>${esc(t("overview.revokeGuestLink"))}</button>
<hr>
<button type="button" role="menuitem" data-act="rename">${esc(t("overview.rename"))}</button>
<button type="button" role="menuitem" data-act="${b.archived ? "restore" : "archive"}">${esc(b.archived ? t("overview.restore") : t("overview.archiveAction"))}</button>
</div></div></div>
</article>`
}

/** Strings the inline script needs, as JSON (`<` escaped so the data can never close the script tag). */
const scriptStrings = (lang: Lang) => {
    const t = translator(lang)
    return JSON.stringify({
        lang,
        untitled: t("common.untitled"),
        stillEmpty: t("overview.stillEmpty"),
        newOne: t("overview.newGuestComment"),
        newMany: t("overview.newGuestComments", { n: "{n}" }),
        noMatches: t("overview.noMatches"),
        noMatchesText: t("overview.noMatchesText", { term: "{term}" }),
        archiveEmpty: t("overview.archiveEmpty"),
        archiveEmptyText: t("overview.archiveEmptyText"),
        noBoards: t("overview.noBoards"),
        noBoardsText: t("overview.noBoardsText"),
        confirmRenew: t("overview.confirmRenew"),
        confirmRevoke: t("overview.confirmRevoke"),
        linkCopied: t("overview.linkCopied"),
        linkRenewed: t("overview.linkRenewed"),
        linkRevoked: t("overview.linkRevoked"),
        archived: t("overview.archived"),
        restored: t("overview.restored"),
        renamed: t("overview.renamed"),
        failed: t("overview.failed"),
    }).replace(/</g, "\\u003c")
}

const script = (lang: Lang) => `
(function(){
var T=${scriptStrings(lang)};
var grid=document.getElementById('grid'),tiles=[].slice.call(grid.querySelectorAll('.tile'));
var q=document.getElementById('q'),sort=document.getElementById('sort'),leer=document.getElementById('leer'),view='aktiv';
var toast=document.getElementById('toast'),tt;
function say(t){toast.textContent=t;toast.classList.add('show');clearTimeout(tt);tt=setTimeout(function(){toast.classList.remove('show')},2600)}
var flash=sessionStorage.getItem('flash');if(flash){sessionStorage.removeItem('flash');say(flash)}
function apply(){
 var s=sort.value,term=q.value.trim().toLowerCase(),n=0;
 tiles.sort(function(a,b){return s==='name'?a.dataset.title.localeCompare(b.dataset.title,T.lang):(+b.dataset.ts)-(+a.dataset.ts)});
 tiles.forEach(function(t){grid.insertBefore(t,leer);
  var ok=(t.dataset.archived==='1')===(view==='archiv')&&(!term||t.dataset.name.indexOf(term)>=0);
  t.hidden=!ok;if(ok)n++});
 leer.hidden=n>0;lazy();
 var h=leer.querySelector('strong'),p=leer.querySelector('span');
 if(term){h.textContent=T.noMatches;p.textContent=T.noMatchesText.replace('{term}',function(){return q.value.trim()})}
 else if(view==='archiv'){h.textContent=T.archiveEmpty;p.textContent=T.archiveEmptyText}
 else{h.textContent=T.noBoards;p.textContent=T.noBoardsText}
}
var lazyBusy=false;
function lazy(){
 // Previews of archived boards: one single request for all of them (instead of one per board)
 if(lazyBusy||!tiles.some(function(t){return t.dataset.lazy==='1'&&!t.hidden}))return;
 lazyBusy=true;
 fetch('/admin/uebersicht?archiv=1',{headers:{'Accept':'application/json'}}).then(function(r){return r.json()}).then(function(d){
  d.boards.forEach(function(b){
   var t=tiles.filter(function(x){return x.dataset.id===b.id})[0];
   if(!t||t.dataset.lazy!=='1'||b.svg==null)return;
   t.dataset.lazy='0';
   var th=t.querySelector('.thumb');th.insertAdjacentHTML('afterbegin',b.svg);if(b.leer){var d=document.createElement('div');d.className='leer-hinweis';d.textContent=T.stillEmpty;th.appendChild(d)}
   if(b.neu>0){var sp=document.createElement('span');sp.className='badge';sp.textContent=b.neu===1?T.newOne:T.newMany.replace('{n}',b.neu);th.appendChild(sp)}
  })
 }).catch(function(){}).then(function(){lazyBusy=false})}
q.addEventListener('input',apply);sort.addEventListener('change',apply);
[].forEach.call(document.querySelectorAll('[data-view]'),function(b){b.addEventListener('click',function(){
 view=b.dataset.view;[].forEach.call(document.querySelectorAll('[data-view]'),function(x){x.setAttribute('aria-pressed',x===b)});apply()})});
function closeMenus(){[].forEach.call(document.querySelectorAll('.menu'),function(m){m.hidden=true;m.previousElementSibling.setAttribute('aria-expanded','false')})}
document.addEventListener('click',function(e){
 var tb=e.target.closest('.more>button');
 if(tb){var m=tb.nextElementSibling,was=!m.hidden;closeMenus();if(!was){m.hidden=false;tb.setAttribute('aria-expanded','true')}return}
 var it=e.target.closest('.menu button');
 if(it&&!it.disabled){closeMenus();act(it.dataset.act,it.closest('.tile'));return}
 if(!e.target.closest('.menu'))closeMenus()});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeMenus()});
function post(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:new URLSearchParams(data||{})}).then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})}
function done(msg){sessionStorage.setItem('flash',msg);location.reload()}
function fail(){say(T.failed)}
function copy(text){
 if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(text);
 var a=document.createElement('textarea');a.value=text;document.body.appendChild(a);a.select();var ok=document.execCommand('copy');a.remove();return ok?Promise.resolve():Promise.reject()}
var rn=document.getElementById('rename'),rnForm=rn.querySelector('form'),rnField=rn.querySelector('input[name=name]'),rnTile=null;
function act(a,t){
 var id=t.dataset.id;
 if(a==='copy'){copy(t.dataset.link).then(function(){say(T.linkCopied)},function(){say(t.dataset.link)})}
 else if(a==='rotate'){if(confirm(T.confirmRenew))post('/admin/boards/'+encodeURIComponent(id)+'/share',{op:'rotate'}).then(function(r){copy(r.shareUrl).catch(function(){}).then(function(){done(T.linkRenewed)})},fail)}
 else if(a==='revoke'){if(confirm(T.confirmRevoke))post('/admin/boards/'+encodeURIComponent(id)+'/share',{op:'revoke'}).then(function(){done(T.linkRevoked)},fail)}
 else if(a==='rename'){rnTile=t;rnField.value=t.dataset.title===T.untitled?'':t.dataset.title;rn.showModal();rnField.select()}
 else if(a==='archive'){post('/admin/boards/'+encodeURIComponent(id)+'/archive',{archived:'1'}).then(function(){done(T.archived)},fail)}
 else if(a==='restore'){post('/admin/boards/'+encodeURIComponent(id)+'/archive',{archived:'0'}).then(function(){done(T.restored)},fail)}
}
rnForm.addEventListener('submit',function(e){e.preventDefault();var n=rnField.value.trim();if(!n||!rnTile)return;
 post('/admin/boards/'+encodeURIComponent(rnTile.dataset.id)+'/rename',{name:n}).then(function(){rn.close();done(T.renamed)},fail)});
var nw=document.getElementById('neu');
document.getElementById('neues').addEventListener('click',function(){nw.showModal();nw.querySelector('input[name=name]').focus()});
[].forEach.call(document.querySelectorAll('dialog [data-close]'),function(b){b.addEventListener('click',function(){b.closest('dialog').close()})});
apply();
})();
`

export const adminPage = (lang: Lang, boards: BoardTile[]) => {
    const t = translator(lang)
    const aktiv = boards.filter((b) => !b.archived).length
    const archiv = boards.length - aktiv
    return layout(
        lang,
        `${t("overview.title")} – ${t("app.name")}`,
        `<header class="topbar">${logo}<form method="post" action="/logout"><button class="btn ghost" type="submit">${esc(t("overview.signOut"))}</button></form></header>
<main class="page">
<div class="head"><h1>${esc(t("overview.title"))}</h1><span class="spacer"></span><button id="neues" class="btn primary" type="button">${esc(t("overview.newBoard"))}</button></div>
<div class="tools">
<div class="search"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4"/></svg><input id="q" class="field" type="search" placeholder="${esc(t("overview.search"))}" aria-label="${esc(t("overview.search"))}" autocomplete="off"></div>
<div class="seg" role="group" aria-label="${esc(t("overview.view"))}"><button type="button" data-view="aktiv" aria-pressed="true">${esc(t("overview.active", { n: aktiv }))}</button><button type="button" data-view="archiv" aria-pressed="false">${esc(t("overview.archive", { n: archiv }))}</button></div>
<select id="sort" class="field sort" aria-label="${esc(t("overview.sort"))}"><option value="zeit">${esc(t("overview.sortRecent"))}</option><option value="name">${esc(t("overview.sortName"))}</option></select>
</div>
<div id="grid" class="grid">
${boards.map((b) => tileHtml(lang, b)).join("\n")}
<div id="leer" class="leer" hidden><strong></strong><span></span></div>
</div>
</main>
<dialog id="neu"><form method="post" action="/admin/boards"><h2>${esc(t("overview.newBoardDialog"))}</h2>
<label for="nn" style="display:block;font-weight:500;margin-bottom:6px">${esc(t("common.name"))}</label>
<input id="nn" class="field" name="name" type="text" maxlength="200" placeholder="${esc(t("overview.namePlaceholder"))}" required autocomplete="off">
<div class="actions"><button class="btn" type="button" data-close>${esc(t("common.cancel"))}</button><button class="btn primary" type="submit">${esc(t("overview.createBoard"))}</button></div></form></dialog>
<dialog id="rename"><form method="dialog"><h2>${esc(t("overview.renameDialog"))}</h2>
<label for="rn" style="display:block;font-weight:500;margin-bottom:6px">${esc(t("common.name"))}</label>
<input id="rn" class="field" name="name" type="text" maxlength="200" required autocomplete="off">
<div class="actions"><button class="btn" type="button" data-close>${esc(t("common.cancel"))}</button><button class="btn primary" type="submit">${esc(t("common.save"))}</button></div></form></dialog>
<div id="toast" class="toast" role="status" aria-live="polite"></div>`,
        script(lang),
    )
}
