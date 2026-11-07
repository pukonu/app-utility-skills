# prologic-ai-skills

A collection of reusable [Claude Code](https://claude.com/claude-code) skills.
Each skill packages a workflow or mechanism distilled from real projects so that
another Claude session can reproduce it in a different codebase.

## Installing a skill

Claude Code discovers skills in `~/.claude/skills/` (for every project) and in
a project's `.claude/skills/`. A skill is a folder holding `SKILL.md`, so
install one by symlinking or copying its folder.

Symlink (changes in this repo show up at once):

```bash
ln -s "$PWD/skills/app-feedback" ~/.claude/skills/app-feedback
```

Copy into one project only:

```bash
cp -R skills/app-feedback /path/to/project/.claude/skills/app-feedback
```

Once installed, Claude picks the skill up automatically when a request matches
its description, and you can invoke it directly with `/app-feedback`.

## Layout

One skill per folder under `skills/`. Each folder holds `SKILL.md` plus,
as needed, `references/`, `scripts/`, `assets/` and `evals/`. The root holds
only this file, `CONTRIBUTING.md`, `LICENSE` and `.gitignore`. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the conventions.

## Skills

| Skill | What it does |
|---|---|
| [app-feedback](skills/app-feedback/) | Adds an in-app feedback mechanism to any app: a feedback tab on every screen that captures the screen, a screenshot, a kind (problem / change / idea), a rating and a comment, with a submit API, screenshot storage, a triage portal with statuses and audit, and a CLI reader. |
