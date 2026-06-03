(function(){const s=document.createElement("link").relList;if(s&&s.supports&&s.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))r(i);new MutationObserver(i=>{for(const t of i)if(t.type==="childList")for(const o of t.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&r(o)}).observe(document,{childList:!0,subtree:!0});function a(i){const t={};return i.integrity&&(t.integrity=i.integrity),i.referrerPolicy&&(t.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?t.credentials="include":i.crossOrigin==="anonymous"?t.credentials="omit":t.credentials="same-origin",t}function r(i){if(i.ep)return;i.ep=!0;const t=a(i);fetch(i.href,t)}})();async function S(){const e=await fetch("/api/state");if(!e.ok)throw new Error(`/api/state ${e.status}`);return e.json()}async function H(e){const s=await fetch("/api/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({decisions:e})});if(!s.ok)throw new Error(`/api/preview ${s.status}`);return s.json()}function n(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}class k{constructor(s){this.value=s}listeners=new Set;get(){return this.value}set(s){typeof s=="function"?this.value=s(this.value):this.value={...this.value,...s};for(const a of this.listeners)a()}subscribe(s){return this.listeners.add(s),()=>this.listeners.delete(s)}}const L=["schema","semantic","hierarchy","context","provenance"],d=new k({loading:!0,pair:null,sourceIssues:[],baseline:[],decisionCatalog:null,decisions:null,enhanced:[],currentKey:"SCRUM-5",previewing:!1,showCommit:!1});C();async function C(){try{const e=await S();d.set({loading:!1,pair:e.pair,sourceIssues:e.sourceIssues,baseline:e.baseline,decisionCatalog:e.decisionCatalog,decisions:e.defaultDecisions}),await b()}catch(e){console.error(e),document.getElementById("app").innerHTML=`<div class="loading">Failed to load state. Is the worker running? <pre>${n(e.message)}</pre></div>`}}async function b(){const e=d.get().decisions;if(e){d.set({previewing:!0});try{const s=await H(e);d.set({enhanced:s.enhanced,previewing:!1})}catch(s){console.error(s),d.set({previewing:!1})}}}d.subscribe($);$();function $(){const e=d.get(),s=document.getElementById("app");if(e.loading){s.innerHTML='<div class="loading">Loading…</div>';return}s.innerHTML=`
    <main>
      ${j(e.pair)}
      ${K(e)}
      ${E(e)}
      ${D(e)}
      ${N()}
      ${V()}
    </main>
    ${e.showCommit?O(e):""}
  `,M()}function j(e){return`
    <header class="hero">
      <div class="hero-row">
        <h1>Translation Engine — prototype</h1>
        <span class="tag">Demo mode · synthetic data · no real writes</span>
      </div>
      <div class="pair-strip">
        <span class="pair-side">
          <span class="pair-label">Source</span>
          <strong>${n(e.source.label)}</strong>
          <span class="muted">· ${n(e.source.projectName)} (<code>${n(e.source.projectKey)}</code>)</span>
        </span>
        <span class="pair-arrow">→</span>
        <span class="pair-side">
          <span class="pair-label">Destination</span>
          <strong>${n(e.destination.label)}</strong>
          <span class="muted">· ${n(e.destination.baseName)} / ${n(e.destination.tableName)}</span>
        </span>
        <span class="pair-grammar">
          <span class="pair-label">Grammar</span>
          <strong>${n(e.grammar.label)}</strong>
        </span>
      </div>
    </header>
  `}function K(e){const s={schema:0,semantic:0,hierarchy:0,context:0,provenance:0};for(const i of e.baseline)for(const t of i.losses)s[t.kind]++;const a=Object.values(s).reduce((i,t)=>i+t,0),r=L.map(i=>`<span class="chip chip-${i}"><span class="chip-n">${s[i]}</span><span class="chip-k">${i}</span></span>`).join("");return`
    <section class="summary-strip">
      <span class="summary-lead">
        <strong>${e.baseline.length}</strong> source issue(s) ·
        <strong>${a}</strong> loss(es) surfaced
      </span>
      <span class="summary-chips">${r}</span>
    </section>
  `}function E(e){return`
    <section class="issue-tabs-wrap">
      <div class="issue-tabs">${e.sourceIssues.map(a=>{const i=e.baseline.find(l=>l.jiraKey===a.key)?.losses.length??0,t=a.fields?.summary??"";return`
      <button class="issue-tab ${a.key===e.currentKey?"active":""}" data-key="${n(a.key)}">
        <span class="issue-key">${n(a.key)}</span>
        <span class="issue-summary">${n(t)}</span>
        <span class="issue-loss-badge">${i}</span>
      </button>
    `}).join("")}</div>
    </section>
  `}function D(e){const s=e.sourceIssues.find(o=>o.key===e.currentKey),a=e.enhanced.find(o=>o.jiraKey===e.currentKey),r=e.baseline.find(o=>o.jiraKey===e.currentKey);if(!s||!a||!r)return`<section class="loading">No data for ${n(e.currentKey)}.</section>`;const t=P(s,a,r,e.decisions,e.decisionCatalog).filter(o=>!o.hidden).map(o=>A(o)).join("");return`
    <section class="split-section">
      <div class="split-headers">
        <div class="split-h split-h-source">
          <span class="split-h-eyebrow">Source</span>
          <span class="split-h-title">Jira <code>${n(s.key)}</code></span>
        </div>
        <div class="split-h split-h-dest">
          <span class="split-h-eyebrow">Destination preview ${e.previewing?"· <em>recomputing…</em>":""}</span>
          <span class="split-h-title">Airtable Roadmap row</span>
        </div>
      </div>
      <div class="split-rows">
        ${t}
      </div>
    </section>
  `}function A(e){const s=e.losses.map(r=>`<span class="kind-tag kind-${r.kind}" title="${n(r.distance)}">${r.kind}</span>`).join(""),a=e.decisionKey?I(e.decisionKey):"";return`
    <div class="field-row">
      <div class="field-meta">
        <span class="field-name">${n(e.field)}</span>
        ${s?`<span class="field-tags">${s}</span>`:""}
      </div>
      <div class="field-bodies">
        <div class="field-source">${e.sourceHtml}</div>
        <div class="field-arrow">→</div>
        <div class="field-dest">${e.destHtml}</div>
      </div>
      ${a}
    </div>
  `}function I(e){const s=d.get(),a=s.decisionCatalog,r=s.decisions,i=a[e],t=r[e],o=i.options.map(m=>{const f=m.value===t;return`
      <label class="inline-option ${f?"selected":""}">
        <input type="radio" name="${n(e)}" value="${n(m.value)}" ${f?"checked":""} data-decision="${n(e)}">
        <span class="inline-option-lbl">${n(m.label)}</span>
      </label>
    `}).join(""),l=i.options.find(m=>m.value===t),p=l?n(l.description):"";return`
    <div class="inline-decision">
      <div class="inline-decision-head">
        <span class="inline-decision-title">Decision · ${n(i.title)}</span>
        <span class="inline-decision-body">${n(i.body)}</span>
      </div>
      <div class="inline-options">${o}</div>
      <div class="inline-decision-desc">${p}</div>
    </div>
  `}function P(e,s,a,r,i){const t=e.fields??{},o=s.airtableFields,l=new Map;for(const c of a.losses){const h=l.get(c.field)??[];h.push(c),l.set(c.field,h)}const p=[];p.push({field:"Name",losses:[],sourceHtml:u(t.summary),destHtml:u(o.Name)});const m=t.description!=null,f=[...l.get("description→Description")??[],...l.get("description embeds Slack thread URL")??[]];if(m){const c=w(t.description);p.push({field:"Description",losses:f,sourceHtml:`<div class="value-block">${n(c)}</div><div class="meta-line">(stored as ADF document)</div>`,destHtml:`<div class="value-block">${n(String(o.Description??""))}</div>`,decisionKey:f.some(h=>h.kind==="context")?"slackContextHandling":void 0})}if(t.status?.name&&p.push({field:"Status",losses:l.get("status→Status")??[],sourceHtml:u(t.status.name),destHtml:x(String(o.Status??""))}),t.priority?.name&&p.push({field:"Priority",losses:l.get("priority→Priority")??[],sourceHtml:u(t.priority.name),destHtml:F(String(o.Priority??""))}),t.parent?.key){const c=t.parent;p.push({field:"Epic",losses:l.get("parent→Epic")??[],sourceHtml:`<div class="value-block"><code>${n(c.key)}</code><div class="meta-line">${n(c.fields?.summary??"")}</div></div>`,destHtml:u(o.Epic),decisionKey:"epicDisplayMode"})}Array.isArray(t.labels)&&t.labels.length&&p.push({field:"Labels",losses:[],sourceHtml:t.labels.map(c=>`<code>${n(c)}</code>`).join(" "),destHtml:Array.isArray(o.Labels)?o.Labels.map(c=>`<code>${n(c)}</code>`).join(" "):'<em class="muted">(empty)</em>'});const y=t.customfield_10020;if(Array.isArray(y)&&y.length){const c=y[0];p.push({field:"Sprint",losses:l.get("sprint→Sprint")??[],sourceHtml:`<div class="value-block">${n(c?.name??"")}<div class="meta-line">(object: id, state, dates)</div></div>`,destHtml:u(o.Sprint)})}Array.isArray(t.fixVersions)&&t.fixVersions.length&&p.push({field:"Fix Version",losses:l.get("fixVersions→Fix Version")??[],sourceHtml:`<div class="value-block">${n(JSON.stringify(t.fixVersions.map(c=>c?.name).filter(Boolean)))}</div><div class="meta-line">(array of version objects)</div>`,destHtml:u(o["Fix Version"])});const v=t.customfield_10100?.value,g=a.losses.find(c=>/customer segment/i.test(c.field));if(v||g){const c=o["Customer Segment"]!==void 0;p.push({field:"Customer Segment",losses:g?[g]:[],sourceHtml:u(v),destHtml:c?u(o["Customer Segment"]):'<em class="muted">(dropped per decision)</em>',decisionKey:"customerSegmentDestination"})}return p.push({field:"Jira Key",losses:[],sourceHtml:`<code>${n(e.key)}</code>`,destHtml:`<code>${n(String(o["Jira Key"]??e.key))}</code>`}),p}function u(e){return e==null||e===""?'<em class="muted">(empty)</em>':n(String(e))}function x(e){return e?`<span class="pill ${e==="In Progress"?"pill-active":e==="Done"?"pill-done":"pill-todo"}">${n(e)}</span>`:'<em class="muted">(empty)</em>'}function F(e){return e?`<span class="pill ${{Highest:"pill-highest",High:"pill-high",Medium:"pill-medium",Low:"pill-low",Lowest:"pill-lowest"}[e]??"pill-lowest"}">${n(e)}</span>`:'<em class="muted">(empty)</em>'}function w(e){return e==null?"":typeof e=="string"?e:typeof e!="object"?"":e.type==="text"?e.text??"":Array.isArray(e.content)?e.content.map(w).join(""):""}function N(e){return`
    <section class="commit-row">
      <div class="commit-why">
        When you commit, the destination receives the previewed rows and a manifest of this pass is archived.
        Demo mode performs no real writes — confirmation only.
      </div>
      <button class="primary" id="commit-btn">Commit this pass</button>
    </section>
  `}function O(e){return`
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <h3>Pass committed (demo mode)</h3>
        <p>In production this would write ${e.enhanced.length} record(s) to the destination, archive the manifest, and (optionally) schedule the next pass. Decisions applied:</p>
        <pre class="modal-pre">${n(JSON.stringify(e.decisions,null,2))}</pre>
        <div class="modal-row">
          <button class="secondary" id="modal-close">Close</button>
        </div>
      </div>
    </div>
  `}function V(){return`
    <footer>
      Translation Engine prototype — built by Jason Armstrong.
      <a href="/demo/">Static doctrine demo</a> ·
      Source on <a href="https://github.com/designisagoodidea/translation-engine">GitHub</a>.
    </footer>
  `}function M(){for(const r of document.querySelectorAll(".issue-tab"))r.addEventListener("click",()=>{const i=r.dataset.key;d.set({currentKey:i})});for(const r of document.querySelectorAll("input[data-decision]"))r.addEventListener("change",async()=>{const i=r.dataset.decision,t=r.value,o=d.get().decisions;d.set({decisions:{...o,[i]:t}}),await b()});const e=document.getElementById("commit-btn");e&&e.addEventListener("click",()=>d.set({showCommit:!0}));const s=document.getElementById("modal-close");s&&s.addEventListener("click",()=>d.set({showCommit:!1}));const a=document.getElementById("modal-bg");a&&a.addEventListener("click",r=>{r.target===a&&d.set({showCommit:!1})})}
//# sourceMappingURL=index-yU0tEO6j.js.map
