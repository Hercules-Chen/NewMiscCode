; Collects names declared with a Task-like type (or initialised from an *Async call)
; so that R1 can decide whether `name.Result` / `name.Wait()` is on a Task.
(variable_declaration
  type: (_) @type
  (variable_declarator name: (identifier) @name))

(parameter
  type: (_) @type
  name: (identifier) @name)

(property_declaration
  type: (_) @type
  name: (identifier) @name)

(variable_declarator
  name: (identifier) @var_name
  (invocation_expression function: (_) @init_callee))
