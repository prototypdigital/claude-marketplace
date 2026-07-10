---
name: react-patterns
description: Apply React composition, co-location, hook extraction, and state-placement patterns when writing or reviewing components, hooks, or state. Fixes prop drilling and logic tangled in JSX.
profiles:
  - frontend
  - fullstack
---

# react-patterns

Use this skill when implementing or reviewing React components, hooks, or state management.

## Triggers

- New React component or hook implementation
- A component exceeds 150 lines or renders more than one logical section
- A prop is passed through more than two layers without being used in the middle
- Business logic or side-effects are mixed into JSX render functions
- A custom hook is being written — check whether it already exists first

## Protocol

### Step 1 — Check for existing abstractions

```bash
grep -r "^export.*function use" src/hooks/ src/components/
```

If a hook already covers the needed concern, use it. Do not duplicate.

### Step 2 — Diagnose prop-drilling

Count how many layers a prop travels before reaching the consumer:

```text
1 layer  → fine
2 layers → acceptable if the middle component uses it
3+ layers, middle component does NOT use the prop:
  → lift to Context OR move the child closer to the data source

BAD:
  <Page user={user}>         // Page ignores user
    <Layout user={user}>     // Layout ignores user
      <Header user={user} /> // Header finally uses it

GOOD (Context):
  const UserContext = createContext<User | null>(null)
  // In Page:   <UserContext.Provider value={user}>
  // In Header: const user = useContext(UserContext)

GOOD (co-location):
  // Move <Header /> into the component that already owns `user`
```

### Step 3 — Decide: split component or extract hook

```text
Component >150 lines OR renders >1 logical section?
  YES → Split into smaller components. Each gets its own file if it accepts props.

Component contains non-trivial side effects or derived state?
  YES → Extract into a custom hook.
        Name: use<Domain><Action>  (useUserProfile, useCartTotal)
        Return: named object { field, action } — not a tuple unless order is semantic

Extracted logic has no JSX dependency?
  YES → Plain utility function, not a hook.
```

```javascript
// BAD: fetch logic and render tangled together
function OrderList() {
  const [orders, setOrders] = useState([])
  useEffect(() => {
    fetch('/api/orders').then(r => r.json()).then(setOrders)
  }, [])
  const total = orders.reduce((s, o) => s + o.amount, 0)
  return <ul>{orders.map(o => <li key={o.id}>{o.name}</li>)}</ul>
}

// GOOD: logic in a hook, component is pure render
function useOrders() {
  const [orders, setOrders] = useState([])
  useEffect(() => {
    fetch('/api/orders').then(r => r.json()).then(setOrders)
  }, [])
  return { orders, total: orders.reduce((s, o) => s + o.amount, 0) }
}

function OrderList() {
  const { orders } = useOrders()
  return <ul>{orders.map(o => <li key={o.id}>{o.name}</li>)}</ul>
}
```

### Step 4 — Place state at the right level

```text
State used by only one component?
  YES → Keep local (useState / useReducer inside that component)

State used by two sibling components?
  YES → Lift to the nearest common ancestor

State used across many distant components?
  YES → Context (read-only or rarely-written)
        OR a state library (frequently-updated, performance-sensitive)

Never: put state into global store because "we might need it later."
```

### Step 5 — Use project design-system components

Before writing layout primitives (Box, Stack, Grid, Button), check the shared component library. Reimplementing primitives creates visual and behavioral drift.

## Completion checklist

- [ ] Searched for existing hooks before writing a new one
- [ ] Prop chains >2 layers resolved with Context or co-location
- [ ] Business logic and side effects extracted into hooks, not in render functions
- [ ] State placed at the lowest level that satisfies all consumers
- [ ] No layout primitives reimplemented when design-system equivalents exist

## When NOT to use

- Server components or non-React rendering contexts
- Trivial presentational components with no logic
- Generated or third-party component wrappers
