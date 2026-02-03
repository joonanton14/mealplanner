"use client";

import { useEffect, useMemo, useState } from "react";

type Ingredient = {
  name: string;
  qty: number;
  unit: string; // g, ml, pcs, etc
};

type Recipe = {
  id: string;
  name: string;
  ingredients: Ingredient[];
  notes?: string;
};

type PickedMeal = {
  recipeId: string;
  name: string;
};

const STORAGE_KEY = "mealplanner.v1";

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

  // key = name|unit
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

  const items = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

export default function Home() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [picked, setPicked] = useState<PickedMeal[]>([]);
  const [pantryText, setPantryText] = useState("salt\npepper\nolive oil");
  const pantry = useMemo(
    () => pantryText.split("\n").map((s) => s.trim()).filter(Boolean),
    [pantryText]
  );

  // New recipe form state
  const [recipeName, setRecipeName] = useState("");
  const [ingredientsText, setIngredientsText] = useState(
    "chicken breast, 400, g\nrice, 200, g\nonion, 1, pcs"
  );
  const [notes, setNotes] = useState("");

  // Load/save to localStorage
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      const data = JSON.parse(raw) as { recipes: Recipe[]; pantryText: string; picked: PickedMeal[] };
      if (Array.isArray(data.recipes)) setRecipes(data.recipes);
      if (typeof data.pantryText === "string") setPantryText(data.pantryText);
      if (Array.isArray(data.picked)) setPicked(data.picked);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const data = { recipes, pantryText, picked };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [recipes, pantryText, picked]);

  const shoppingList = useMemo(
    () => groupShoppingList(recipes, picked, pantry),
    [recipes, picked, pantry]
  );

  function parseIngredients(text: string): Ingredient[] {
    // format: name, qty, unit (one ingredient per line)
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
    const name = recipeName.trim();
    if (!name) return;

    const ingredients = parseIngredients(ingredientsText);
    if (ingredients.length === 0) return;

    const r: Recipe = {
      id: uid(),
      name,
      ingredients,
      notes: notes.trim() || undefined,
    };

    setRecipes((prev) => [r, ...prev]);
    setRecipeName("");
    setNotes("");
    setIngredientsText("ingredient, 1, pcs");
  }

  function removeRecipe(id: string) {
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    setPicked((prev) => prev.filter((p) => p.recipeId !== id));
  }

  function randomPick(n: number) {
    if (recipes.length === 0) return;
    const count = Math.max(1, Math.min(n, recipes.length));
    const chosen = shuffle(recipes).slice(0, count).map((r) => ({ recipeId: r.id, name: r.name }));
    setPicked(chosen);
  }

  function clearPicked() {
    setPicked([]);
  }

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">MealPlanner</h1>
        <p className="opacity-80">Add your recipes, pick 1–5 randomly, and get a shopping list.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
          <h2 className="text-xl font-semibold">Add a recipe</h2>

          <div className="space-y-1">
            <label className="text-sm font-medium">Recipe name</label>
            <input
              className="w-full rounded-xl border p-2"
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
              placeholder="e.g. Chicken rice bowl"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Ingredients (one per line)</label>
            <p className="text-xs opacity-70">Format: name, qty, unit</p>
            <textarea
              className="w-full rounded-xl border p-2 min-h-[140px]"
              value={ingredientsText}
              onChange={(e) => setIngredientsText(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Notes (optional)</label>
            <input
              className="w-full rounded-xl border p-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any quick notes (sauce, cook time, etc.)"
            />
          </div>

          <button
            onClick={addRecipe}
            className="w-full rounded-xl bg-black text-white px-4 py-2"
          >
            Add recipe
          </button>

          <p className="text-xs opacity-70">
            Tip: Use consistent units (g, ml, pcs) so shopping totals add up nicely.
          </p>
        </div>

        <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
          <h2 className="text-xl font-semibold">Pantry</h2>
          <p className="text-sm opacity-80">
            Items you already have. These will be excluded from the shopping list.
          </p>
          <textarea
            className="w-full rounded-xl border p-2 min-h-[240px]"
            value={pantryText}
            onChange={(e) => setPantryText(e.target.value)}
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
              onClick={clearPicked}
              className="rounded-xl border px-3 py-2 hover:bg-black hover:text-white transition"
            >
              Clear
            </button>
          </div>
        </div>

        {picked.length === 0 ? (
          <p className="opacity-70">No meals picked yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border p-3">
              <h3 className="font-semibold mb-2">Picked meals</h3>
              <ul className="space-y-2">
                {picked.map((m) => (
                  <li key={m.recipeId} className="flex items-center justify-between gap-2">
                    <span>{m.name}</span>
                    <button
                      className="text-sm underline opacity-70 hover:opacity-100"
                      onClick={() => setPicked((prev) => prev.filter((p) => p.recipeId !== m.recipeId))}
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
        <h2 className="text-xl font-semibold">Your recipes ({recipes.length})</h2>
        {recipes.length === 0 ? (
          <p className="opacity-70">Add your first recipe above.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {recipes.map((r) => (
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
        Saved locally in your browser (localStorage). Later we can add a shared database so your fiancé sees the same recipes.
      </footer>
    </main>
  );
}
