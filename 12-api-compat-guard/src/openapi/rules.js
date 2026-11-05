// 相容性規則表（單一事實來源；README 的規則表依此撰寫）。
// Compatibility rule table (single source of truth).
// severity: BREAKING | NON_BREAKING | INFO
// msg: {zh, en} 模板，{x} 會被參數取代。

export const RULES = {
  PATH_REMOVED: { severity: 'BREAKING', zh: '路徑 {path} 已移除', en: 'Path {path} was removed',
    whyZh: '舊客戶端呼叫會得到 404。', whyEn: 'Existing clients get 404.', example: 'DELETE /orders/{id} 整個路徑消失' },
  OPERATION_REMOVED: { severity: 'BREAKING', zh: '操作 {op} 已移除', en: 'Operation {op} was removed',
    whyZh: '舊客戶端呼叫會得到 404/405。', whyEn: 'Existing clients get 404/405.', example: 'DELETE /orders/{id} removed' },
  PATH_ADDED: { severity: 'NON_BREAKING', zh: '新增路徑 {path}', en: 'Path {path} added',
    whyZh: '新增功能不影響舊客戶端。', whyEn: 'Additive.', example: 'GET /orders/{id}/history' },
  OPERATION_ADDED: { severity: 'NON_BREAKING', zh: '新增操作 {op}', en: 'Operation {op} added',
    whyZh: '新增功能不影響舊客戶端。', whyEn: 'Additive.', example: 'PATCH /orders/{id}' },
  OPERATION_DEPRECATED: { severity: 'INFO', zh: '操作 {op} 標記為 deprecated', en: 'Operation {op} marked deprecated',
    whyZh: '目前仍可用，但應規劃遷移。', whyEn: 'Still works; plan migration.', example: 'deprecated: true' },
  OPERATION_ID_CHANGED: { severity: 'INFO', zh: 'operationId 由 {old} 改為 {new}', en: 'operationId changed {old} -> {new}',
    whyZh: '線上呼叫不受影響，但產生的 SDK 方法名稱會變。', whyEn: 'Wire-compatible, but generated SDK method names change.', example: 'listOrders -> getOrders' },
  PARAM_REMOVED: { severity: 'INFO', zh: '參數 {param}（{in}）已移除', en: 'Parameter {param} ({in}) removed',
    whyZh: '客戶端仍送出時通常被忽略，但行為可能改變。', whyEn: 'Usually ignored when still sent, but behaviour may change.', example: 'query ?expand removed' },
  PARAM_ADDED_REQUIRED: { severity: 'BREAKING', zh: '新增必填參數 {param}（{in}）', en: 'Required parameter {param} ({in}) added',
    whyZh: '舊客戶端沒有送這個參數，請求會被拒絕。', whyEn: 'Old clients do not send it; requests are rejected.', example: 'header X-Tenant required' },
  PARAM_ADDED_OPTIONAL: { severity: 'NON_BREAKING', zh: '新增選填參數 {param}（{in}）', en: 'Optional parameter {param} ({in}) added',
    whyZh: '不送也可以。', whyEn: 'Can be omitted.', example: 'query ?sort' },
  PARAM_BECAME_REQUIRED: { severity: 'BREAKING', zh: '參數 {param}（{in}）由選填改為必填', en: 'Parameter {param} ({in}) became required',
    whyZh: '沒有送此參數的舊客戶端會失敗。', whyEn: 'Clients omitting it now fail.', example: 'limit required: false -> true' },
  PARAM_BECAME_OPTIONAL: { severity: 'NON_BREAKING', zh: '參數 {param}（{in}）由必填改為選填', en: 'Parameter {param} ({in}) became optional',
    whyZh: '放寬限制。', whyEn: 'Relaxed.', example: 'required: true -> false' },
  PARAM_LOCATION_CHANGED: { severity: 'BREAKING', zh: '參數 {param} 位置由 {old} 改為 {new}', en: 'Parameter {param} moved from {old} to {new}',
    whyZh: '客戶端仍送到舊位置，伺服器讀不到。', whyEn: 'Clients still send it in the old location.', example: 'query limit -> header X-Limit' },
  REQUEST_BODY_BECAME_REQUIRED: { severity: 'BREAKING', zh: '請求本文由選填改為必填', en: 'Request body became required',
    whyZh: '未送本文的舊客戶端會失敗。', whyEn: 'Clients without body fail.', example: 'requestBody.required: true' },
  REQUEST_MEDIA_TYPE_REMOVED: { severity: 'BREAKING', zh: '不再接受請求格式 {media}', en: 'Request media type {media} no longer accepted',
    whyZh: '以該格式送出的請求會得到 415。', whyEn: 'Requests in that format get 415.', example: 'application/xml removed' },
  REQUEST_FIELD_ADDED_REQUIRED: { severity: 'BREAKING', zh: '請求新增必填欄位 {field}', en: 'Required request field {field} added',
    whyZh: '舊客戶端不會送此欄位，驗證失敗。', whyEn: 'Old clients do not send it; validation fails.', example: 'POST /orders 需要 currency' },
  REQUEST_FIELD_ADDED_OPTIONAL: { severity: 'NON_BREAKING', zh: '請求新增選填欄位 {field}', en: 'Optional request field {field} added',
    whyZh: '可省略。', whyEn: 'Can be omitted.', example: 'couponCode?' },
  REQUEST_FIELD_BECAME_REQUIRED: { severity: 'BREAKING', zh: '請求欄位 {field} 由選填改為必填', en: 'Request field {field} became required',
    whyZh: '省略此欄位的舊客戶端會失敗。', whyEn: 'Clients omitting it fail.', example: 'note -> required' },
  REQUEST_FIELD_REMOVED: { severity: 'INFO', zh: '請求欄位 {field} 已從 schema 移除', en: 'Request field {field} removed from schema',
    whyZh: '若伺服器拒絕未知欄位（additionalProperties: false）則會失敗。', whyEn: 'Fails if the server rejects unknown fields.', example: 'legacyCode removed' },
  REQUEST_TYPE_CHANGED: { severity: 'BREAKING', zh: '請求 {field} 型別由 {old} 改為 {new}', en: 'Request {field} type changed {old} -> {new}',
    whyZh: '舊客戶端送出的值不再符合型別。', whyEn: 'Values sent by old clients no longer validate.', example: 'qty: integer -> string' },
  REQUEST_ENUM_VALUE_REMOVED: { severity: 'BREAKING', zh: '請求 {field} 移除列舉值 {value}', en: 'Request {field} enum value {value} removed',
    whyZh: '舊客戶端仍可能送出此值。', whyEn: 'Old clients may still send it.', example: 'status=cancelled 不再接受' },
  REQUEST_ENUM_VALUE_ADDED: { severity: 'NON_BREAKING', zh: '請求 {field} 新增列舉值 {value}', en: 'Request {field} enum value {value} added',
    whyZh: '放寬限制。', whyEn: 'Relaxed.', example: 'status=refunded' },
  REQUEST_CONSTRAINT_TIGHTENED: { severity: 'BREAKING', zh: '請求 {field} 限制變嚴：{detail}', en: 'Request {field} constraint tightened: {detail}',
    whyZh: '以前合法的值現在會被拒絕。', whyEn: 'Previously valid values are rejected.', example: 'maxLength 100 -> 50' },
  RESPONSE_STATUS_REMOVED: { severity: 'BREAKING', zh: '回應狀態碼 {status} 已移除', en: 'Response status {status} removed',
    whyZh: '客戶端依狀態碼判斷成功（例如 201），改了就判斷錯。', whyEn: 'Clients branch on the status code (e.g. 201).', example: '201 -> 200' },
  RESPONSE_STATUS_REMOVED_ERROR: { severity: 'INFO', zh: '錯誤狀態碼 {status} 不再宣告', en: 'Error status {status} no longer documented',
    whyZh: '錯誤處理路徑可能不同，請確認。', whyEn: 'Error handling path may differ.', example: '409 removed' },
  RESPONSE_STATUS_ADDED: { severity: 'NON_BREAKING', zh: '新增回應狀態碼 {status}', en: 'Response status {status} added',
    whyZh: '一般客戶端可處理；若是新的 2xx 請留意。', whyEn: 'Usually fine.', example: '429 added' },
  RESPONSE_MEDIA_TYPE_REMOVED: { severity: 'BREAKING', zh: '回應 {status} 不再提供格式 {media}', en: 'Response {status} media type {media} removed',
    whyZh: '要求該格式的客戶端解析失敗。', whyEn: 'Clients expecting it fail to parse.', example: 'application/json removed' },
  RESPONSE_FIELD_REMOVED: { severity: 'BREAKING', zh: '回應欄位 {field} 已移除', en: 'Response field {field} removed',
    whyZh: '讀取該欄位的客戶端拿到 undefined/null。', whyEn: 'Clients reading it get undefined.', example: 'customerName removed' },
  RESPONSE_FIELD_ADDED: { severity: 'NON_BREAKING', zh: '回應新增欄位 {field}', en: 'Response field {field} added',
    whyZh: '客戶端應忽略未知欄位（嚴格反序列化者除外）。', whyEn: 'Clients should ignore unknown fields.', example: 'currency added' },
  RESPONSE_TYPE_CHANGED: { severity: 'BREAKING', zh: '回應 {field} 型別由 {old} 改為 {new}', en: 'Response {field} type changed {old} -> {new}',
    whyZh: '強型別客戶端（C# DTO 等）反序列化失敗。', whyEn: 'Typed clients (C# DTOs etc.) fail to deserialize.', example: 'total: number -> string' },
  RESPONSE_REQUIRED_TO_OPTIONAL: { severity: 'BREAKING', zh: '回應欄位 {field} 由必有改為可能缺少', en: 'Response field {field} changed from required to optional',
    whyZh: '客戶端假設一定存在，缺少時會出錯。', whyEn: 'Clients assume it is always present.', example: 'note required -> optional' },
  RESPONSE_OPTIONAL_TO_REQUIRED: { severity: 'NON_BREAKING', zh: '回應欄位 {field} 改為必有', en: 'Response field {field} became required',
    whyZh: '保證更強。', whyEn: 'Stronger guarantee.', example: 'email optional -> required' },
  RESPONSE_BECAME_NULLABLE: { severity: 'BREAKING', zh: '回應 {field} 可能為 null', en: 'Response {field} became nullable',
    whyZh: '客戶端未處理 null。', whyEn: 'Clients may not handle null.', example: 'nullable: true' },
  RESPONSE_ENUM_VALUE_ADDED: { severity: 'INFO', zh: '回應 {field} 新增列舉值 {value}', en: 'Response {field} enum value {value} added',
    whyZh: '用 switch 窮舉的客戶端可能無法處理新值。', whyEn: 'Exhaustive switches may not handle it.', example: 'status: refunded' },
  RESPONSE_ENUM_VALUE_REMOVED: { severity: 'NON_BREAKING', zh: '回應 {field} 移除列舉值 {value}', en: 'Response {field} enum value {value} removed',
    whyZh: '回應值域變小，客戶端仍可處理。', whyEn: 'Narrower output; clients still cope.', example: 'status: cancelled' },
  RESPONSE_HEADER_REMOVED: { severity: 'BREAKING', zh: '回應標頭 {header} 已移除', en: 'Response header {header} removed',
    whyZh: '讀取該標頭的客戶端（如分頁 X-Total-Count）失效。', whyEn: 'Clients reading it break.', example: 'X-Total-Count removed' },
  FORMAT_CHANGED: { severity: 'INFO', zh: '{field} format 由 {old} 改為 {new}', en: '{field} format changed {old} -> {new}',
    whyZh: '型別相同但格式不同（如 int32 -> int64），請確認客戶端解析。', whyEn: 'Same type, different format.', example: 'int32 -> int64' },
  SECURITY_ADDED: { severity: 'BREAKING', zh: '操作 {op} 新增驗證需求', en: 'Operation {op} now requires authentication',
    whyZh: '原本匿名呼叫的客戶端會得到 401。', whyEn: 'Anonymous clients get 401.', example: 'security: [bearer]' }
};

export const SEVERITIES = ['BREAKING', 'NON_BREAKING', 'INFO'];

export function fmt(tpl, params) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (params[k] === undefined ? `{${k}}` : String(params[k])));
}

export function makeFinding(rule, location, params = {}, extra = {}) {
  const r = RULES[rule];
  if (!r) throw new Error(`unknown rule ${rule}`);
  return {
    rule,
    severity: r.severity,
    location,
    message: { 'zh-TW': fmt(r.zh, params), en: fmt(r.en, params) },
    params,
    ...extra
  };
}
