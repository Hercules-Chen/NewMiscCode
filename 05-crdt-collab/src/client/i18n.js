// zh-TW (default) / en strings.
export const STRINGS = {
  'zh-TW': {
    appTitle: '協作筆記與任務板',
    room: '房間',
    you: '你的名稱',
    online: '在線',
    status_connected: '已連線・已同步',
    status_connecting: '連線中…',
    status_disconnected: '離線',
    status_simulated: '離線（模擬）',
    pending: '{n} 筆本機變更待同步',
    btnDisconnect: '模擬離線',
    btnReconnect: '重新連線',
    btnLang: 'English',
    btnTheme: '切換深色/淺色',
    btnDebug: '除錯面板',
    btnHistory: '版本歷史',
    notes: '共享筆記（Markdown）',
    notesPlaceholder: '在這裡輸入 Markdown…所有人會即時看到。支援中文輸入法。',
    undo: '復原',
    redo: '重做',
    preview: '預覽',
    edit: '編輯',
    tasks: '共享任務板',
    taskPlaceholder: '新增任務，按 Enter…',
    add: '新增',
    deleteTask: '刪除',
    clearDone: '清除已完成',
    noTasks: '尚無任務。',
    taskBy: '由 {name} 建立',
    taskStats: '{done}/{total} 已完成',
    historyTitle: '版本歷史（伺服器快照）',
    versionLabel: '版本名稱（選填）',
    saveVersion: '儲存目前版本',
    noVersions: '尚無版本。',
    previewVersion: '檢視',
    restoreVersion: '還原成此版本',
    restored: '已還原（可按「復原」撤銷）',
    close: '關閉',
    versionSaveFailed: '儲存版本失敗：需要連上伺服器。',
    debugTitle: '除錯資訊',
    localOnly: 'IndexedDB 已載入',
    youTag: '（你）',
    editingNotes: '正在編輯筆記',
    idle: '閒置'
  },
  en: {
    appTitle: 'Collaborative Notes & Tasks',
    room: 'Room',
    you: 'Your name',
    online: 'Online',
    status_connected: 'Connected · synced',
    status_connecting: 'Connecting…',
    status_disconnected: 'Offline',
    status_simulated: 'Offline (simulated)',
    pending: '{n} local change(s) waiting to sync',
    btnDisconnect: 'Simulate offline',
    btnReconnect: 'Reconnect',
    btnLang: '繁體中文',
    btnTheme: 'Toggle dark/light',
    btnDebug: 'Debug panel',
    btnHistory: 'History',
    notes: 'Shared notes (Markdown)',
    notesPlaceholder: 'Type Markdown here… everyone sees it live. IME input supported.',
    undo: 'Undo',
    redo: 'Redo',
    preview: 'Preview',
    edit: 'Edit',
    tasks: 'Shared task board',
    taskPlaceholder: 'Add a task and press Enter…',
    add: 'Add',
    deleteTask: 'Delete',
    clearDone: 'Clear completed',
    noTasks: 'No tasks yet.',
    taskBy: 'by {name}',
    taskStats: '{done}/{total} done',
    historyTitle: 'Version history (server snapshots)',
    versionLabel: 'Version label (optional)',
    saveVersion: 'Save current version',
    noVersions: 'No versions yet.',
    previewVersion: 'View',
    restoreVersion: 'Restore this version',
    restored: 'Restored (use Undo to revert)',
    close: 'Close',
    versionSaveFailed: 'Saving a version failed: the server must be reachable.',
    debugTitle: 'Debug info',
    localOnly: 'IndexedDB loaded',
    youTag: ' (you)',
    editingNotes: 'editing notes',
    idle: 'idle'
  }
};

let lang = 'zh-TW';
export const getLang = () => lang;
export function setLang(l) { lang = STRINGS[l] ? l : 'zh-TW'; }

export function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS['zh-TW'][key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

export function applyI18n(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-title]')) { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); }
}
