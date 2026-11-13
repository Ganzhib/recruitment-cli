# Development conventions

- Follow the `src/cli`, `src/core`, `src/runtime`, `src/services`, `src/platform` boundaries. Shared modules must not import concrete platform adapters. Assemble built-ins only in `src/platform/builtins.ts`.
- Keep site protocols, selectors, authentication and platform-specific input schemas under `src/platform/<id>/`. Use common selection fields and opaque `options` instead of adding platform-only CLI flags.
- Export the client, adapter extension interfaces and public types from `src/index.ts`. CLI and third-party consumers share the same business services.
- Identify the actual account and current role after login. Bind plans to stable platform/account identities. Aliases never own locks or write records.
- Persist a pending operation before every remote write. Never automatically replay a write after timeout, exception or interruption. Unknown delivery results remain indeterminate.
- Trust typed internal contracts and successful protocol payloads. Validate user input, site configuration and persisted files at their boundaries. Keep optional checks only where the protocol or lifecycle requires them.
- Keep cookies local and out of logs, fixtures, commits and generated artifacts. Offline browser tests intercept all requests and use fabricated profiles.
- Use Prettier for standard TypeScript formatting. Run `npm run format:check`, `npm run check`, `npm test`, `npm run test:browser`, `npm run smoke` and `npm run check:package` before submitting.
- Work directly on `main` and submit changes there; do not create feature or bugfix branches unless explicitly requested. Commits use `<type>(<scope>): <中文描述>`.
- Submit branches, commits and pull requests through the GitHub connector for this task. Do not use local Git to submit or push changes.
