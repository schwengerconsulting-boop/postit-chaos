import { defineConfig } from "vitest/config"

const roots = (process.env.TEST_TARGET || "common,frontend,backend").split(",")

export default defineConfig({
    test: {
        testTimeout: 30000,
        hookTimeout: 60000, // first Chrome launch on CI runners takes longer than the 10 s default
        include: roots.map((target) => `${target}/**/*.test.ts`),
    },
})
