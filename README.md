# FL-UW Chat

E&O (Errors & Omissions) underwriting chatbot — Cursor BDK / Agent SDK project.

## Setup

```bash
npm install   # Node 22.13+, never Bun
npx --yes "@cursor/bdk@0.2.28" login
npx --yes "@cursor/bdk@0.2.28" validate --dir . --json
npx tsc --noEmit -p .
```

## Freeze evals (F1–F3 + chatbot)

```bash
npx --yes "@cursor/bdk@0.2.28" eval --dir . --tag freeze --json --no-stream
npx --yes "@cursor/bdk@0.2.28" eval --dir . --tag chatbot --json --no-stream
```

## Playground

```bash
npx --yes "@cursor/bdk@0.2.28" serve --dir . --mode single --dev
# → http://127.0.0.1:3000/playground
```
