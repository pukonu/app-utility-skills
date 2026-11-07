---
tags: [app-feedback]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

We're about to send our Expo app (expo-router, TypeScript) to about 15 beta testers on TestFlight and I want them to be able to report problems from whatever screen they're on without leaving the app. Backend is Fastify + Prisma on Postgres, single tenant, files already go to S3 through a presign endpoint at POST /api/files/presign. Please add the whole thing: a small feedback button on every screen that grabs a screenshot, lets them pick problem/suggestion/idea, rate the screen and write a note, plus the API and table to store it, and a simple way for me to read what came in. Write the code into this project.
