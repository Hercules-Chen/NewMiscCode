; R4a: new HttpClient(...)
((object_creation_expression type: (_) @type) @new_http
 (#match? @type "^(global::)?(System\\.Net\\.Http\\.)?HttpClient$"))

; R4a: HttpClient c = new();   (target-typed new)
((variable_declaration
   type: (_) @type
   (variable_declarator (implicit_object_creation_expression) @new_http))
 (#match? @type "^(global::)?(System\\.Net\\.Http\\.)?HttpClient$"))

; R4b: Thread.Sleep(...)
((invocation_expression
   function: (member_access_expression) @callee) @sleep
 (#match? @callee "^(global::)?(System\\.Threading\\.)?Thread\\.Sleep$"))
