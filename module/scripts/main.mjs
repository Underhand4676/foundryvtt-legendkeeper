import { journalHTML } from './export.mjs';
import { MACRO_DEFINITIONS } from './macros.mjs';
import { connectionKey, getPairedToken, normalizedBridgeUrl, updatePairings } from './credentials.mjs';

const MODULE_ID = 'foundryvtt-legendkeeper';
let sessionToken = ''; // In-memory copy of the per-project, GM browser-local credential.
const credentialStore = () => game.settings.get(MODULE_ID, 'pairedCredentials');
function currentPairingKey() {
  const base = game.settings.get(MODULE_ID, 'bridgeUrl');
  const alias = game.settings.get(MODULE_ID, 'projectAlias').trim();
  return connectionKey({ base, alias, worldId: game.world?.id });
}
function restoreCredential() {
  if (!game.user?.isGM) return '';
  try { sessionToken = getPairedToken(credentialStore(), currentPairingKey()); }
  catch { sessionToken = ''; }
  return sessionToken;
}
async function rememberCredential(token) {
  await game.settings.set(MODULE_ID, 'pairedCredentials', updatePairings(credentialStore(), currentPairingKey(), token));
  sessionToken = token;
}
async function forgetCredential() {
  try { await rememberCredential(''); }
  catch { sessionToken = ''; }
}
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function entryTree(resources) {
  const byParent = new Map();
  const ids = new Set(resources.map(r => r.id));
  for (const resource of resources) {
    const parent = ids.has(resource.parentId) ? resource.parentId : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(resource);
  }
  const result = [];
  const seen = new Set();
  function visit(parent, depth) {
    const siblings = byParent.get(parent) ?? [];
    siblings.sort((a, b) => (a.rank ?? a.name ?? '').toString().localeCompare((b.rank ?? b.name ?? '').toString()));
    for (const item of siblings) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      result.push({ id: item.id, name: item.name, hidden: Boolean(item.isHidden), padding: 8 + Math.min(depth, 12) * 14 });
      visit(item.id, depth + 1);
    }
  }
  visit(null, 0);
  for (const item of resources) if (!seen.has(item.id)) result.push({ id: item.id, name: item.name, hidden: Boolean(item.isHidden), padding: 8 });
  return result;
}

class LegendKeeperBrowser extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'foundryvtt-legendkeeper-browser',
    classes: ['legendkeeper-app'],
    window: { title: 'LegendKeeper', resizable: true },
    position: { width: 990, height: 690 }
  };
  static PARTS = { browser: { template: `modules/${MODULE_ID}/templates/browser.hbs` } };

  constructor(options = {}) {
    const { configure = false, ...appOptions } = options;
    super(appOptions);
    this.configuring = Boolean(configure);
    this.entries = [];
    this.resourceIndex = new Map();
    this.projectName = 'LegendKeeper';
    this.query = '';
    this.selectedId = '';
    this.selectedName = '';
    this.selectedResource = null;
    this.selectedDocument = null;
    this.documents = [];
    this.contentText = '';
    this.documentBlocks = null;
    this.unsupported = false;
    this.error = '';
    this.loaded = false;
    this.loading = false;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      projectName: this.projectName,
      connected: Boolean(sessionToken),
      showConnectionForm: this.configuring || !sessionToken,
      configuring: this.configuring,
      configuredBridgeUrl: game.settings.get(MODULE_ID, 'bridgeUrl'),
      configuredProjectAlias: game.settings.get(MODULE_ID, 'projectAlias'),
      entries: this.entries,
      query: this.query,
      selectedName: this.selectedName,
      selectedId: this.selectedId,
      documents: this.documents,
      contentText: this.contentText,
      unsupported: this.unsupported,
      publishable: Boolean(this.documentBlocks && !this.selectedDocument?.isHidden && !this.isHiddenByAncestry()),
      error: this.error,
      loading: this.loading
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    root.querySelector('[data-lk-control="configure"]')?.addEventListener('click', async () => {
      this.configuring = true;
      await this.render();
    });
    root.querySelector('[data-lk-control="browse"]')?.addEventListener('click', async () => {
      this.configuring = false;
      await this.render();
    });
    root.querySelector('[data-lk-control="connect"]')?.addEventListener('click', async () => {
      const inputToken = root.querySelector('#lk-bridge-token')?.value?.trim() ?? '';
      const bridgeUrl = root.querySelector('#lk-bridge-url')?.value?.trim() ?? '';
      const alias = root.querySelector('#lk-project-alias')?.value?.trim() ?? '';
      let token;
      try {
        const key = connectionKey({ base: bridgeUrl, alias, worldId: game.world?.id });
        token = inputToken || getPairedToken(credentialStore(), key);
      } catch (error) { return ui.notifications.warn(error.message); }
      if (!/^[0-9a-f]{64}$/i.test(token)) return ui.notifications.warn('Enter the 64-character bridge credential for this project.');
      // Authenticate before saving credentials or world settings.
      this.loading = true;
      this.error = '';
      try {
        await this.request('/api/project', {}, token, { bridgeUrl, alias });
        await game.settings.set(MODULE_ID, 'bridgeUrl', normalizedBridgeUrl(bridgeUrl));
        await game.settings.set(MODULE_ID, 'projectAlias', alias);
        await rememberCredential(token);
        this.configuring = false;
        this.loaded = false;
        this.loading = false;
        await this.loadTree();
        ui.notifications.info('LegendKeeper connected. This browser will reconnect automatically.');
      } catch (error) {
        this.loading = false;
        this.error = error.message;
        await this.render();
      }
    });
    root.querySelector('[data-lk-control="disconnect"]')?.addEventListener('click', async () => {
      await forgetCredential();
      this.entries = [];
      this.loaded = false;
      await this.render();
    });
    root.querySelector('[data-lk-control="refresh"]')?.addEventListener('click', () => this.loadTree());
    root.querySelector('[data-lk-control="publish"]')?.addEventListener('click', () => this.publishJournal());
    root.querySelector('.lk-search')?.addEventListener('submit', async event => {
      event.preventDefault();
      await this.loadTree(root.querySelector('.lk-search input[name="query"]')?.value?.trim() ?? '');
    });
    root.querySelector('[data-lk-control="clear-search"]')?.addEventListener('click', () => this.loadTree());
    root.querySelectorAll('[data-resource-id]:not([data-document-id])').forEach(button => {
      button.addEventListener('click', () => this.openResource(button.dataset.resourceId));
    });
    root.querySelectorAll('[data-document-id]').forEach(button => {
      button.addEventListener('click', () => this.openDocument(button.dataset.resourceId, button.dataset.documentId));
    });
    if (sessionToken && !this.configuring && !this.loaded && !this.loading) void this.loadTree();
  }

  async request(endpoint, params = {}, credential = sessionToken, configuration = null) {
    if (!game.user.isGM) throw new Error('Only a GM can access the private LegendKeeper bridge.');
    const raw = configuration?.bridgeUrl ?? game.settings.get(MODULE_ID, 'bridgeUrl');
    const project = (configuration?.alias ?? game.settings.get(MODULE_ID, 'projectAlias')).trim();
    if (!raw || !project) throw new Error('Configure Bridge URL and Project Alias in Module Settings once.');
    const base = normalizedBridgeUrl(raw);
    const url = new URL(`${base}${endpoint}`);
    url.searchParams.set('project', project);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${credential}` },
        cache: 'no-store', signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401 && credential === sessionToken && sessionToken && !configuration) await forgetCredential();
        throw new Error(body.error || `Bridge returned HTTP ${response.status}`);
      }
      return body;
    } finally { clearTimeout(timeout); }
  }

  async loadTree(query = '') {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    try {
      const project = await this.request('/api/project');
      this.projectName = project.name || 'LegendKeeper';
      this.query = query;
      if (query) {
        const response = await this.request('/api/search', { q: query });
        this.entries = (response.data ?? []).map(hit => ({ id: hit.resource.id, name: hit.resource.name, hidden: Boolean(hit.resource.isHidden), padding: 8 }));
      } else {
        const response = await this.request('/api/resources');
        this.entries = entryTree(response.data ?? []);
        this.resourceIndex = new Map((response.data ?? []).map(r => [r.id, r]));
      }
      this.loaded = true;
    } catch (error) {
      this.error = error.message;
      this.loaded = true;
    } finally {
      this.loading = false;
      await this.render();
    }
  }

  async openResource(resourceId) {
    this.error = '';
    this.documentBlocks = null;
    this.selectedDocument = null;
    try {
      const resource = await this.request(`/api/resource/${encodeURIComponent(resourceId)}`);
      this.selectedResource = resource;
      this.selectedId = resource.id;
      this.selectedName = resource.name;
      this.documents = (resource.documents || []).map(d => ({
        id: d.id, name: d.name, type: d.type, isHidden: Boolean(d.isHidden), active: false
      }));
      const initial = this.documents.find(d => d.type === 'page') ?? this.documents[0];
      if (initial) await this.fetchDocument(initial);
      else { this.contentText = 'This entry has no documents.'; this.unsupported = false; }
    } catch (error) { this.error = error.message; }
    await this.render();
  }

  async openDocument(resourceId, documentId) {
    if (resourceId !== this.selectedId) return;
    this.error = '';
    try {
      const doc = this.documents.find(d => d.id === documentId);
      if (!doc) return;
      await this.fetchDocument(doc);
    } catch (error) { this.error = error.message; }
    await this.render();
  }

  async fetchDocument(doc) {
    this.documents.forEach(d => { d.active = d.id === doc.id; });
    this.selectedDocument = doc;
    this.documentBlocks = null;
    this.unsupported = doc.type !== 'page' && doc.type !== 'blank';
    if (this.unsupported) { this.contentText = ''; return; }
    const response = await this.request(`/api/document/${encodeURIComponent(this.selectedId)}/${encodeURIComponent(doc.id)}`);
    this.documentBlocks = response;
    this.contentText = String(response.text ?? ''); // GM view only. Handlebars escapes text.
  }

  isHiddenByAncestry() {
    let resource = this.selectedResource;
    const seen = new Set();
    while (resource) {
      if (resource.isHidden || resource.id === 'templates' || resource.parentId === 'templates') return true;
      if (!resource.parentId) return false;
      if (seen.has(resource.parentId)) return true;
      seen.add(resource.parentId);
      resource = this.resourceIndex.get(resource.parentId);
      if (!resource) return true; // Fail closed when the tree is incomplete.
    }
    return true;
  }

  async publishJournal() {
    if (!game.user.isGM || !this.selectedId || !this.selectedDocument || !this.documentBlocks) return;
    if (this.isHiddenByAncestry() || this.selectedDocument.isHidden) {
      return ui.notifications.warn('This entry, one of its parents, or its document is hidden or unverified. Refresh the full tree and check visibility before sharing.');
    }
    const { html, omitted } = journalHTML(this.documentBlocks);
    if (!html.trim()) return ui.notifications.warn('No supported public text blocks are available to share.');
    const alias = game.settings.get(MODULE_ID, 'projectAlias');
    const source = `${alias}/${this.selectedId}/${this.selectedDocument.id}`;
    const existing = game.journal.find(j => j.getFlag(MODULE_ID, 'source') === source);
    const name = `${this.selectedName}${this.documents.length > 1 ? `: ${this.selectedDocument.name}` : ''}`;
    const answer = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Publish LegendKeeper page' },
      content: `<p>Publish <strong>${foundry.utils.escapeHTML(name)}</strong> as a readable Foundry Journal for all players?</p>` +
        `<p>The journal is a snapshot, refreshed only when you publish it again. ${omitted} hidden or unsupported block(s) will be excluded. Review the resulting journal for sensitive information.</p>`,
      rejectClose: false
    });
    if (!answer) return;
    try {
      if (existing) {
        const matchingPage = existing.pages.find(p => p.getFlag(MODULE_ID, 'source') === source);
        if (matchingPage) {
          await matchingPage.update({ name, 'text.content': html });
        } else {
          await existing.createEmbeddedDocuments('JournalEntryPage', [{ name, type: 'text', text: { format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML, content: html }, flags: { [MODULE_ID]: { source } } }]);
        }
        await existing.update({ name, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });
      } else {
        await JournalEntry.create({
          name,
          ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
          flags: { [MODULE_ID]: { source } },
          pages: [{ name, type: 'text', text: { format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML, content: html }, flags: { [MODULE_ID]: { source } } }]
        });
      }
      ui.notifications.info(`Published ${name} to the Foundry Journals directory.`);
    } catch (error) {
      console.error(`${MODULE_ID} publish failed`, error);
      ui.notifications.error(`Unable to publish journal: ${error.message}`);
    }
  }
}

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'bridgeUrl', {
    name: 'Bridge URL',
    hint: 'The HTTPS address of your self-hosted bridge, shared by all worlds on this Foundry server.',
    scope: 'world', config: true, type: String, default: '', onChange: restoreCredential
  });
  game.settings.register(MODULE_ID, 'projectAlias', {
    name: 'Project Alias',
    hint: 'The bridge project alias for this world, e.g. rakva. Each world can choose a different alias.',
    scope: 'world', config: true, type: String, default: '', onChange: restoreCredential
  });
  game.settings.register(MODULE_ID, 'pairedCredentials', {
    name: 'Saved LegendKeeper connections',
    scope: 'client', config: false, type: Object, default: {}
  });
  game.settings.registerMenu(MODULE_ID, 'browser', {
    name: 'LegendKeeper Browser', label: 'Open LegendKeeper',
    hint: 'Browse live LegendKeeper content and publish selected pages to Foundry Journals.',
    icon: 'fa-solid fa-book-open', type: LegendKeeperBrowser, restricted: true
  });
});


async function ensureGMHotbarMacros() {
  for (const definition of MACRO_DEFINITIONS) {
    if (game.macros.contents.some(macro => macro.getFlag(MODULE_ID, 'launcher') === definition.id)) continue;
    await Macro.create({
      name: definition.name,
      type: 'script',
      command: definition.command,
      img: 'icons/svg/book.svg',
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: { [MODULE_ID]: { launcher: definition.id } }
    });
  }
}

Hooks.once('ready', async () => {
  if (!game.user.isGM) return;
  restoreCredential(); // Automatic reconnect on the same GM browser.
  game.modules.get(MODULE_ID).api = {
    open: () => new LegendKeeperBrowser().render(true),
    configure: () => new LegendKeeperBrowser({ configure: true }).render(true),
    forget: () => forgetCredential()
  };
  try { await ensureGMHotbarMacros(); }
  catch (error) {
    console.error(`${MODULE_ID}: unable to install GM macros`, error);
    ui.notifications.warn('LegendKeeper could not create its hotbar macros. Check permissions or create them manually.');
  }
});
