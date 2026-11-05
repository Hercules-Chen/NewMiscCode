// UI strings. zh-TW is the default; en is the alternative. Keys are used by data-i18n attributes and t().
export const STRINGS = {
  'zh-TW': {
    appTitle: '現場巡檢紀錄',
    appSub: '離線也能記錄，恢復連線自動同步',
    online: '線上', offline: '離線',
    pending: '待同步', conflicts: '衝突',
    langBtn: 'EN', langTitle: 'Switch to English',
    themeTitle: '切換主題（自動/淺色/深色）', themeAuto: '自動', themeLight: '淺色', themeDark: '深色',
    updateAvailable: '新版本可用，重新載入', updateBtn: '重新載入', updateLater: '稍後',
    formNew: '新增巡檢紀錄', formEdit: '編輯紀錄',
    fTitle: '項目名稱', fTitlePh: '例：B1 消防栓壓力', fLocation: '位置', fLocationPh: '例：A 棟 B1 停車場',
    fStatus: '狀態', stOk: '正常', stIssue: '異常', stFixed: '已改善',
    fNote: '備註', fNotePh: '觀察結果、數值、後續處理…', fPhoto: '照片（選填，自動縮圖）', removePhoto: '移除照片',
    save: '儲存', cancel: '取消', saved: '已儲存（{state}）', savedQueued: '已排入待同步佇列', savedSynced: '已同步',
    titleRequired: '請輸入項目名稱',
    listTitle: '紀錄列表', empty: '目前沒有紀錄。先新增一筆吧！離線時也可以新增。',
    edit: '編輯', del: '刪除', confirmDelete: '確定刪除「{title}」？',
    tagPending: '待同步', tagConflict: '衝突', tagError: '被拒絕',
    conflictTitle: '同步衝突（需要你決定）',
    conflictHelp: '伺服器上的版本已被其他裝置修改。請選擇要保留哪一份：',
    mine: '我的版本', theirs: '伺服器版本', keepMine: '保留我的', takeTheirs: '採用對方', deletedMark: '（已刪除）',
    syncTitle: '同步狀態與紀錄', syncNow: '立即同步', clearLog: '清除紀錄', logEmpty: '尚無同步紀錄',
    statPending: '待同步', statConflicts: '衝突', statRecords: '本機筆數', statLast: '最後同步',
    never: '從未', bgSync: 'Background Sync', supported: '支援', notSupported: '不支援（改用 online 事件）',
    swState: 'Service Worker', swNone: '未註冊', swActive: '已啟用', swNotControlled: '已註冊（重新整理後接管）',
    version: '版本', debugOn: '除錯模式已開啟（?debug=1）', resetLocal: '清除本機資料',
    confirmReset: '確定清除本機所有資料（含未同步項目）？',
    syncing: '同步中…', syncDone: '同步完成：成功 {ok}、衝突 {conflicts}、剩餘 {remaining}', syncOffline: '目前離線，恢復連線後會自動同步',
    syncFail: '同步失敗：{err}（稍後自動重試）',
    resolvedMine: '已保留我的版本，將覆寫伺服器', resolvedTheirs: '已採用伺服器版本',
    updatedAt: '更新', byVersion: 'v{v}',
  },
  en: {
    appTitle: 'Field Inspection Notes',
    appSub: 'Works offline, syncs automatically when back online',
    online: 'Online', offline: 'Offline',
    pending: 'Pending', conflicts: 'Conflicts',
    langBtn: '中文', langTitle: '切換為中文',
    themeTitle: 'Toggle theme (auto/light/dark)', themeAuto: 'Auto', themeLight: 'Light', themeDark: 'Dark',
    updateAvailable: 'A new version is available, reload', updateBtn: 'Reload', updateLater: 'Later',
    formNew: 'New inspection record', formEdit: 'Edit record',
    fTitle: 'Item', fTitlePh: 'e.g. B1 hydrant pressure', fLocation: 'Location', fLocationPh: 'e.g. Building A, B1 parking',
    fStatus: 'Status', stOk: 'OK', stIssue: 'Issue', stFixed: 'Fixed',
    fNote: 'Notes', fNotePh: 'Observations, readings, follow-up…', fPhoto: 'Photo (optional, auto-resized)', removePhoto: 'Remove photo',
    save: 'Save', cancel: 'Cancel', saved: 'Saved ({state})', savedQueued: 'queued for sync', savedSynced: 'synced',
    titleRequired: 'Please enter an item name',
    listTitle: 'Records', empty: 'No records yet. Add one - it works offline too!',
    edit: 'Edit', del: 'Delete', confirmDelete: 'Delete "{title}"?',
    tagPending: 'Pending', tagConflict: 'Conflict', tagError: 'Rejected',
    conflictTitle: 'Sync conflicts (your decision needed)',
    conflictHelp: 'The server copy was changed by another device. Choose which version to keep:',
    mine: 'Mine', theirs: 'Server', keepMine: 'Keep mine', takeTheirs: 'Use theirs', deletedMark: '(deleted)',
    syncTitle: 'Sync status & log', syncNow: 'Sync now', clearLog: 'Clear log', logEmpty: 'No sync events yet',
    statPending: 'Pending', statConflicts: 'Conflicts', statRecords: 'Local records', statLast: 'Last sync',
    never: 'never', bgSync: 'Background Sync', supported: 'supported', notSupported: 'not supported (uses online event)',
    swState: 'Service Worker', swNone: 'not registered', swActive: 'active', swNotControlled: 'registered (controls after reload)',
    version: 'Version', debugOn: 'Debug mode on (?debug=1)', resetLocal: 'Clear local data',
    confirmReset: 'Clear ALL local data (including unsynced items)?',
    syncing: 'Syncing…', syncDone: 'Sync done: ok {ok}, conflicts {conflicts}, remaining {remaining}', syncOffline: 'Offline - will sync automatically when back online',
    syncFail: 'Sync failed: {err} (will retry)',
    resolvedMine: 'Kept my version; it will overwrite the server', resolvedTheirs: 'Using the server version',
    updatedAt: 'Updated', byVersion: 'v{v}',
  },
};

export const LANGS = Object.keys(STRINGS);
let lang = 'zh-TW';

export function setLang(l) { lang = STRINGS[l] ? l : 'zh-TW'; document.documentElement.lang = lang; return lang; }
export function getLang() { return lang; }
export function t(key, vars) {
  let s = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS['zh-TW'][key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
  document.title = t('appTitle');
}
