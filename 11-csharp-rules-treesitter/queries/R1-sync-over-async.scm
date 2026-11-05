; R1 sync-over-async. Text predicates (#eq? / #any-of?) are evaluated by web-tree-sitter.
; Receiver "task-likeness" for .Result / .Wait() is decided in src/rules/r1.js (no type info in a syntax tree).

; x.GetAwaiter().GetResult()
((invocation_expression
   function: (member_access_expression
     expression: (invocation_expression
       function: (member_access_expression name: (identifier) @_awaiter))
     name: (identifier) @_getresult)) @get_result
 (#eq? @_awaiter "GetAwaiter")
 (#eq? @_getresult "GetResult"))

; x.Result  (property access, filtered further in JS)
((member_access_expression
   expression: (_) @receiver
   name: (identifier) @_name) @result
 (#eq? @_name "Result"))

; x.Wait(...)
((invocation_expression
   function: (member_access_expression
     expression: (_) @receiver
     name: (identifier) @_name)) @wait
 (#eq? @_name "Wait"))

; Task.WaitAll(...) / Task.WaitAny(...)
((invocation_expression
   function: (member_access_expression
     expression: (identifier) @_task
     name: (identifier) @_name)) @wait_all
 (#eq? @_task "Task")
 (#any-of? @_name "WaitAll" "WaitAny"))
