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

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

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

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [state, setState] = useState<AppState | null>(null);

  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  // New recipe form state (no defaults)
  const [recipeName, setRecipeName] = useState("");
  const [notes, setNotes] = useState("");
  const [draftIngredients, setDraftIngredients] = useState<Ingredient[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // avoid saving immediately after first load
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

  // Debounced save to KV whenever state changes
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

  function addIngredientRow() {
    setDraftIngredients((prev) => [...prev, { name: "", qty: 0, unit: "" }]);
  }

  function updateIngredientRow(index: number, patch: Partial<Ingredient>) {
    setDraftIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)));
  }

  function removeIngredientRow(index: number) {
    setDraftIngredients((prev) => prev.filter((_, i) => i !== index));
  }

  function addRecipe() {
    if (!state) return;
    setFormError(null);

    const name = recipeName.trim();
    if (!name) {
      setFormError("Recipe name is required.");
      return;
    }

    const ingredients = draftIngredients
      .map((i) => ({
        name: i.name.trim(),
        qty: Number(i.qty),
        unit: i.unit.trim(),
      }))
      .filter((i) => i.name && Number.isFinite(i.qty) && i.qty > 0 && i.unit);

    if (ingredients.length === 0) {
      setFormError("Add at least one ingredient (name, qty > 0, unit).");
      return;
    }

    const r: Recipe = {
      id: uid(),
      name,
      ingredients,
      notes: notes.trim() || undefined,
    };

    setState({ ...state, recipes: [r, ...state.recipes] });

    // reset form: no defaults
    setRecipeName("");
    setNotes("");
    setDraftIngredients([]);
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

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    setAuthed(false);
    setState(null);
    hasLoaded.current = false;
  }

  // ---- UI states ----
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
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">MealPlanner</h1>
        </div>
        <button
          onClick={logout}
          className="rounded-xl border px-3 py-2 hover:bg-black hover:text-white transition"
        >
          Logout
        </button>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
          <h2 className="text-xl font-semibold">Lisää resepti.</h2>

          <div className="space-y-1">
            <label className="text-sm font-medium">Reseptin nimi:</label>
            <input
              className="w-full rounded-xl border p-2"
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
              placeholder="Makaronilaatikko..."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Ainesosat</label>
              <button
                type="button"
                onClick={addIngredientRow}
                className="rounded-lg border px-2 py-1 text-sm hover:bg-black hover:text-white transition"
              >
                + lisää ainesosa
              </button>
            </div>

            {draftIngredients.length === 0 ? (
              <p className="text-sm opacity-70">Ei lisättyjä ainesosia.</p>
            ) : (
              <div className="space-y-2">
                {draftIngredients.map((ing, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      className="col-span-6 rounded-xl border p-2"
                      placeholder="Ainesosan nimi"
                      value={ing.name}
                      onChange={(e) => updateIngredientRow(idx, { name: e.target.value })}
                    />

                    <input
                      className="col-span-3 rounded-xl border p-2"
                      type="number"
                      min={0}
                      step="0.1"
                      placeholder="määrä"
                      value={ing.qty === 0 ? "" : String(ing.qty)}
                      onChange={(e) => updateIngredientRow(idx, { qty: Number(e.target.value) })}
                    />

                    <input
                      className="col-span-2 rounded-xl border p-2"
                      placeholder="määrä"
                      value={ing.unit}
                      onChange={(e) => updateIngredientRow(idx, { unit: e.target.value })}
                    />

                    <button
                      type="button"
                      onClick={() => removeIngredientRow(idx)}
                      className="col-span-1 text-sm underline opacity-70 hover:opacity-100"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Ohje</label>
            <input
              className="w-full rounded-xl border p-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Näin teet reseptin..."
            />
          </div>

          <button onClick={addRecipe} className="w-full rounded-xl bg-black text-white px-4 py-2">
            Lisää resepti
          </button>

          {formError && <p className="text-red-600 text-sm">{formError}</p>}
        </div>

        <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
          <h2 className="text-xl font-semibold">Kauppalista</h2>
          <p className="text-sm opacity-80">These items are excluded from the shopping list.</p>
          <textarea
            className="w-full rounded-xl border p-2 min-h-[240px]"
            value={state.pantryText}
            onChange={(e) => setState({ ...state, pantryText: e.target.value })}
            placeholder="One item per line"
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

        {state.picked.length === 0 ? (
          <p className="opacity-70">No meals picked yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border p-3">
              <h3 className="font-semibold mb-2">Picked meals</h3>
              <ul className="space-y-2">
                {state.picked.map((m) => (
                  <li key={m.recipeId} className="flex items-center justify-between gap-2">
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
            </div>

            <div className="rounded-2xl border p-3">
              <h3 className="font-semibold mb-2">Shopping list</h3>
              {shoppingList.length === 0 ? (
                <p className="opacity-70">Nothing to buy (or everything is in pantry).</p>
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
        )}
      </section>

      <section className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
        <h2 className="text-xl font-semibold">Your recipes ({state.recipes.length})</h2>
        {state.recipes.length === 0 ? (
          <p className="opacity-70">Add your first recipe above.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {state.recipes.map((r) => (
              <div key={r.id} className="rounded-2xl border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">{r.name}</div>
                  <button
                    onClick={() => removeRecipe(r.id)}
                    className="text-sm underline opacity-70 hover:opacity-100"
                  >
                    delete
                  </button>
                </div>

                {r.notes && <p className="text-sm opacity-80">{r.notes}</p>}

                <ul className="text-sm space-y-1">
                  {r.ingredients.map((i, idx) => (
                    <li key={idx} className="flex justify-between gap-4">
                      <span className="truncate">{i.name}</span>
                      <span className="shrink-0 opacity-80">
                        {i.qty} {i.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="text-xs opacity-60">
        Eipä tarvii ennää miettiä mitä ens viikolla syötäis. Made with ♥ by Joona.{" "}
      </footer>
    </main>
  );
}
