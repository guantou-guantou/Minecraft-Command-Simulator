const DICT = {
  en: {
    file: '&File', newTab: '&New Tab', open: '&Open...', recent: 'Open &Recent', save: '&Save', saveAs: 'Save &As...', closeTab: '&Close Tab', exit: 'E&xit',
    edit: '&Edit', run: '&Run', runOnce: 'Run chain once', tick1: 'Tick +1', tick20: 'Tick +20', reset: 'Reset simulation',
    tabs: '&Tabs', nextTab: '&Next Tab', prevTab: '&Previous Tab', view: '&View', help: '&Help', about: 'About',
    aboutDetail: 'Version {v}\nAn offline simulator for Minecraft Bedrock commands.',
    cannotOpen: 'Cannot open file', notFound: 'File not found', removeRecent: 'Remove from recent list', cannotSave: 'Cannot save file', discard: 'Discard changes', cancel: 'Cancel',
    unsaved: '{name} has unsaved changes.', thisDoc: 'This document', saveBtn: 'Save', dontSave: "Don't save", saveChanges: 'Save changes to {name}?',
  },
  zh: {
    file: '文件(&F)', newTab: '新建标签页(&N)', open: '打开(&O)...', recent: '最近打开(&R)', save: '保存(&S)', saveAs: '另存为(&A)...', closeTab: '关闭标签页(&C)', exit: '退出(&X)',
    edit: '编辑(&E)', run: '运行(&R)', runOnce: '运行当前链一次', tick1: '前进 1 刻', tick20: '前进 20 刻', reset: '重置模拟',
    tabs: '标签页(&T)', nextTab: '下一个标签页(&N)', prevTab: '上一个标签页(&P)', view: '视图(&V)', help: '帮助(&H)', about: '关于',
    aboutDetail: '版本 {v}\nMinecraft 基岩版指令离线模拟器。',
    cannotOpen: '无法打开文件', notFound: '找不到文件', removeRecent: '从最近列表中移除', cannotSave: '无法保存文件', discard: '放弃更改', cancel: '取消',
    unsaved: '{name} 有未保存的更改。', thisDoc: '此文档', saveBtn: '保存', dontSave: '不保存', saveChanges: '要保存对 {name} 的更改吗?',
  },
};

function tr(lang, key, vars = {}) {
  const table = DICT[lang] || DICT.en;
  return (table[key] ?? DICT.en[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

module.exports = { tr, DICT };