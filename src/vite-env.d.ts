/// <reference types="vite/client" />

/**
 * The version from `package.json`, substituted as a literal at build time
 * (vite.config.ts). Written into every `.wattmatt` file as `app.version`
 * (docs/FILE-FORMAT.md), which is what lets a support question name the build
 * that produced a file — read from the bundle, never from the network.
 */
declare const __APP_VERSION__: string;
