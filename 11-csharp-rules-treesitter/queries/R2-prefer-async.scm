; R2a: async void methods / local functions
((method_declaration
   (modifier) @_async
   returns: (predefined_type) @_void
   name: (identifier) @name
   parameters: (parameter_list) @params) @async_void
 (#eq? @_async "async")
 (#eq? @_void "void"))

((local_function_statement
   (modifier) @_async
   type: (predefined_type) @_void
   name: (identifier) @name
   parameters: (parameter_list) @params) @async_void
 (#eq? @_async "async")
 (#eq? @_void "void"))

; R2b: candidate synchronous I/O calls: Receiver.Method(...)
(invocation_expression
  function: (member_access_expression
    expression: (_) @receiver
    name: (identifier) @method)) @call
