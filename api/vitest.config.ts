import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests get their own in-memory database, so they never touch your ./db folder.
    env: { DB_DIR: "memory://" },
  },
});
