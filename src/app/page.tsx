"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Ingredient = { name: string; qty: number; unit: string };
type Recipe = { id: string; name: string; ingredients: Ingredient[]; notes?: string };
type PickedMeal = { recipeId: string; name: string };

type AppState = {
  recipes: Recipe[];
  pantryText: string;
  picked: PickedMeal[];
};

function normalizeName(s: string) {
  return s.trim().toLowerCase();
}

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function groupShoppingList(recipes: Recipe[], picked: PickedMeal[], pantry: string[]) {
  const pantrySet = new Set(pantry.map(normalizeName).filter(Boolean));
  const map = new Map<string, { name: string; unit: string; qty: number }>();

  for (const pm of picked) {
    const r = recipes.find((x) => x.id === pm.recipeId);
    if (!r) continue;

    for (const ing of r.ingredients) {
      const nameNorm = normalizeName(ing.name);
      if (!nameNorm) continue;
      if (pantrySet.has(nameNorm)) continue;

      const unitNorm = ing.unit.trim();
      const key = `${nameNorm}|||${unitNorm}`;

      const existing = map.get(key);
      if (existing) existing.qty += ing.qty;
      else map.set(key, { name: ing.name.trim(), unit: unitNorm, qty: ing.qty });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function loadState(): Promise<AppState> {
  const res = await fetch("/api/state", { cache: "no-store" });
  if (res.status === 401) throw new Error("UNAUTH");
  if (!res.ok) throw new Error("Failed to load");
  return res.json();
}

async function saveState(state: AppState) {
  const res = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  if (res.status === 401) throw new Error("UNAUTH");
  if (!res.ok) throw new Error("Failed to save");
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [state, setState] = useState<AppState | null>(null);

  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  // new recipe form
  const [recipeName, setRecipeName] = useState("");
  const [ingredientsText, setIngredientsText] = useState("onion, 1, pcs\nrice, 200, g");
  const [notes, setNotes] = useState("");

  const hasLoaded = useRef(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await loadState();
        setState(s);
        setAuthed(true);
        hasLoaded.current = true;
      } catch (e: any) {
        if (e?.message === "UNAUTH") setAuthed(false);
        else {
          setAuthed(false);
          setAuthError("Could not load data.");
        }
      }
    })();
  }, []);

  // Debounced save
  useEffect(() => {
    if (!state) return;
    if (!hasLoaded.current) return;

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveState(state).catch((e) => {
        if (e?.message === "UNAUTH") setAuthed(false);
      });
    }, 400);

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [state]);

  const pantry = useMemo(() => {
    const t = state?.pantryText ?? "";
    return t.split("\n").map((s) => s.trim()).filter(Boolean);
  }, [state?.pantryText]);

  const shoppingList = useMemo(() => {
    if (!state) return [];
    return groupShoppingList(state.recipes, state.picked, pantry);
  }, [state, pantry]);

  function parseIngredients(text: string): Ingredient[] {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const ings: Ingredient[] = [];
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length < 3) continue;
      const name = parts[0];
      const qty = Number(parts[1]);
      const unit = parts[2];
      if (!name || !Number.isFinite(qty) || !unit) continue;
      ings.push({ name, qty, unit });
    }
    return ings;
  }

  function addRecipe() {
    if (!state) return;
    const name = recipeName.trim();
    if (!name) return;
    const ingredients = parseIngredients(ingredientsText);
    if (ingredients.length === 0) return;

    const r: Recipe = { id: uid(), name, ingredients, notes: notes.trim() || undefined };
    setState({ ...state, recipes: [r, ...state.recipes] });

    setRecipeName("");
    setIngredientsText("ingredient, 1, pcs");
    setNotes("");
  }

  function removeRecipe(id: string) {
    if (!state) return;
    setState({
      ...state,
      recipes: state.recipes.filter((r) => r.id !== id),
      picked: state.picked.filter((p) => p.recipeId !== id),
    });
  }

  function randomPick(n: number) {
    if (!state) return;
    if (state.recipes.length === 0) return;
    const count = Math.max(1, Math.min(n, state.recipes.length));
    const chosen = shuffle(state.recipes).slice(0, count).map((r) => ({ recipeId: r.id, name: r.name }));
    setState({ ...state, picked: chosen });
  }

  async function login() {
    setAuthError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAuthError(data?.error ?? "Login failed");
      return;
    }
    const s = await loadState();
    setState(s);
    setAuthed(true);
    hasLoaded.current = true;
    setPassword("");
  }

  // UI states
  if (authed === null) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-bold">MealPlanner</h1>
        <p className="opacity-70 mt-2">Loading…</p>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="mx-auto max-w-xl p-6 space-y-4">
        <h1 className="text-3xl font-bold">MealPlanner</h1>
        <p className="opacity-80">Enter the shared password.</p>

        <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
          <label className="text-sm font-medium">Password</label>
          <input
            className="w-full rounded-xl border p-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => (e.key === "Enter" ? login() : null)}
          />
          <button onClick={login} className="w-full rounded-xl bg-black text-white px-4 py-2">
            Login
          </button>
          {authError && <p className="text-red-600">{authError}</p>}
        </div>
      </main>
    );
  }

  if (!state) return null;

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">MealPlanner</h1>
        <p className="opacity-80">Synced across devices via KV.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
          <h2 className="text-xl font-semibold">Add a recipe</h2>
          <input
            className="w-full rounded-xl border p-2"
            value={recipeName}
            onChange={(e) => setRecipeName(e.target.value)}
            placeholder="Recipe name"
          />
          <div className="space-y-1">
            <p className="text-xs opacity-70">Ingredients: name, qty, unit (one per line)</p>
            <textarea
              className="w-full rounded-xl border p-2 min-h-[140px]"
              value={ingredientsText}
              onChange={(e) => setIngredientsText(e.target.value)}
            />
          </div>
          <input
            className="w-full rounded-xl border p-2"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
          />
          <button onClick={addRecipe} className="w-full rounded-xl bg-black text-white px-4 py-2">
            Add recipe
          </button>
        </div>

        <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
          <h2 className="text-xl font-semibold">Pantry</h2>
          <textarea
            className="w-full rounded-xl border p-2 min-h-[240px]"
            value={state.pantryText}
            onChange={(e) => setState({ ...state, pantryText: e.target.value })}
          />
        </div>
      </section>

      <section className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <h2 className="text-xl font-semibold">Random pick</h2>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => randomPick(n)}
                className="rounded-xl border px-3 py-2 hover:bg-black hover:text-white transition"
              >
                Pick {n}
              </button>
            ))}
            <button
              onClick={() => setState({ ...state, picked: [] })}
              className="rounded-xl border px-3 py-2 hover:bg-black hover:text-white transition"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border p-3">
            <h3 className="font-semibold mb-2">Picked meals</h3>
            {state.picked.length === 0 ? (
              <p className="opacity-70">None yet.</p>
            ) : (
              <ul className="space-y-2">
                {state.picked.map((m) => (
                  <li key={m.recipeId} className="flex justify-between gap-3">
                    <span>{m.name}</span>
                    <button
                      className="text-sm underline opacity-70 hover:opacity-100"
                      onClick={() =>
                        setState({ ...state, picked: state.picked.filter((p) => p.recipeId !== m.recipeId) })
                      }
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border p-3">
            <h3 className="font-semibold mb-2">Shopping list</h3>
            {shoppingList.length === 0 ? (
              <p className="opacity-70">Nothing to buy.</p>
            ) : (
              <ul className="space-y-2">
                {shoppingList.map((it) => (
                  <li key={`${it.name}-${it.unit}`} className="flex justify-between gap-4">
                    <span className="truncate">{it.name}</span>
                    <span className="shrink-0 opacity-80">
                      {Math.round(it.qty * 100) / 100} {it.unit}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
        <h2 className="text-xl font-semibold">Your recipes ({state.recipes.length})</h2>
        {state.recipes.length === 0 ? (
          <p className="opacity-70">Add your first recipe above.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {state.recipes.map((r) => (
              <div key={r.id} className="rounded-2xl border p-3 space-y-2">
                <div className="flex justify-between gap-2">
                  <div className="font-semibold">{r.name}</div>
                  <button onClick={() => removeRecipe(r.id)} className="text-sm underline opacity-70 hover:opacity-100">
                    delete
                  </button>
                </div>
                {r.notes && <p className="text-sm opacity-80">{r.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
