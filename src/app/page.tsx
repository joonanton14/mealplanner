"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Ingredient = { name: string; qty: number; unit: string };
type Recipe = { id: string; name: string; ingredients: Ingredient[]; notes?: string };
type PickedMeal = { recipeId: string; name: string };

type AppState = {
  recipes: Recipe[];
  pantryText: string;
  picked: PickedMeal[];
  hiddenShoppingKeys: string[];
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
  const [extraItems, setExtraItems] = useState<string[]>([""]);
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

  const extraRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [extraToast, setExtraToast] = useState<string | null>(null);

  function showExtraToast(msg: string) {
    setExtraToast(msg);
    window.setTimeout(() => setExtraToast(null), 1000);
  }

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

  useEffect(() => {
  if (!state) return;

  const joined = extraItems
    .map((x) => x.trim())
    .filter(Boolean)
    .join("\n");

  if (state.pantryText === joined) return;
  setState({ ...state, pantryText: joined });

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [extraItems]);


  const pantry = useMemo(() => {
    const t = state?.pantryText ?? "";
    return t.split("\n").map((s) => s.trim()).filter(Boolean);
  }, [state?.pantryText]);

const shoppingList = useMemo(() => {
  if (!state) return [];

  const base = groupShoppingList(state.recipes, state.picked, pantry);

  // IMPORTANT: extraItems always ends with one empty row -> filter it out
  const extras = extraItems.map((x) => x.trim()).filter(Boolean);

  return mergeExtrasIntoShoppingList(base, extras);
}, [state, pantry, extraItems]);


  const hiddenSet = useMemo(
  () => new Set((state?.hiddenShoppingKeys ?? []).map((s) => s)),
  [state?.hiddenShoppingKeys]
  );

  const visibleShoppingList = useMemo(() => {
  return shoppingList.filter((it) => !hiddenSet.has(`${normalizeName(it.name)}|||${it.unit}`));
  }, [shoppingList, hiddenSet]);
  
  const combinedShoppingList = useMemo(() => {
  // Start from recipe shopping list
  const map = new Map<string, { name: string; unit: string; qty: number }>();
  for (const it of shoppingList) {
    map.set(`${normalizeName(it.name)}|||${it.unit}`, { ...it });
  }

  // Add extras as qty=1, unit=""
  for (const raw of extraItems) {
    const name = raw.trim();
    if (!name) continue;
    const key = `${normalizeName(name)}|||`;
    const existing = map.get(key);
    if (existing) existing.qty += 1;
    else map.set(key, { name, unit: "", qty: 1 });
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}, [shoppingList, extraItems]);

function hideShoppingItem(name: string, unit: string) {
  if (!state) return;

  const key = `${normalizeName(name)}|||${unit}`;
  const current = state.hiddenShoppingKeys ?? [];

  if (current.includes(key)) return;

  setState({
    ...state,
    hiddenShoppingKeys: [...current, key],
  });
}

function mergeExtrasIntoShoppingList(
  base: Array<{ name: string; unit: string; qty: number }>,
  extras: string[]
) {
  const map = new Map<string, { name: string; unit: string; qty: number }>();

  for (const it of base) {
    map.set(`${normalizeName(it.name)}|||${it.unit}`, { ...it });
  }

  for (const raw of extras) {
    const name = raw.trim();
    if (!name) continue;

    // extras have no unit; qty = 1 by default
    const key = `${normalizeName(name)}|||`;
    const existing = map.get(key);
    if (existing) existing.qty += 1;
    else map.set(key, { name, unit: "", qty: 1 });
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function restoreShoppingList() {
  if (!state) return;
  setState({ ...state, hiddenShoppingKeys: [] });
}

function addExtraItemRow() {
  setExtraItems((prev) => [...prev, ""]);
  showExtraToast("Lisätty ✓");

  // focus the newly created input on next paint
  requestAnimationFrame(() => {
    const nextIndex = extraItems.length; // current length becomes new last index
    extraRefs.current[nextIndex]?.focus();
  });
}

function updateExtraItemRow(index: number, value: string) {
  setExtraItems((prev) => prev.map((x, i) => (i === index ? value : x)));
}

function removeExtraItemRow(index: number) {
  setExtraItems((prev) => {
    const next = prev.filter((_, i) => i !== index);

    if (next.length === 0) return [""]; // keep one empty row
    if (next[next.length - 1].trim() !== "") next.push("");
    return next;
  });

  showExtraToast("Poistettu ✕");
}


  function addIngredientRow() {
    setDraftIngredients((prev) => [...prev, { name: "", qty: 0, unit: "" }]);
  }

  function updateIngredientRow(index: number, patch: Partial<Ingredient>) {
    setDraftIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)));
  }

 function removeIngredientRow(index: number) {
  setDraftIngredients((prev) => {
    const next = prev.filter((_, i) => i !== index);
    return next.length === 0 ? [{ name: "", qty: 0, unit: "" }] : next;
  });
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
    setDraftIngredients([{ name: "", qty: 0, unit: "" }]);
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

  // ✅ after successful login, load synced state
  const s = await loadState();
  setState(s);
  setAuthed(true);
  hasLoaded.current = true;

  // ✅ convert pantryText (stored string) -> extraItems rows (+ one empty row)
  const parsed = (s.pantryText ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  setExtraItems([...parsed, ""]);

  setPassword("");
}


async function logout() {
  await fetch("/api/logout", { method: "POST" });
  setAuthed(false);
  setState(null);
  setExtraItems([""]); // ✅ reset
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
        <p className="opacity-80">Syötä salasana</p>

        <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
          <label className="text-sm font-medium">Salasana</label>
          <input
            className="w-full rounded-xl border p-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => (e.key === "Enter" ? login() : null)}
          />
          <button onClick={login} className="w-full rounded-xl bg-black text-white px-4 py-2">
            Kirjaudu
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

{extraToast && (
  <div className="fixed left-1/2 top-4 -translate-x-1/2 z-50">
    <div className="rounded-full border bg-white px-4 py-2 shadow-sm text-sm animate-pulse">
      {extraToast}
    </div>
  </div>
)}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
          <h2 className="text-xl font-semibold">Lisää resepti:</h2>

          <div className="space-y-1">
            <label className="text-sm font-medium">Reseptin nimi:</label>
            <input
              className="w-full rounded-xl border p-2"
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
              placeholder="Esim makaronilaatikko..."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Ainesosat:</label>
              <button
                type="button"
                onClick={addIngredientRow}
                className="rounded-lg border px-2 py-1 text-sm hover:bg-black hover:text-white transition"
              >
                + lisää ainesosa
              </button>
            </div>

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
        placeholder="yksikkö"
        value={ing.unit}
        onChange={(e) => updateIngredientRow(idx, { unit: e.target.value })}
      />

      <button
        type="button"
        onClick={() => removeIngredientRow(idx)}
        className="col-span-1 text-sm underline opacity-70 hover:opacity-100"
        title="Poista"
      >
        ✕
      </button>
    </div>
  ))}
</div>


          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Ohje:</label>
<textarea
  className="w-full rounded-xl border p-2 min-h-[140px] resize-y whitespace-pre-wrap break-words"
  value={notes}
  onChange={(e) => setNotes(e.target.value)}
  placeholder="Ohjeet valmistukseen..."
  rows={6}
/>
          </div>

          <button onClick={addRecipe} className="w-full rounded-xl bg-black text-white px-4 py-2">
            Lisää resepti
          </button>

          {formError && <p className="text-red-600 text-sm">{formError}</p>}
        </div>

        <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
  <div className="flex items-center justify-between">
    <h2 className="text-xl font-semibold">Ostoslista</h2>
  </div>

  <p className="text-sm opacity-80">Lisää tähän muut ostettavat.</p>

  <div className="space-y-2">
    {extraItems.map((val, idx) => (
      <div key={idx} className="grid grid-cols-12 gap-2 items-center">
        <input
  ref={(el) => {
    extraRefs.current[idx] = el;
  }}
  className="col-span-11 rounded-xl border p-2"
  placeholder="esim. kahvi, wc-paperi..."
  value={val}
  onChange={(e) => updateExtraItemRow(idx, e.target.value)}
  onKeyDown={(e) => {
    if (e.key === "Enter") {
      e.preventDefault();

      // Only add if current row has something
      if (val.trim().length === 0) return;

      setExtraItems((prev) => {
        const next = [...prev];
        next.push("");
        return next;
      });

      showExtraToast("Lisätty ✓");

      requestAnimationFrame(() => {
        extraRefs.current[idx + 1]?.focus();
      });
    }
  }}
/>
        <button
          type="button"
          onClick={() => removeExtraItemRow(idx)}
          className="col-span-1 text-sm underline opacity-70 hover:opacity-100"
          title="Poista"
        >
          ✕
        </button>
      </div>
    ))}
  </div>
</div>
      </section>

      <section className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-4">
<div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-2 sm:justify-end">
  {[1, 2, 3, 4, 5].map((n) => (
    <button
      key={n}
      onClick={() => randomPick(n)}
      className="rounded-xl border hover:bg-black hover:text-white transition
                 px-2 py-2 text-sm sm:px-3 sm:py-2 sm:text-base"
    >
      Valitse {n}
    </button>
  ))}

  <button
    onClick={() => setState({ ...state, picked: [] })}
    className="rounded-xl border hover:bg-black hover:text-white transition
               px-2 py-2 text-sm sm:px-3 sm:py-2 sm:text-base"
  >
    Tyhjennä
  </button>
</div>

        {state.picked.length === 0 ? (
          <p className="opacity-70">Ei valittuja ruokia.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border p-3">
              <h3 className="font-semibold mb-2">Valitut ruoat.</h3>
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
                      Poista
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border p-3">
              <h3 className="font-semibold mb-2">Kauppalista</h3>

<div className="flex justify-end">
  <button
    onClick={restoreShoppingList}
    className="text-sm underline opacity-70 hover:opacity-100"
    type="button"
  >
    Palauta kaikki
  </button>
</div>

{visibleShoppingList.length === 0 ? (
  <p className="opacity-70">Ei ostettavaa (tai kaikki poistettu listalta).</p>
) : (
  <ul className="space-y-2">
    {visibleShoppingList.map((it) => (
      <li key={`${it.name}-${it.unit}`} className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate">{it.name}</div>
          <span className="shrink-0 opacity-80">
  {it.unit ? `${Math.round(it.qty * 100) / 100} ${it.unit}` : (it.qty > 1 ? `x${it.qty}` : "")}
</span>

        </div>

        <button
          type="button"
          onClick={() => hideShoppingItem(it.name, it.unit)}
          className="rounded-lg border px-2 py-1 text-sm hover:bg-black hover:text-white transition"
        >
          Poista
        </button>
      </li>
    ))}
  </ul>
)}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
        <h2 className="text-xl font-semibold">Reseptit ({state.recipes.length})</h2>
        {state.recipes.length === 0 ? (
          <p className="opacity-70">Lisää ensimmäinen resepti yllä.</p>
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
                    Poista
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
