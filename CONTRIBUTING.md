# Contributing

This repository holds Claude Code skills, one per folder under `skills/`. The
conventions below keep skills from colliding and keep each one loadable.

## Layout

```
skills/<skill-name>/
├── SKILL.md          required: YAML frontmatter + instructions
├── references/       docs Claude reads on demand (long material goes here)
├── scripts/          executable helpers the skill tells Claude to run
├── assets/           files copied or adapted into the user's project
└── evals/            test cases in the `claude plugin eval` layout
```

Nothing lives at the repository root besides `README.md`, `CONTRIBUTING.md`,
`LICENSE` and `.gitignore`.

## Rules

- **One skill per folder.** The folder name is the skill name.
- **Names are kebab-case**: lowercase letters, digits and hyphens, starting with
  a letter (`app-feedback`, not `AppFeedback` or `app_feedback`).
- **Frontmatter is required.** `SKILL.md` starts with YAML frontmatter holding
  `name` (same as the folder) and `description`. The description is what makes
  Claude pick the skill, so say what it does and list the situations and
  phrases that should trigger it.
- **`SKILL.md` stays under 500 lines.** Move long material into `references/`
  and point to it from the body with a line on when to read it.
- **Stack-agnostic body, concrete references.** The body should work for any
  codebase. Put a specific implementation (one framework, one database) in
  `references/` and ready-to-adapt code in `assets/`.
- **Eval cases live under `evals/<case-name>/`**, each with `prompt.md`,
  `case.yaml` and at least one grader in `graders/`. The format is the one
  Anthropic's skill-creator skill documents (`references/schemas.md` there).
- **Workspaces are not committed.** Running evals writes to a sibling folder
  `<skill>-workspace/`; it is git-ignored, as are packaged `*.skill` files.
- **Commit messages** are short imperative sentences. One skill change per
  commit where practical.

## Adding a skill

1. Create `skills/<skill-name>/SKILL.md` with frontmatter and body.
2. Add `references/`, `scripts/`, `assets/` only if they carry weight.
3. Add two or three eval cases under `evals/`.
4. Add a row to the table in `README.md`.
