---
name: sub-agent-design
description: Design a multi-agent system — scope responsibilities, define typed input/output contracts, wire orchestration, add tests. Use when one agent is overloaded or work has parallelizable phases.
---

# sub-agent-design

Use this skill when breaking a complex agentic task into a coordinated set of sub-agents with defined responsibilities and communication contracts.

## Triggers

- A single agent is doing too many things (context overloads, inconsistent outputs, hard-to-test)
- A workflow has parallelizable phases with no data dependency between them
- An orchestrator needs to delegate specialized work (code review, search, synthesis) to purpose-built agents
- A new agentic feature requires planning before implementation

## Protocol

### Phase 1 — Scope the work

1. State the top-level goal in one sentence.
2. List all distinct responsibilities. Group related items.
3. Identify which responsibilities are parallelizable (no data dependency between them).
4. Draw the agent topology: who exists, what each does, who calls whom.

```text
Orchestrator: <name> — routes tasks, aggregates results, handles errors
├── Sub-agent A: <name> — <one-line responsibility>
├── Sub-agent B: <name> — <one-line responsibility> [parallel with A]
└── Sub-agent C: <name> — <one-line responsibility> [runs after A]
```

```text
BAD topology:
  Orchestrator → ReviewAgent (reads files, checks style, checks security, writes summary)
  -- One agent does retrieval + multiple synthesis passes. Context overloads; hard to test.

GOOD topology:
  Orchestrator → FileReaderAgent (retrieval only)
              → StyleAgent      (synthesis: style findings)
              → SecurityAgent   (synthesis: security findings)   [parallel with StyleAgent]
              → SummaryAgent    (aggregation: receives both outputs)
```

### Phase 2 — Define communication contracts

For each agent, document the interface before writing any code:

```text
Agent: <name>
Input:  { <field>: <type>, ... }
Output: { <field>: <type>, ... }
Preconditions: <what must be true before calling>
Postconditions: <what the caller can rely on>
Error: <what is returned/thrown on failure; retry policy>
```

Reject ambiguous types. `object` and `any` are not contracts — they hide bugs at the boundary.

```text
BAD:  Input: { data: any }
      -- The orchestrator can't validate what it sends; the agent can't validate what it receives.

GOOD: Input: { filePath: string, maxLines: number }
      Output: { lines: string[], truncated: boolean }
      Error: { code: 'file_not_found' | 'read_error'; message: string }
```

### Phase 3 — Implement

1. Write each agent as a separate file under `llm/agents/`.
2. Wire the orchestrator: call agents in topological order; run parallel agents concurrently.
3. Add a typed schema for each agent's input and output (TypeScript types or JSON Schema).
4. Handle partial failures explicitly — one sub-agent failing must not silently corrupt the final output.

### Phase 4 — Integration test

For each critical path through the agent graph:

1. Write a deterministic test fixture (fixed input, no external calls).
2. Assert the tool call sequence (which agent, in what order, with what input).
3. Assert the final output matches the postcondition.
4. Add one failure-path test: one agent returns an error — assert the orchestrator handles it correctly without crashing or returning partial results as complete.

## Anti-patterns to flag

| Anti-pattern | Fix |
|---|---|
| Agent does both retrieval and synthesis | Split into two agents |
| Shared mutable state between parallel agents | Use message passing through the orchestrator |
| Orchestrator retries indefinitely on transient errors | Add max-retry cap with exponential backoff |
| Sub-agents call each other directly | All communication goes through the orchestrator |
| Missing error contract | Every agent must define what failure looks like |

## Completion checklist

- [ ] Agent topology diagram (text or Mermaid) showing all agents and call direction
- [ ] Typed communication contracts for every agent
- [ ] Implementation files under `llm/agents/`
- [ ] Orchestrator wiring: topological order, parallel concurrency, error handling
- [ ] Integration tests for the critical path and at least one failure case

## When NOT to use

- A single, linear task with no parallelizable phases (one agent is fine)
- Orchestration that would add more coordination overhead than the parallelism saves
- Tasks where a base model with tool use is sufficient without a dedicated sub-agent per concern
