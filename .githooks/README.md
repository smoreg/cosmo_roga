# Hooks

`pre-push` refuses a push that would put a broken `vuvko_works` on the remote:
formatting, oxlint, typecheck, lint and tests, in that order, failing on the
first one that does.

It also runs Git LFS's own upload step, which is **not** scoped and runs first:
the music is stored in LFS and a push has to carry its bytes whatever else it
touches. That step is skipped with a warning where `git-lfs` is not installed,
so the hook never blocks work on the other half.

The rest is **scoped to `vuvko_works`**. A push touching only `smoreg_works`, or only
the root README, runs nothing — this is a shared repository, and one person's
checks are not the other person's problem.

Hooks are not installed by cloning. Once per checkout:

```
git config core.hooksPath .githooks
```

In a genuine emergency, `SKIP_VUVKO_CHECKS=1 git push` gets past it. It prints
that it was skipped.
