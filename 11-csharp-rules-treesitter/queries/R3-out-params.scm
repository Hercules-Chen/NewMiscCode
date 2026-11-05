; R3: methods / local functions with at least one `out` parameter
((method_declaration
   name: (identifier) @name
   parameters: (parameter_list
     (parameter (modifier) @_out name: (identifier) @param))) @method
 (#eq? @_out "out"))

((local_function_statement
   name: (identifier) @name
   parameters: (parameter_list
     (parameter (modifier) @_out name: (identifier) @param))) @method
 (#eq? @_out "out"))
