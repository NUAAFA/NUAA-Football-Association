"use strict";

// Next 16.3.8 uses context.cwd directly when settings.next.rootDir is absent.
// Custom rootDir scanning is outside NUAAFA's validated single-repository profile.
// Failing here preserves the lint failure instead of returning incomplete paths.
function globSync() {
  throw new Error("Custom Next rootDir scanning is unsupported by NUAAFA's validated default-root ESLint profile; review the dependency and lint profile before enabling it.");
}

module.exports = { globSync };
