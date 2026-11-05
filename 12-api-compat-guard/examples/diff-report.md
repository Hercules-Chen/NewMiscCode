# OpenAPI 相容性報告

- 產生時間: 2026-11-05T04:54:27.265Z
- old: `/home/user/newmisccode/12-api-compat-guard/demo/openapi-v1.yaml`
- new: `/home/user/newmisccode/12-api-compat-guard/demo/openapi-v2.yaml`

**發現破壞性變更：不可直接上線**

| 破壞性 | 非破壞性 | 資訊 |
|---|---|---|
| 14 | 11 | 1 |

## 變更清單

| 嚴重度 | 規則 | 位置 | 說明 |
|---|---|---|---|
| 破壞性 | `OPERATION_REMOVED` | `DELETE /orders/{orderId}` | 操作 DELETE /orders/{id} 已移除 |
| 破壞性 | `PARAM_LOCATION_CHANGED` | `GET /orders` | 參數 limit 位置由 query:limit 改為 header:X-Limit |
| 破壞性 | `REQUEST_ENUM_VALUE_REMOVED` | `GET /orders` | 請求 query:status 移除列舉值 "cancelled" |
| 破壞性 | `RESPONSE_FIELD_REMOVED` | `GET /orders -> 200` | 回應欄位 items[].customerName 已移除 |
| 破壞性 | `RESPONSE_FIELD_REMOVED` | `GET /orders -> 200` | 回應欄位 items[].email 已移除 |
| 破壞性 | `RESPONSE_HEADER_REMOVED` | `GET /orders -> 200` | 回應標頭 X-Total-Count 已移除 |
| 破壞性 | `RESPONSE_REQUIRED_TO_OPTIONAL` | `GET /orders -> 200` | 回應欄位 items[].note 由必有改為可能缺少 |
| 破壞性 | `RESPONSE_TYPE_CHANGED` | `GET /orders -> 200` | 回應 items[].total 型別由 number 改為 string |
| 破壞性 | `RESPONSE_FIELD_REMOVED` | `GET /orders/{orderId} -> 200` | 回應欄位 customerName 已移除 |
| 破壞性 | `RESPONSE_FIELD_REMOVED` | `GET /orders/{orderId} -> 200` | 回應欄位 email 已移除 |
| 破壞性 | `RESPONSE_REQUIRED_TO_OPTIONAL` | `GET /orders/{orderId} -> 200` | 回應欄位 note 由必有改為可能缺少 |
| 破壞性 | `RESPONSE_TYPE_CHANGED` | `GET /orders/{orderId} -> 200` | 回應 total 型別由 number 改為 string |
| 破壞性 | `REQUEST_FIELD_ADDED_REQUIRED` | `POST /orders` | 請求新增必填欄位 currency |
| 破壞性 | `RESPONSE_STATUS_REMOVED` | `POST /orders` | 回應狀態碼 201 已移除 |
| 非破壞性 | `PATH_ADDED` | `/orders/{orderId}/history` | 新增路徑 /orders/{orderId}/history |
| 非破壞性 | `PARAM_ADDED_OPTIONAL` | `GET /orders` | 新增選填參數 sort（query） |
| 非破壞性 | `RESPONSE_ENUM_VALUE_REMOVED` | `GET /orders -> 200` | 回應 items[].status 移除列舉值 "cancelled" |
| 非破壞性 | `RESPONSE_FIELD_ADDED` | `GET /orders -> 200` | 回應新增欄位 items[].customer |
| 非破壞性 | `RESPONSE_FIELD_ADDED` | `GET /orders -> 200` | 回應新增欄位 items[].currency |
| 非破壞性 | `RESPONSE_FIELD_ADDED` | `GET /orders -> 200` | 回應新增欄位 items[].updatedAt |
| 非破壞性 | `RESPONSE_ENUM_VALUE_REMOVED` | `GET /orders/{orderId} -> 200` | 回應 status 移除列舉值 "cancelled" |
| 非破壞性 | `RESPONSE_FIELD_ADDED` | `GET /orders/{orderId} -> 200` | 回應新增欄位 customer |
| 非破壞性 | `RESPONSE_FIELD_ADDED` | `GET /orders/{orderId} -> 200` | 回應新增欄位 currency |
| 非破壞性 | `RESPONSE_FIELD_ADDED` | `GET /orders/{orderId} -> 200` | 回應新增欄位 updatedAt |
| 非破壞性 | `RESPONSE_STATUS_ADDED` | `POST /orders` | 新增回應狀態碼 200 |
| 資訊 | `OPERATION_ID_CHANGED` | `GET /orders` | operationId 由 listOrders 改為 getOrders |
