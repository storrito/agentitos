# agentitos

Little agents for big stories. 🌮

**agentitos** is a collection of specialized LLM agents built around [Storrito](https://storrito.com/), the tool for planning and publishing Instagram Stories. Each agent lives in its own folder and bundles the skills, scripts and supporting files an LLM agent needs to handle one job end to end: media generation, video editing and other story workflows.

## Structure

```
agentitos/
├── <agent-name>/
│   ├── SKILL.md       # entry point for the agent: when to use it, step by step
│   ├── README.md      # full reference for humans
│   └── ...            # scripts, assets, examples – whatever the recipe needs
└── ...
```

Every agent folder is a **vertical slice**: an independent recipe with its own dependencies, scripts, examples and docs. Folders never import from each other, so you can copy a single one into your agent setup (e.g. Claude Code, or any skill-capable agent runtime), follow its `SKILL.md` / README and you're good to go.

## For harnesses

Each `SKILL.md` follows the [Agent Skills](https://agentskills.io/specification) format, so any skill-capable agent can load it. A harness that lets people pick a task up front (like [pchat](https://github.com/simplemono/pchat)) reads these optional `metadata` keys for its onboarding, each with an optional `-de` variant for German:

| Key | Use |
| --- | --- |
| `title` | the task's name in a picker |
| `summary` | one sentence under the title |
| `ask` | the first message: what the person should bring |
| `placeholder` | the composer's placeholder |
| `inputs` | what to attach, comma-separated: `video`, `audio`, `image` (empty: nothing) |

Paths in a `SKILL.md` are written as `<skill>/…`, relative to the skill's folder; outputs always go to the caller's working directory, never into the skill.

## Agents

| Agent | Description |
|-------|-------------|
| [kinetic-lyrics](kinetic-lyrics/) | Spoken audio, podcasts or talking-head clips → kinetic-typography video (lyric-video style) over an illustrated world of light that renders on the CPU, for 16:9, 9:16 and more. Includes highlight finding, speaker detection, ASR repair and automatic QA. |

## Contributing

Issues and pull requests are welcome. A new agent gets its own top-level folder with a `SKILL.md` and a `README.md` that describe what it does, what it needs (API keys, CLI tools, …) and how to run it.

## License

[MIT](LICENSE) © Storrito
