---
tags: [app-feedback]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Our Rails app already has a feedback_entries table that the mobile app writes to (columns: id, account_id, user_id, screen, route, kind, screenshot_blob_id, rating, comment, app_version, platform, status, created_at). Accounts are tenants and every model is scoped with a default scope on account_id. Support keeps asking me to run SQL to see what testers sent. Build them an internal page under /internal/feedback where they can see all the notes across accounts with the screenshot, filter by status and kind, and mark each one planned, done or won't do. Support staff shouldn't see users' full email addresses, only the admin role should. Add tests.
