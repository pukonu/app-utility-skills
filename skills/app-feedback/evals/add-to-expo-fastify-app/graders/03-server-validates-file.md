---
type: llm
focus: trace
weight: 1
---

The submit endpoint accepts a batch of entries, takes the sender from the session rather than the body, and checks that any screenshot file id refers to a file that has finished uploading for the feedback purpose.
