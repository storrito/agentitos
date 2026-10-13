# agentitos

Little agents for big stories. 🌮

**agentitos** is a collection of specialized LLM agents built around [Storrito](https://storrito.com/), the tool for planning and publishing Instagram Stories. Each agent lives in its own folder and bundles the skills, scripts and supporting files an LLM agent needs to handle one job end to end: media generation, video editing and other story workflows.

## Structure

```
agentitos/
├── <agent-name>/
│   ├── README.md      # what the agent does and how to use it
│   ├── skills/        # skill definitions / prompts
│   ├── scripts/       # helper scripts the agent can run
│   └── ...            # templates, assets, configs
└── ...
```

Every agent folder is self-contained: copy it into your agent setup (e.g. Claude Code, or any skill-capable agent runtime), follow its README and you're good to go.

## Agents

| Agent | Description |
|-------|-------------|
| _coming soon_ | |

## Contributing

Issues and pull requests are welcome. A new agent gets its own top-level folder with a `README.md` that describes what it does, what it needs (API keys, CLI tools, …) and how to run it.

## License

[MIT](LICENSE) © Storrito
