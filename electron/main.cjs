const { app, BrowserWindow, Menu, dialog, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { addRecent, atomicWrite, bdxFile, decodeStructureFile, decodeText, encodeText, pickFileArg, windowOptions, windowTitle } = require('./lib.cjs');
const { tr } = require('./i18n.cjs');

const DEV_URL = process.env.MC_SIM_DEV_URL || '';
const SMOKE = process.env.MC_SIM_SMOKE === '1';
const FILTERS = [{ name: 'MC Command Simulator', extensions: ['mcsim', 'txt'] }, { name: 'All files', extensions: ['*'] }];

let win = null;
let lang = 'en';
const T = (key, vars) => tr(lang, key, vars);
let state = { dirty: false, name: 'Untitled.mcsim' };
let forceClose = false;
let recent = [];
let launchFile = pickFileArg(process.argv, process.cwd());

const recentFile = () => path.join(app.getPath('userData'), 'recent.json');

function loadRecent() {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(), 'utf8'));
    return Array.isArray(list) ? list.filter((f) => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

function remember(file) {
  recent = addRecent(recent, file);
  try {
    atomicWrite(fs, recentFile(), JSON.stringify(recent));
  } catch {
    /* the recent list is a convenience; ignore write failures */
  }
  buildMenu();
}

const send = (channel, payload) => win && !win.isDestroyed() && win.webContents.send(channel, payload);

function buildMenu() {
  const action = (name) => () => send('menu:action', name);
  const template = [
    {
      label: T('file'),
      submenu: [
        { label: T('newTab'), accelerator: 'CmdOrCtrl+N', click: action('new') },
        { label: T('open'), accelerator: 'CmdOrCtrl+O', click: action('open') },
        {
          label: T('recent'),
          enabled: recent.length > 0,
          submenu: recent.map((file) => ({ label: file, click: () => send('menu:open-recent', file) })),
        },
        { type: 'separator' },
        { label: T('save'), accelerator: 'CmdOrCtrl+S', click: action('save') },
        { label: T('saveAs'), accelerator: 'CmdOrCtrl+Shift+S', click: action('saveAs') },
        { label: T('closeTab'), accelerator: 'CmdOrCtrl+W', click: action('closeTab') },
        { type: 'separator' },
        { role: 'quit', label: T('exit') },
      ],
    },
    { label: T('edit'), submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: T('run'),
      submenu: [
        { label: T('runOnce'), accelerator: 'F5', click: action('run') },
        { label: T('tick1'), accelerator: 'F6', click: action('tick') },
        { label: T('tick20'), accelerator: 'Shift+F6', click: action('tick20') },
        { label: T('reset'), accelerator: 'Shift+F5', click: action('reset') },
      ],
    },
    {
      label: T('tabs'),
      submenu: [
        { label: T('nextTab'), accelerator: 'Ctrl+Tab', click: action('nextTab') },
        { label: T('prevTab'), accelerator: 'Ctrl+Shift+Tab', click: action('prevTab') },
      ],
    },
    {
      label: T('view'),
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: T('help'),
      submenu: [
        {
          label: T('about'),
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: T('about'),
              message: 'MC Command Simulator',
              detail: T('aboutDetail', { v: app.getVersion() }),
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function readText(file) {
  return { path: file, ...decodeText(fs.readFileSync(file, 'utf8')) };
}

/** Reports a failed open; a missing file that is in the recent list can be removed from it. */
function openFailed(file, e) {
  if (e && e.code === 'ENOENT' && recent.some((f) => f.toLowerCase() === file.toLowerCase())) {
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: [T('removeRecent'), T('cancel')],
      defaultId: 0,
      cancelId: 1,
      title: T('notFound'),
      message: `${T('notFound')}: ${file}`,
    });
    if (r === 0) {
      recent = recent.filter((f) => f.toLowerCase() !== file.toLowerCase());
      try {
        atomicWrite(fs, recentFile(), JSON.stringify(recent));
      } catch {
        /* the list is only a convenience */
      }
      buildMenu();
    }
    return;
  }
  dialog.showErrorBox(T('cannotOpen'), `${file}\n\n${e.message}`);
}

function registerIpc() {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('file:launch', () => {
    const file = launchFile;
    launchFile = null;
    if (!file) return null;
    try {
      const r = readText(file);
      remember(file);
      return r;
    } catch (e) {
      openFailed(file, e);
      return null;
    }
  });
  ipcMain.handle('file:open-dialog', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: FILTERS });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      const out = readText(r.filePaths[0]);
      remember(out.path);
      return out;
    } catch (e) {
      dialog.showErrorBox(T('cannotOpen'), e.message);
      return null;
    }
  });
  ipcMain.handle('file:read', (_e, file) => {
    if (typeof file !== 'string') return null;
    try {
      const out = readText(file);
      remember(file);
      return out;
    } catch (e) {
      openFailed(file, e);
      return null;
    }
  });
  ipcMain.handle('file:save', (_e, file, content, eol) => {
    if (typeof file !== 'string' || typeof content !== 'string') return null;
    try {
      atomicWrite(fs, file, encodeText(content, eol));
      remember(file);
      return file;
    } catch (e) {
      dialog.showErrorBox(T('cannotSave'), `${file}\n\n${e.message}`);
      return null;
    }
  });
  const saveDialog = async (suggested, content, filters, rememberIt, eol) => {
    if (typeof content !== 'string') return null;
    const r = await dialog.showSaveDialog(win, { defaultPath: String(suggested || 'untitled.mcsim'), filters });
    if (r.canceled || !r.filePath) return null;
    try {
      atomicWrite(fs, r.filePath, encodeText(content, eol));
      if (rememberIt) remember(r.filePath);
      return r.filePath;
    } catch (e) {
      dialog.showErrorBox(T('cannotSave'), `${r.filePath}\n\n${e.message}`);
      return null;
    }
  };
  ipcMain.handle('file:save-as', (_e, suggested, content, eol) => saveDialog(suggested, content, FILTERS, true, eol));
  ipcMain.handle('file:export', (_e, suggested, content) =>
    saveDialog(suggested, content, [{ name: 'Text', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }], false, 'lf'),
  );
  ipcMain.handle('structure:import', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Structure', extensions: ['mcstructure', 'bdx'] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      const { kind, content } = decodeStructureFile(fs.readFileSync(r.filePaths[0]));
      return { name: path.basename(r.filePaths[0]), kind, base64: content.toString('base64') };
    } catch (e) {
      dialog.showErrorBox(T('cannotOpen'), e.message);
      return null;
    }
  });
  ipcMain.handle('structure:export', async (_e, suggested, base64) => {
    if (typeof base64 !== 'string') return null;
    const r = await dialog.showSaveDialog(win, { defaultPath: String(suggested || 'structure.mcstructure'), filters: [{ name: 'Structure', extensions: ['mcstructure'] }] });
    if (r.canceled || !r.filePath) return null;
    try {
      atomicWrite(fs, r.filePath, Buffer.from(base64, 'base64'));
      return r.filePath;
    } catch (e) {
      dialog.showErrorBox(T('cannotSave'), `${r.filePath}\n\n${e.message}`);
      return null;
    }
  });
  ipcMain.handle('structure:export-bdx', async (_e, suggested, base64) => {
    if (typeof base64 !== 'string') return null;
    const r = await dialog.showSaveDialog(win, { defaultPath: String(suggested || 'structure.bdx'), filters: [{ name: 'BDX', extensions: ['bdx'] }] });
    if (r.canceled || !r.filePath) return null;
    try {
      atomicWrite(fs, r.filePath, bdxFile(Buffer.from(base64, 'base64')));
      return r.filePath;
    } catch (e) {
      dialog.showErrorBox(T('cannotSave'), `${r.filePath}\n\n${e.message}`);
      return null;
    }
  });
  ipcMain.handle('app:confirm-discard', (_e, name) => {
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: [T('discard'), T('cancel')],
      defaultId: 1,
      cancelId: 1,
      message: T('unsaved', { name: name || T('thisDoc') }),
    });
    return r === 0;
  });
  ipcMain.handle('app:set-state', (_e, s) => {
    if (s && typeof s.name === 'string') state = { dirty: !!s.dirty, name: s.name };
    if (win && !win.isDestroyed()) win.setTitle(windowTitle(state.name, state.dirty));
  });
  ipcMain.handle('app:set-language', (_e, l) => {
    if (l === 'en' || l === 'zh') {
      lang = l;
      buildMenu();
    }
  });
  ipcMain.handle('app:force-close', () => {
    forceClose = true;
    if (win && !win.isDestroyed()) win.close();
  });
}

const windowFile = () => path.join(app.getPath('userData'), 'window.json');

function savedWindow() {
  try {
    return windowOptions(JSON.parse(fs.readFileSync(windowFile(), 'utf8')), screen.getAllDisplays().map((d) => d.workArea));
  } catch {
    return windowOptions(null, []);
  }
}

function createWindow() {
  const { maximized, ...bounds } = savedWindow();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, 'icon.png'),
    title: windowTitle(state.name, false),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (maximized && !SMOKE) win.maximize();
  win.once('ready-to-show', () => (SMOKE ? win.showInactive() : win.show()));
  win.on('close', () => {
    if (SMOKE || !win || win.isDestroyed()) return;
    try {
      atomicWrite(fs, windowFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch {
      /* remembering the window is optional */
    }
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!(DEV_URL && url.startsWith(DEV_URL)) && !url.startsWith('file://')) e.preventDefault();
  });
  win.on('close', (e) => {
    if (forceClose || !state.dirty) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: [T('saveBtn'), T('dontSave'), T('cancel')],
      defaultId: 0,
      cancelId: 2,
      message: T('saveChanges', { name: state.name }),
    });
    if (r === 0) send('app:save-and-close');
    else if (r === 1) {
      forceClose = true;
      win.close();
    }
  });
  win.on('closed', () => {
    win = null;
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  if (SMOKE) runSmoke();
}

function runSmoke() {
  const problems = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error') problems.push(event.message);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.log('SMOKE_FAIL render-process-gone ' + d.reason);
    app.exit(1);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.log(`SMOKE_FAIL did-fail-load ${code} ${desc}`);
    app.exit(1);
  });
  win.webContents.on('did-finish-load', async () => {
    try {
      await new Promise((r) => setTimeout(r, 800));
      const result = await win.webContents.executeJavaScript(`(async () => ({
        app: !!document.querySelector('.app'),
        api: typeof window.desktop,
        version: window.desktop ? await window.desktop.version() : null,
        node: typeof window.require + '/' + typeof window.process,
      }))()`);
      const ui = await win.webContents.executeJavaScript(`(async () => {
        try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const grid = () => getComputedStyle(document.querySelector('.docview[style*="flex"] .main')).gridTemplateColumns;
        const before = grid();
        const sp = document.querySelector('.docview[style*="flex"] .splitter.col');
        sp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await wait(100);
        const gridChanged = grid() !== before;
        document.querySelector('.tabnew').click();
        await wait(200);
        const tabs = document.querySelectorAll('.tab').length;
        const fmbe = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'FMBE');
        fmbe && fmbe.click();
        await wait(200);
        const drawer = /Prerequisite|前置/.test(document.querySelector('.drawerbody')?.innerText ?? '');
        const testsBtn = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent === 'Tests');
        testsBtn && testsBtn.click();
        await wait(200);
        const testsPanel = /Run all tests|运行全部测试/.test(document.querySelector('.drawerbody')?.innerText ?? '');
        const rect = (el) => el.getBoundingClientRect();
        const view = () => document.querySelector('.docview[style*="flex"]');
        const layoutOk = () => {
          const main = rect(view().querySelector('.main'));
          const drawerEl = view().querySelector('.drawer');
          const panes = [...view().querySelectorAll('.main > .pane')].map(rect);
          const insideMain = panes.every((p) => p.left >= main.left - 1 && p.right <= main.right + 1);
          const clearOfDrawer = !drawerEl || main.right <= rect(drawerEl).left + 1;
          return insideMain && clearOfDrawer;
        };
        const layoutBefore = layoutOk();
        const cm = view().querySelector('.cm-editor').cmView;
        const setDoc = (t, pos) => cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: t }, selection: { anchor: pos === undefined ? t.length : pos } });
        const key = (k, mods) => cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {})));
        setDoc(Array.from({ length: 200 }, (_, i) => 'line ' + i).join('\\n'), 0);
        await wait(200);
        const longDoc = cm.state.doc.lines === 200 && view().querySelectorAll('.cm-line').length > 0;
        setDoc(['/say a \\\\', '    b', '/say c'].join('\\n'));
        await wait(150);
        const nums = [...view().querySelectorAll('.cm-lineNumbers .cm-gutterElement')].map((e) => e.textContent).slice(-3);
        setDoc('/gamemode ');
        cm.focus();
        await wait(300);
        const hintShown = !!document.querySelector('.cm-hintbar .cm-hint-active') && !document.querySelector('.cm-tooltip .cm-hint-active');
        setDoc('/gam');
        cm.focus();
        key(' ', { ctrlKey: true });
        await wait(500);
        const popupLabels = [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((li) => li.textContent);
        key('Tab');
        await wait(300);
        const accepted = /^\\/(gamerule|gamemode) /.test(cm.state.doc.toString());
        setDoc(['/say a', '/say b'].join('\\n'), 0);
        cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } });
        key('/', { ctrlKey: true });
        const commented = cm.state.doc.toString() === ['# /say a', '# /say b'].join('\\n');
        key('f', { ctrlKey: true });
        await wait(200);
        const searchOpen = !!view().querySelector('.cm-search');
        key('Escape');
        setDoc(['/say m', 'chain a:', '    /say a', 'chain b:', '    /say b'].join('\\n'));
        await wait(300);
        const pickBtn = () => view().querySelector('.chainpicker > button');
        pickBtn().click();
        await wait(150);
        const chainItems = view().querySelectorAll('.chainitem').length;
        const chainBtns = [...view().querySelectorAll('.chainbtns button')];
        chainBtns[1].click();
        await wait(100);
        const afterInvert = pickBtn().textContent;
        chainBtns[0].click();
        await wait(100);
        const afterAll = pickBtn().textContent;
        const chainPicker = chainItems === 3 && afterInvert.includes('0/3') && afterAll.includes('3/3');
        const langSel = document.querySelector('.langsel');
        const selSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        selSetter.call(langSel, 'zh');
        langSel.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(300);
        const zhText = view().querySelector('.toolbar')?.innerText ?? '';
        const zh = zhText.includes('运行一次') && zhText.includes('保存') && !zhText.includes('Run once');
        selSetter.call(langSel, 'en');
        langSel.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(300);
        const en = (view().querySelector('.toolbar')?.innerText ?? '').includes('Run once');
        return { gridChanged, tabs, drawer, layoutBefore, layoutAfter: layoutOk(), editor: !!document.querySelector('.cm-editor'), zh, en, popupLabels, accepted, longDoc, nums, commented, searchOpen, hintShown, testsPanel, chainPicker };
        } catch (e) {
          return { error: String((e && e.stack) || e) };
        }
      })()`);
      console.log('SMOKE_RESULT ' + JSON.stringify({ ...result, ui, consoleProblems: problems }));
      const ok =
        result.app && ui.editor && result.api === 'object' && !problems.length && !ui.error && ui.gridChanged && ui.tabs === 2 &&
        ui.zh && ui.en && ui.accepted && ui.popupLabels.some((t) => t.startsWith('gamemode')) && ui.drawer && ui.layoutBefore && ui.layoutAfter &&
        ui.longDoc && ui.nums.join('|') === '1||2' && ui.commented && ui.searchOpen && ui.hintShown && ui.testsPanel && ui.chainPicker;
      app.exit(ok ? 0 : 1);
    } catch (e) {
      console.log('SMOKE_FAIL ' + e.message);
      app.exit(1);
    }
  });
  setTimeout(() => {
    console.log('SMOKE_FAIL timeout');
    app.exit(2);
  }, 20000);
}

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, cwd) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      const file = pickFileArg(argv, cwd);
      if (file) send('file:open-external', file);
    }
  });
  app.whenReady().then(() => {
    recent = loadRecent();
    lang = app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
    registerIpc();
    buildMenu();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
