---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

When available, use the `ask_user_question` tool for each question so the user can answer interactively. Provide your recommended answer as the first option and append "(Recommended)" to its label. If the tool is unavailable, ask the question normally in chat.

If a question can be answered by exploring the codebase, explore the codebase instead.
