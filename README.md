# prototypdigital/claude-marketplace

Claude Code plugin marketplace for the prototypdigital team.

Generated automatically by [bluetemberg](https://github.com/prototypdigital/bluetemberg). Do not edit files under `plugins/` or `.claude-plugin/` directly — they are overwritten on every sync.

## Install a plugin

```
/plugin marketplace add prototypdigital/claude-marketplace
```

## Structure

```
.claude-plugin/
└── marketplace.json       # root manifest
plugins/
└── <profile>/
    ├── .claude-plugin/plugin.json
    ├── skills/
    └── agents/
```

## Sync

The marketplace is kept in sync by the `sync-marketplace` GitHub Actions workflow in each product repo that has `claude-marketplace` in its `bluetemberg.config.json`.
