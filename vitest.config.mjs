import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const jsxStub = fileURLToPath(
    new URL("./tools/jsx-runtime-stub.mjs", import.meta.url),
);

export default defineConfig({
    // The mod brings no React package: Claude Code compiles its JSX, and the suite resolves the runtime to a stub.
    resolve: {
        alias: {
            "react/jsx-dev-runtime": jsxStub,
            "react/jsx-runtime": jsxStub,
        },
    },
    test: {
        include: ["plugin/hooks/**/*.spec.ts"],
        environment: "node",
    },
});
