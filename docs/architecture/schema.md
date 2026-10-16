# Schema

`lib/schema.js` is the single code source of field types, defaults, ranges, enums, units, editor-only flags and canonical order; [schema.md](../schema.md) documents it. It lives in `lib/` because `lib/validate.js` and `lib/serialize.js` need it and `lib/` cannot import `js/`. Model defaults, validation, the serializer and the inspector never redeclare a default, range or key order.
