; Run on a catch body: anything that rethrows or calls a function (checked against loggingPatterns)
(throw_statement) @throw
(throw_expression) @throw
(invocation_expression function: (_) @callee) @call
