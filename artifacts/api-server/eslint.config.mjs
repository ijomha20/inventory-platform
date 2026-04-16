export default [
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Use `env` from lib/env.ts instead of process.env directly.",
        },
      ],
    },
  },
  {
    files: ["src/lib/env.ts"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
];
