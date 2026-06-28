# faster-features install skill

A Claude Code skill that wires faster-features into any project for you. Instead
of copy-pasting, a developer just runs `/faster-features` in their repo and Claude
detects the stack, deploys the Worker, embeds the widget, adds the GitHub
automation, and (optionally) sets up the roadmap + upvoting.

## Install

Copy the skill into Claude Code's skills directory:

```bash
# project-local (this repo only)
mkdir -p .claude/skills && cp -r skills/faster-features .claude/skills/

# or global (all your projects)
mkdir -p ~/.claude/skills && cp -r skills/faster-features ~/.claude/skills/
```

Then in Claude Code, run:

```
/faster-features
```

## What it does

Follows [`faster-features/SKILL.md`](faster-features/SKILL.md): fetches the
package, detects the framework, deploys the ingest Worker (terminal or
no-terminal button), embeds the widget, copies the GitHub workflows + config,
and optionally adds the public roadmap with upvoting — then verifies end to end.

This is the same playbook as [AGENTS.md](../AGENTS.md), packaged as a one-command
skill rather than a doc other agents read passively.
