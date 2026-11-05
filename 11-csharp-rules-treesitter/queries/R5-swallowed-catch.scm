; R5: every catch clause; "does it log or rethrow?" is decided by the sub-queries below
(catch_clause
  (catch_declaration type: (_) @type)?
  body: (block) @body) @catch
