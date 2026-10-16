---
name: next
description: Pick the most relevant open GitHub issue to work on next, explain why, and on confirmation create its conventional branch from main.
---

# /next

Choose the most relevant next task from GitHub issues. Do not simply take the first or oldest issue.

## 1. Gather

```powershell
gh issue list --state open --limit 200 --json number,title,labels,milestone,body,assignees
gh pr list --state open --json number,headRefName,body
git branch --list
```

## 2. Filter out
- issues with an open dependency ("Depends on" lists an open issue) or labeled `status:blocked`;
- issues already in progress: there is an open PR that references them, or a local branch name contains `issue-<number>`;
- issues assigned to someone other than the current user (`gh api user --jq .login`).

## 3. Rank the remaining issues in this order
1. **`type:bug` with `priority:high`**: broken behavior goes first.
2. **Earliest milestone** (Phase 0 before Phase 1, …): the roadmap order is binding.
3. **Unblocking power:** how many open issues list this one under "Depends on", directly or transitively.
4. **Risk reduction:** `type:spike` and items tied to `DESIGN.md` §12 open items (read only that section file, `docs/design/12-open-items.md`).
5. **Priority label:** high > medium > low.
6. **Lowest issue number** as the final tie-breaker.

## 4. Present
- The recommended issue (number, title, milestone, labels) and 2–3 lines on **why** it ranks first, citing the criteria above.
- The next two alternatives with a one-line reason each.
- The agent that should implement it, from the workflow in `CLAUDE.md`.

Ask the user to confirm before doing anything else.

## 5. On confirmation

```powershell
git switch main
git pull --ff-only
git switch -c <type>/issue-<number>-<short-slug>
gh issue edit <number> --add-assignee "@me"
```

`<type>` follows Conventional Branch: `feature`, `bugfix`, `hotfix`, `chore` (spikes and docs use `chore`). The slug is 2–5 lowercase words with hyphens, taken from the title.

If the issue changes behavior, the file format or the public API, start with the `architect` agent. Otherwise start with the implementing agent.
