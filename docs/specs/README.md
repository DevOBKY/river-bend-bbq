# Specs

A spec says what a change must do, precisely enough that a person or an agent can build it and a
reviewer can check it. Number them in order (`001-...`, `002-...`) and keep them after the work is
done: they're the record of why the code is the way it is.

## Template

```markdown
# NNN: Title

Status: draft | ready | done

## Problem
Who has the problem, and what it costs them today. One paragraph.

## Change
What we'll build, in a few sentences. Name the endpoint, page, or command.

## Acceptance criteria
Numbered, each one testable. Each becomes at least one test.
1. ...

## Out of scope
What this change must not do, even if it's tempting.

## Notes for whoever builds it
Existing code to reuse, files to touch, rules to keep. Anything a newcomer to the codebase would
get wrong.

## Done when
The commands that must pass, and anything to check by hand.
```
