"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Ingredient = { name: string; qty: number; unit: string };
type Recipe = { id: string; name: string; ingredients: Ingredient[]; notes?: string };
type PickedMeal = { recipeId: string; name: string; isDouble: boolean };

type AppState = {
  recipes: Recipe[];
  pantryText: string; // reused as "extra shopping items" (one per line)
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
    const multiplier = pm.isDouble ? 2 : 1;

    for (const ing of r.ingredients) {
      const nameNorm = normalizeName(ing.name);
      if (!nameNorm) continue;
      if (pantrySet.has(nameNorm)) continue;

      const unitNorm = ing.unit.trim();
      const key = `${nameNorm}|||${unitNorm}`;

      const existing = map.get(key);
      if (existing) existing.qty += ing.qty * multiplier;
      else map.set(key, { name: ing.name.trim(), unit: unitNorm, qty: ing.qty * multiplier });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
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

function migratePickedMeals(picked: Array<PickedMeal | { recipeId: string; name: string } | null | undefined>) {
  return (picked ?? [])
    .filter((meal): meal is PickedMeal | { recipeId: string; name: string } => !!meal)
    .map((meal) => ({
      recipeId: meal.recipeId,
      name: meal.name,
      isDouble: "isDouble" in meal ? meal.isDouble === true : false,
    }));
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

function SortableShopItem({
  id,
  name,
  amount,
  checked,
  onToggle,
}: {
  id: string;
  name: string;
  amount: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined }}
      className={`flex items-center gap-3 px-4 py-4 bg-white border-b border-gray-100 cursor-grab active:cursor-grabbing touch-none ${isDragging ? "shadow-2xl rounded-2xl" : ""
        }`}
      {...attributes}
      {...listeners}
    >
      {/* Check circle */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center cursor-pointer transition ${checked ? "border-green-500 bg-green-500 text-white" : "border-gray-300"
          }`}
      >
        {checked && (
          <svg viewBox="0 0 12 10" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1,5 4.5,9 11,1" />
          </svg>
        )}
      </div>

      {/* Name */}
      <div
        className={`flex-1 min-w-0 cursor-pointer ${checked ? "opacity-40" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <span className={`text-lg font-medium ${checked ? "line-through" : ""}`}>{name}</span>
      </div>

      {/* Amount */}
      {amount && (
        <span className={`shrink-0 text-base text-gray-500 ${checked ? "opacity-40" : ""}`}>{amount}</span>
      )}
    </li>
  );
}

function getRecipeTag(recipe: Recipe): "kana" | "liha" | "kasvis" {
  const text = recipe.ingredients.map((i) => i.name.toLowerCase()).join(" ");
  // \bkana\b matches standalone "kana" but NOT "kananmuna", "kananmaksa" etc.
  const isKana = /\bkana\b|kanafilee|kanafile|kananrinta|kanankoipi|kanansiip|kananliha|broileri/.test(text);
  const isLiha = /jauheliha|nauta\b|sika\b|porsas|lammas|\bliha\b|makkara|pekoni|läski|hirvi|kinkku/.test(text);
  // liha takes priority — a recipe with both jauheliha and kananmuna goes to liha
  if (isLiha) return "liha";
  if (isKana) return "kana";
  return "kasvis";
}

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const recipeNameInputRef = useRef<HTMLInputElement | null>(null);
  const recipeFormRef = useRef<HTMLDivElement | null>(null);
  const ingredientNameRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Shopping mode overlay
  const [shopMode, setShopMode] = useState(false);
  const [cookingRecipeId, setCookingRecipeId] = useState<string | null>(null);
  const [cookingStepIndex, setCookingStepIndex] = useState(0);
  const [checkedCookingIngredients, setCheckedCookingIngredients] = useState<Record<string, boolean>>({});
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [shopOrder, setShopOrder] = useState<string[]>([]);

  function openShopMode() {
    setCheckedKeys(new Set());
    setShopOrder(visibleShoppingList.map((it) => `${normalizeName(it.name)}|||${it.unit}`));
    setShopMode(true);
  }

  function toggleChecked(key: string) {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  function handleShopDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setShopOrder((prev) => {
        const oldIndex = prev.indexOf(active.id as string);
        const newIndex = prev.indexOf(over.id as string);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }


  // Ostoslista (muut ostettavat): edited as rows, stored into state.pantryText as lines
  const [extraItems, setExtraItems] = useState<string[]>([""]);
  const extraRefs = useRef<Array<HTMLInputElement | null>>([]);
  const extrasReady = useRef(false);

  // Auth
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  // Confirm delete UI
  const [confirmExtraDeleteIndex, setConfirmExtraDeleteIndex] = useState<number | null>(null);
  const [confirmRecipeDeleteId, setConfirmRecipeDeleteId] = useState<string | null>(null);
  const [confirmShoppingDeleteKey, setConfirmShoppingDeleteKey] = useState<string | null>(null);

  // Toast
  const [extraToast, setExtraToast] = useState<string | null>(null);
  const [extraToastType, setExtraToastType] = useState<"add" | "delete">("add");
  const toastTimer = useRef<number | null>(null);

  function showExtraToast(msg: string, type: "add" | "delete" = "add") {
    setExtraToastType(type);
    setExtraToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setExtraToast(null), 2000);
  }

  // New recipe form state
  const [recipeName, setRecipeName] = useState("");
  const [notes, setNotes] = useState("");
  const [draftIngredients, setDraftIngredients] = useState<Ingredient[]>([
    { name: "", qty: 0, unit: "" },
  ]);

  const [formError, setFormError] = useState<string | null>(null);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [recipeSearch, setRecipeSearch] = useState("");
  const [recipeFilter, setRecipeFilter] = useState<"all" | "kana" | "liha" | "kasvis">("all");

  // Paste-and-parse modal
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [parsedRecipe, setParsedRecipe] = useState<{
    name: string;
    ingredients: Ingredient[];
    notes: string;
  } | null>(null);

  function parseRecipeText(text: string) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;

    const name = lines[0];
    const ingredients: Ingredient[] = [];
    const notesLines: string[] = [];

    // Normalise Unicode fraction characters to decimals
    function toFrac(s: string): string {
      return s
        .replace(/½/g, "0.5").replace(/¼/g, "0.25").replace(/¾/g, "0.75")
        .replace(/⅓/g, "0.333").replace(/⅔/g, "0.667");
    }
    function parseNum(s: string): number {
      return parseFloat(toFrac(s).replace(",", "."));
    }

    // Does the line start with a digit or fraction character?
    function isQtyLine(s: string): boolean {
      return /^[0-9½¼¾⅓⅔]/.test(s);
    }

    // Is the line purely a quantity (number + optional known unit, no ingredient name)?
    // e.g. "300 g", "3", "½ tl", "1 prk (190 g/95 g)", "2 rkl"
    function isQtyOnlyLine(s: string): boolean {
      if (!isQtyLine(s)) return false;
      const norm = toFrac(s);
      if (/^[0-9.,]+\s*$/.test(norm)) return true;
      const m = /^[0-9.,]+\s*(g|dl|rkl|tl|kpl|pkt|prk|ps|tlk|l|kg|ruukkua|rs)\s*(.*)?$/i.exec(norm);
      if (!m) return false;
      const rest = (m[2] ?? "").trim();
      return rest === "" || rest.startsWith("(");
    }

    // Extract qty + unit from a qty-only line
    function parseQty(s: string): { qty: number; unit: string } {
      const norm = toFrac(s);
      const m = /^([0-9.,]+)\s*(g|dl|rkl|tl|kpl|pkt|prk|ps|tlk|l|kg|ruukkua|rs)?\b/i.exec(norm);
      if (!m) return { qty: 1, unit: "" };
      return { qty: parseNum(m[1]) || 1, unit: m[2] ? m[2].toLowerCase() : "" };
    }

    let inNotes = false;
    let i = 1;

    while (i < lines.length) {
      const line = lines[i];

      if (inNotes) {
        notesLines.push(line);
        i++;
        continue;
      }

      const next      = i + 1 < lines.length ? lines[i + 1] : undefined;
      const afterNext = i + 2 < lines.length ? lines[i + 2] : undefined;

      if (!isQtyLine(line)) {
        // ── Text line ────────────────────────────────────────────────────────

        // Format B: "name\nqty[\nqty duplicate]"
        if (next !== undefined && isQtyOnlyLine(next)) {
          const { qty, unit } = parseQty(next);
          ingredients.push({ name: line, qty, unit });
          // skip an identical duplicate qty line if present
          i += 2 + (afterNext === next ? 1 : 0);
          continue;
        }

        const looksLikeInstruction =
          line.endsWith(".") || line.endsWith("!") || line.endsWith("?") ||
          /^(Vaihe|Step|Ohje)\s/i.test(line) ||
          line.length > 70;

        // Format C: "name qty" — trailing bare number, e.g. "mustapippuria 1"
        const matchC = /^(.+?)\s+([0-9]+(?:[.,][0-9]+)?)$/.exec(line);
        if (matchC && !looksLikeInstruction) {
          const qty = parseNum(matchC[2]);
          ingredients.push({ name: matchC[1].trim(), qty: isNaN(qty) ? 1 : qty, unit: "" });
          i++;
          continue;
        }

        // Bullet-point ingredient: "- name"
        if (line.match(/^[-•*]/)) {
          ingredients.push({ name: line.replace(/^[-•*\s]+/, ""), qty: 1, unit: "kpl" });
          i++;
          continue;
        }

        if (looksLikeInstruction && ingredients.length > 0) {
          inNotes = true;
          notesLines.push(line);
          i++;
          continue;
        }

        // Short text with no qty following → ingredient without quantity
        if (ingredients.length > 0) {
          ingredients.push({ name: line, qty: 1, unit: "" });
        }
        i++;
        continue;
      }

      // ── Qty line ─────────────────────────────────────────────────────────

      if (!isQtyOnlyLine(line)) {
        // Has both qty and ingredient name on one line
        const norm = toFrac(line);

        // Format A: "qty unit name"
        const matchA = /^([0-9.,]+)\s*(g|dl|rkl|tl|kpl|pkt|prk|ps|tlk|l|kg)\s+(.+)$/i.exec(norm);
        if (matchA) {
          const qty = parseNum(matchA[1]);
          ingredients.push({ name: matchA[3].trim(), qty: isNaN(qty) ? 1 : qty, unit: matchA[2].toLowerCase() });
          i++;
          continue;
        }

        // Format: "qty name" without unit, e.g. "2 kananmunaa"
        const matchQN = /^([0-9.,]+)\s+(.+)$/.exec(norm);
        if (matchQN) {
          const qty = parseNum(matchQN[1]);
          ingredients.push({ name: matchQN[2].trim(), qty: isNaN(qty) ? 1 : qty, unit: "" });
          i++;
          continue;
        }
      }

      // Pure qty-only line appearing "out of context" (not consumed by Format B):
      // serving-size line at the start, or step number inside instructions.
      if (ingredients.length > 0) {
        inNotes = true;
        notesLines.push(line);
      }
      // else skip (serving info before first ingredient)
      i++;
    }

    // Strip website step-marker noise from notes ("Vaihe 2 tehty", standalone "2")
    const cleanNotes = notesLines
      .filter((l) => !/^Vaihe\s+\d/i.test(l) && !/^\d+$/.test(l))
      .join("\n");

    return {
      name,
      ingredients: ingredients.length > 0 ? ingredients : [{ name: "", qty: 0, unit: "" }],
      notes: cleanNotes,
    };
  }

  function applyParsedRecipe(recipe: typeof parsedRecipe) {
    if (!recipe) return;
    setRecipeName(recipe.name);
    setNotes(recipe.notes);
    setDraftIngredients([
      ...recipe.ingredients.map((i) => ({
        name: i.name,
        qty: i.qty,
        unit: i.unit,
      })),
      { name: "", qty: 0, unit: "" },
    ]);
    setPasteMode(false);
    setPastedText("");
    setParsedRecipe(null);
  }

  // avoid saving immediately after first load
  const hasLoaded = useRef(false);
  const saveTimer = useRef<number | null>(null);

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const s = await loadState();

        // migrate older saved state
        const migrated: AppState = {
          ...s,
          hiddenShoppingKeys: s.hiddenShoppingKeys ?? [],
          picked: migratePickedMeals(s.picked),
        };

        setState(migrated);
        setAuthed(true);
        hasLoaded.current = true;

        const parsed = (migrated.pantryText ?? "")
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);
        setExtraItems([...parsed, ""]);
        extrasReady.current = true;
      } catch (e: unknown) {
        extrasReady.current = false;
        if (e instanceof Error && e.message === "UNAUTH") setAuthed(false);
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

  // Auto-cancel confirms
  useEffect(() => {
    if (confirmExtraDeleteIndex === null) return;
    const t = window.setTimeout(() => setConfirmExtraDeleteIndex(null), 3000);
    return () => window.clearTimeout(t);
  }, [confirmExtraDeleteIndex]);

  useEffect(() => {
    if (confirmRecipeDeleteId === null) return;
    const t = window.setTimeout(() => setConfirmRecipeDeleteId(null), 3000);
    return () => window.clearTimeout(t);
  }, [confirmRecipeDeleteId]);

  // Sync extraItems -> state.pantryText (ignore last empty row)
  useEffect(() => {
    if (!state) return;
    if (!extrasReady.current) return;

    const joined = extraItems
      .map((x) => x.trim())
      .filter(Boolean)
      .join("\n");

    if (state.pantryText === joined) return;
    setState({ ...state, pantryText: joined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraItems]);

  useEffect(() => {
    if (confirmShoppingDeleteKey === null) return;
    const t = window.setTimeout(() => setConfirmShoppingDeleteKey(null), 3000);
    return () => window.clearTimeout(t);
  }, [confirmShoppingDeleteKey]);

  // Pantry list: currently same as extra list storage (kept for compatibility)
  const pantry = useMemo(() => {
    const t = state?.pantryText ?? "";
    return t.split("\n").map((s) => s.trim()).filter(Boolean);
  }, [state?.pantryText]);

  const shoppingList = useMemo(() => {
    if (!state) return [];
    const base = groupShoppingList(state.recipes, state.picked, pantry);

    // extras: filtered (last empty row removed)
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

  const pickedRecipeIds = useMemo(
    () => new Set((state?.picked ?? []).map((meal) => meal.recipeId)),
    [state?.picked]
  );

  const filteredRecipes = useMemo(() => {
    if (!state) return [];
    const q = recipeSearch.trim().toLowerCase();
    let recipes = state.recipes;

    if (q) {
      recipes = recipes.filter((r) => {
        if (r.name.toLowerCase().includes(q)) return true;
        if ((r.notes ?? "").toLowerCase().includes(q)) return true;
        return r.ingredients.some((i) => i.name.toLowerCase().includes(q));
      });
    }

    if (recipeFilter !== "all") {
      recipes = recipes.filter((r) => getRecipeTag(r) === recipeFilter);
    }

    return recipes;
  }, [state, recipeSearch, recipeFilter]);

  const cookingRecipe = useMemo(() => {
    if (!state || !cookingRecipeId) return null;
    return state.recipes.find((recipe) => recipe.id === cookingRecipeId) ?? null;
  }, [state, cookingRecipeId]);

  const cookingSteps = useMemo(() => {
    if (!cookingRecipe?.notes) return [];

    return cookingRecipe.notes
      .split(/\n+/)
      .map((step) => step.trim())
      .filter(Boolean);
  }, [cookingRecipe]);

  function openCookingMode(recipeId: string) {
    setCookingRecipeId(recipeId);
    setCookingStepIndex(0);
    setCheckedCookingIngredients({});
  }

  function closeCookingMode() {
    setCookingRecipeId(null);
    setCookingStepIndex(0);
    setCheckedCookingIngredients({});
  }

  function toggleCookingIngredient(recipeId: string, ingredientIndex: number) {
    const key = `${recipeId}:${ingredientIndex}`;
    setCheckedCookingIngredients((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

  function restoreShoppingList() {
    if (!state) return;
    setState({ ...state, hiddenShoppingKeys: [] });
    showExtraToast("Palautettu ✓");
  }

  function hideShoppingItem(name: string, unit: string) {
    if (!state) return;
    const key = `${normalizeName(name)}|||${unit}`;
    const current = state.hiddenShoppingKeys ?? [];
    if (current.includes(key)) return;
    setState({ ...state, hiddenShoppingKeys: [...current, key] });
    showExtraToast("Poistettu ✕", "delete");
  }

  function shoppingKey(name: string, unit: string) {
    return `${normalizeName(name)}|||${unit}`;
  }

  function toggleRecipePicked(recipe: Recipe) {
    if (!state) return;

    const exists = state.picked.some((meal) => meal.recipeId === recipe.id);
    if (exists) {
      setState({
        ...state,
        picked: state.picked.filter((meal) => meal.recipeId !== recipe.id),
      });
      return;
    }

    setState({
      ...state,
      picked: [...state.picked, { recipeId: recipe.id, name: recipe.name, isDouble: false }],
    });
  }

  // Extra items (row editor)
  function updateExtraItemRow(index: number, value: string) {
    setExtraItems((prev) => prev.map((x, i) => (i === index ? value : x)));
  }

  function removeExtraItemRow(index: number) {
    setExtraItems((prev) => {
      const next = prev.filter((_, i) => i !== index);

      // always keep at least one empty row
      if (next.length === 0) return [""];
      if (next[next.length - 1].trim() !== "") next.push("");
      return next;
    });
    showExtraToast("Poistettu ✕", "delete");
  }

  // Ingredients editor
  function addIngredientRow() {
    setDraftIngredients((prev) => [...prev, { name: "", qty: 0, unit: "" }]);
  }

  function updateIngredientRow(index: number, patch: Partial<Ingredient>) {
    setDraftIngredients((prev) => {
      const next = prev.map((ing, i) => (i === index ? { ...ing, ...patch } : ing));

      // While typing the ingredient name on the last row, auto-create a new empty row.
      if (
        typeof patch.name === "string" &&
        patch.name.trim() !== "" &&
        index === next.length - 1
      ) {
        next.push({ name: "", qty: 0, unit: "" });
      }

      return next;
    });
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
      setFormError("Lisää reseptin nimi.");
      return;
    }

    const duplicate = state.recipes.some((r) => normalizeName(r.name) === normalizeName(name));
    if (duplicate) {
      setFormError("Resepti tällä nimellä on jo olemassa.");
      return;
    }

    const ingredients = draftIngredients
      .map((i) => ({
        name: i.name.trim(),
        qty: Number.isFinite(i.qty) && i.qty > 0 ? Number(i.qty) : 1,
        unit: i.unit.trim(),
      }))
      .filter((i) => i.name);

    if (ingredients.length === 0) {
      setFormError("Lisää vähintään yksi ainesosa.");
      return;
    }

    const r: Recipe = {
      id: uid(),
      name,
      ingredients,
      notes: notes.trim() || undefined,
    };

    setState({ ...state, recipes: [r, ...state.recipes] });

    setRecipeName("");
    setNotes("");
    setDraftIngredients([{ name: "", qty: 0, unit: "" }]);
    showExtraToast("Lisätty ✓", "add");

  }

  function startEditRecipe(recipeId: string) {
    if (!state) return;
    const recipe = state.recipes.find((r) => r.id === recipeId);
    if (!recipe) return;

    setEditingRecipeId(recipe.id);
    setRecipeName(recipe.name);
    setNotes(recipe.notes ?? "");
    setDraftIngredients([
      ...recipe.ingredients.map((i) => ({
        name: i.name,
        qty: i.qty,
        unit: i.unit,
      })),
      { name: "", qty: 0, unit: "" },
    ]);
    setFormError(null);

    requestAnimationFrame(() => {
      recipeFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      recipeNameInputRef.current?.focus();
      recipeNameInputRef.current?.select();
    });
  }

  function cancelEditRecipe() {
    setEditingRecipeId(null);
    setRecipeName("");
    setNotes("");
    setDraftIngredients([{ name: "", qty: 0, unit: "" }]);
    setFormError(null);
  }

  function saveEditedRecipe() {
    if (!state || !editingRecipeId) return;
    setFormError(null);

    const name = recipeName.trim();
    if (!name) {
      setFormError("Lisää reseptin nimi.");
      return;
    }

    const duplicate = state.recipes.some(
      (r) => r.id !== editingRecipeId && normalizeName(r.name) === normalizeName(name)
    );
    if (duplicate) {
      setFormError("Resepti tällä nimellä on jo olemassa.");
      return;
    }

    const ingredients = draftIngredients
      .map((i) => ({
        name: i.name.trim(),
        qty: Number.isFinite(i.qty) && i.qty > 0 ? Number(i.qty) : 1,
        unit: i.unit.trim(),
      }))
      .filter((i) => i.name);

    if (ingredients.length === 0) {
      setFormError("Lisää vähintään yksi ainesosa.");
      return;
    }

    const updatedRecipes = state.recipes.map((r) =>
      r.id === editingRecipeId
        ? {
            ...r,
            name,
            ingredients,
            notes: notes.trim() || undefined,
          }
        : r
    );

    const updatedPicked = state.picked.map((p) =>
      p.recipeId === editingRecipeId ? { ...p, name } : p
    );

    setState({ ...state, recipes: updatedRecipes, picked: updatedPicked });
    cancelEditRecipe();
    showExtraToast("Tallennettu ✓", "add");
  }

  function removeRecipe(id: string) {
    if (!state) return;
    setState({
      ...state,
      recipes: state.recipes.filter((r) => r.id !== id),
      picked: state.picked.filter((p) => p.recipeId !== id),
    });

  }

  function toggleMealDoubleSize(recipeId: string) {
    if (!state) return;

    setState({
      ...state,
      picked: state.picked.map((meal) =>
        meal.recipeId === recipeId ? { ...meal, isDouble: !meal.isDouble } : meal
      ),
    });
  }

  function randomPick(n: number) {
    if (!state) return;
    if (state.recipes.length === 0) return;
    const count = Math.max(1, Math.min(n, state.recipes.length));
    const chosen = shuffle(state.recipes)
      .slice(0, count)
      .map((r) => ({ recipeId: r.id, name: r.name, isDouble: false }));
    setState({ ...state, picked: chosen, hiddenShoppingKeys: [] }); // reset hidden when re-picking
    showExtraToast(`Valittu ${count} ✓`);
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
      setAuthError(data?.error ?? "Kirjautuminen epäonnistui");
      return;
    }

    const s = await loadState();
    const migrated: AppState = {
      ...s,
      hiddenShoppingKeys: s.hiddenShoppingKeys ?? [],
      picked: migratePickedMeals(s.picked),
    };

    setState(migrated);
    setAuthed(true);
    hasLoaded.current = true;

    const parsed = (migrated.pantryText ?? "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    setExtraItems([...parsed, ""]);
    extrasReady.current = true;

    setPassword("");
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    setAuthed(false);
    setState(null);
    setExtraItems([""]);
    setConfirmExtraDeleteIndex(null);
    setConfirmRecipeDeleteId(null);
    extrasReady.current = false;
    hasLoaded.current = false;
  }

  // ---- UI states ----
  if (authed === null) {
    return (
      <main className="meal-app mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-bold">MealPlanner</h1>
        <p className="opacity-70 mt-2">Ladataan…</p>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="meal-app mx-auto max-w-xl p-6 space-y-4">
        <h1 className="text-3xl font-bold">MealPlanner</h1>
        <p className="opacity-80">Syötä salasana</p>

        <div ref={recipeFormRef} className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
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

  if (cookingRecipe) {
    const activeStep = cookingSteps[cookingStepIndex] ?? null;

    return (
      <main className="meal-app fixed inset-0 z-50 overflow-y-auto bg-stone-950 text-white">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-5 py-6">
          <header className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div className="space-y-2">
              <p className="text-sm uppercase tracking-[0.2em] text-stone-300">Cooking mode</p>
              <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{cookingRecipe.name}</h1>
              <p className="text-sm text-stone-200">
                {cookingRecipe.ingredients.length} ainesosaa
                {cookingSteps.length > 0 ? ` • vaihe ${Math.min(cookingStepIndex + 1, cookingSteps.length)}/${cookingSteps.length}` : ""}
              </p>
            </div>

            <button
              type="button"
              onClick={closeCookingMode}
              className="rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition"
            >
              Sulje
            </button>
          </header>

          <section className="rounded-3xl bg-black p-5 shadow-2xl ring-1 ring-white/20">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-white">Ainekset</h2>
              <span className="text-sm text-white">
                {cookingRecipe.ingredients.filter((_, index) => checkedCookingIngredients[`${cookingRecipe.id}:${index}`]).length}/{cookingRecipe.ingredients.length}
              </span>
            </div>

            <ul className="space-y-3">
              {cookingRecipe.ingredients.map((ingredient, index) => {
                const key = `${cookingRecipe.id}:${index}`;
                const checked = checkedCookingIngredients[key] === true;

                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => toggleCookingIngredient(cookingRecipe.id, index)}
                      className={`flex w-full items-center gap-4 rounded-2xl border px-4 py-4 text-left transition ${
                        checked
                          ? "border-emerald-300 bg-emerald-200 text-black"
                          : "border-stone-300 bg-white text-black hover:bg-stone-100"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${
                          checked ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-400 text-stone-700"
                        }`}
                      >
                        {checked ? "✓" : index + 1}
                      </span>
                      <span className="min-w-0 flex-1 text-2xl font-semibold leading-snug text-black">
                        <span className={checked ? "line-through decoration-2 text-black" : "text-black"}>{ingredient.name}</span>
                      </span>
                      <span className={`shrink-0 text-xl font-semibold ${checked ? "text-emerald-900" : "text-black"}`}>
                        {ingredient.qty} {ingredient.unit}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="flex-1 rounded-3xl bg-amber-50 p-5 text-stone-900 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Ohjeet</h2>
              {cookingSteps.length > 0 && (
                <span className="rounded-full bg-stone-900 px-3 py-1 text-sm font-medium text-white">
                  {cookingStepIndex + 1}/{cookingSteps.length}
                </span>
              )}
            </div>

            {cookingSteps.length === 0 ? (
              <p className="text-lg leading-relaxed text-stone-700">Tälle reseptille ei ole tallennettu ohjeita.</p>
            ) : (
              <div className="space-y-6">
                <div className="rounded-3xl bg-white px-5 py-6 shadow-inner">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-500">Nykyinen vaihe</p>
                  <p className="mt-4 text-3xl font-semibold leading-tight text-stone-950 sm:text-4xl">{activeStep}</p>
                </div>

              </div>
            )}
          </section>
        </div>
      </main>
    );
  }

  // ---- Shopping mode overlay ----
  if (shopMode) {
    const itemMap = new Map(
      visibleShoppingList.map((it) => [`${normalizeName(it.name)}|||${it.unit}`, it])
    );
    const orderedItems = shopOrder
      .map((k) => ({ key: k, item: itemMap.get(k) }))
      .filter((x): x is { key: string; item: NonNullable<typeof x.item> } => !!x.item);
    const doneCount = orderedItems.filter(({ key }) => checkedKeys.has(key)).length;

    return (
      <div className="shop-overlay fixed inset-0 z-50 flex flex-col bg-white overflow-hidden">
        <header className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <div className="text-xl font-bold tracking-tight">Kauppalista</div>
            <div className="text-sm text-gray-400">{doneCount}/{orderedItems.length} kerätty</div>
          </div>
          <button
            onClick={() => setShopMode(false)}
            className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-100 transition"
          >
            ✕ Sulje
          </button>
        </header>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleShopDragEnd}>
          <SortableContext items={shopOrder} strategy={verticalListSortingStrategy}>
            <ul className="flex-1 overflow-y-auto">
              {orderedItems.length === 0 && (
                <li className="px-6 py-10 text-center text-gray-400">Ei tuotteita</li>
              )}
              {orderedItems.map(({ key, item: it }) => {
                const amount = it.unit
                  ? `${Math.round(it.qty * 100) / 100} ${it.unit}`
                  : it.qty > 1
                    ? `×${it.qty}`
                    : "";
                return (
                  <SortableShopItem
                    key={key}
                    id={key}
                    name={it.name}
                    amount={amount}
                    checked={checkedKeys.has(key)}
                    onToggle={() => toggleChecked(key)}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      </div>
    );
  }

  // ---- Paste-and-parse modal ----
  if (pasteMode) {
    return (
      <div className="meal-app fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-4 p-6">
          <h2 className="text-2xl font-bold">Liitä resepti</h2>

          {!parsedRecipe ? (
            <>
              <p className="text-sm text-gray-600">
                Liitä koko resepti (nimi, ainekset ja ohjeet). Ohjelma erottaa ainekset automaattisesti.
              </p>
              <textarea
                className="w-full rounded-xl border p-3 min-h-[300px] font-mono text-sm"
                placeholder="Esim.&#10;Kanakastike&#10;450g kanafileesuikale&#10;2 dl ruokakerma&#10;2 rkl hunaja&#10;&#10;Paista suikaleet kypsäksi. Lisää kerma, hunaja ja mausta.&#10;..."
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
              />
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const parsed = parseRecipeText(pastedText);
                    if (parsed) setParsedRecipe(parsed);
                    else alert("Ei löytynyt ingredienssejä. Yritä uudelleen.");
                  }}
                  className="flex-1 rounded-xl bg-black text-white px-4 py-2 hover:opacity-80 transition"
                >
                  Jäsennä
                </button>
                <button
                  onClick={() => {
                    setPasteMode(false);
                    setPastedText("");
                  }}
                  className="flex-1 rounded-xl border px-4 py-2 hover:bg-gray-100 transition"
                >
                  Peruuta
                </button>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold">Tarkista ja muokkaa</h3>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Nimi</label>
                  <input
                    className="w-full rounded-xl border p-2 mt-1"
                    value={parsedRecipe.name}
                    onChange={(e) =>
                      setParsedRecipe({ ...parsedRecipe, name: e.target.value })
                    }
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Ainekset ({parsedRecipe.ingredients.length})</label>
                  <div className="space-y-1.5 mt-2">
                    {parsedRecipe.ingredients.map((ing, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                        <input
                          className="col-span-6 rounded-lg border p-1.5 text-sm"
                          placeholder="Ainesosan nimi"
                          value={ing.name}
                          onChange={(e) => {
                            const newIngs = [...parsedRecipe.ingredients];
                            newIngs[idx] = { ...ing, name: e.target.value };
                            setParsedRecipe({ ...parsedRecipe, ingredients: newIngs });
                          }}
                        />
                        <input
                          className="col-span-2 rounded-lg border p-1.5 text-sm"
                          type="number"
                          placeholder="Määrä"
                          step="0.1"
                          value={ing.qty === 0 ? "" : ing.qty}
                          onChange={(e) => {
                            const newIngs = [...parsedRecipe.ingredients];
                            newIngs[idx] = {
                              ...ing,
                              qty: Number(e.target.value) || 0,
                            };
                            setParsedRecipe({ ...parsedRecipe, ingredients: newIngs });
                          }}
                        />
                        <select
                          className="col-span-3 rounded-lg border p-1.5 text-sm bg-white"
                          value={ing.unit}
                          onChange={(e) => {
                            const newIngs = [...parsedRecipe.ingredients];
                            newIngs[idx] = { ...ing, unit: e.target.value };
                            setParsedRecipe({ ...parsedRecipe, ingredients: newIngs });
                          }}
                        >
                          <option value="">–</option>
                          <option value="g">g</option>
                          <option value="dl">dl</option>
                          <option value="rkl">rkl</option>
                          <option value="tl">tl</option>
                          <option value="kpl">kpl</option>
                          <option value="pkt">pkt</option>
                          <option value="prk">prk</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const newIngs = parsedRecipe.ingredients.filter(
                              (_, i) => i !== idx
                            );
                            setParsedRecipe({
                              ...parsedRecipe,
                              ingredients: newIngs,
                            });
                          }}
                          className="col-span-1 text-sm text-red-500 hover:text-red-700"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Ohjeet</label>
                  <textarea
                    className="w-full rounded-xl border p-2 mt-1 min-h-[120px] text-sm"
                    value={parsedRecipe.notes}
                    onChange={(e) =>
                      setParsedRecipe({ ...parsedRecipe, notes: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => applyParsedRecipe(parsedRecipe)}
                  className="flex-1 rounded-xl bg-black text-white px-4 py-2 hover:opacity-80 transition"
                >
                  Hyväksy & Lisää
                </button>
                <button
                  onClick={() => {
                    setParsedRecipe(null);
                    setPastedText("");
                  }}
                  className="flex-1 rounded-xl border px-4 py-2 hover:bg-gray-100 transition"
                >
                  Takaisin
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="meal-app mx-auto max-w-5xl p-6 space-y-6">
      {extraToast && (
        <div
          className="fixed right-4 z-50"
          style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
          <div
            className={[
              "min-w-[240px] rounded-2xl px-5 py-3 shadow-lg text-base font-bold text-white",
              extraToastType === "add" ? "bg-green-600" : "bg-red-600",
            ].join(" ")}
          >
            {extraToast}
          </div>
        </div>
      )}



      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">MealPlanner</h1>
        </div>
        <button onClick={logout} className="rounded-xl border px-3 py-2 hover:bg-black hover:text-white transition">
          Kirjaudu ulos
        </button>
      </header>

      {/* TWO-COLUMN TOP SECTION */}
      <section className="grid gap-4 md:grid-cols-2">
        {/* Add recipe */}
        <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
          <h2 className="text-xl font-semibold">
            {editingRecipeId ? "Muokkaa reseptiä" : "Lisää resepti"}
          </h2>

          <div className="space-y-1">
            <label className="text-sm font-medium">Reseptin nimi</label>
            <input
              ref={recipeNameInputRef}
              className="w-full rounded-xl border p-2"
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
              placeholder="Esim. makaronilaatikko..."
            />
          </div>

          <div className="space-y-2">
            <div>
              <label className="text-sm font-medium">Ainesosat</label>
            </div>

            <div className="space-y-2">
              {draftIngredients.map((ing, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    ref={(el) => {
                      ingredientNameRefs.current[idx] = el;
                    }}
                    className="col-span-6 rounded-xl border p-2"
                    placeholder="Ainesosan nimi"
                    value={ing.name}
                    onChange={(e) => updateIngredientRow(idx, { name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      if (!ing.name.trim()) return;

                      addIngredientRow();
                      requestAnimationFrame(() => ingredientNameRefs.current[idx + 1]?.focus());
                    }}
                  />


                  <input
                    className="col-span-3 rounded-xl border p-2"
                    type="number"
                    min={0}
                    step="0.1"
                    placeholder="määrä"
                    value={ing.qty === 0 ? "" : String(ing.qty)}
                    onChange={(e) => updateIngredientRow(idx, { qty: Number(e.target.value) })}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      if (!ing.name.trim()) return;

                      addIngredientRow();
                      requestAnimationFrame(() => ingredientNameRefs.current[idx + 1]?.focus());
                    }}
                  />

                  <select
                    className="unit-select col-span-2 rounded-xl border p-2 bg-white"
                    value={ing.unit}
                    onChange={(e) => updateIngredientRow(idx, { unit: e.target.value })}
                  >
                    <option value="">-</option>
                    <option value="g">g</option>
                    <option value="dl">dl</option>
                    <option value="rkl">rkl</option>
                    <option value="tl">tl</option>
                    <option value="kpl">kpl</option>
                    <option value="pkt">pkt</option>
                    <option value="prk">prk</option>
                  </select>


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
            <label className="text-sm font-medium">Ohje</label>
            <textarea
              className="w-full rounded-xl border p-2 min-h-[140px] resize-y whitespace-pre-wrap break-words"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ohjeet valmistukseen..."
              rows={6}
            />
          </div>

          {editingRecipeId ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={saveEditedRecipe} className="rounded-xl bg-black text-white px-4 py-2">
                Tallenna muutokset
              </button>
              <button
                onClick={cancelEditRecipe}
                className="rounded-xl border px-4 py-2 hover:bg-gray-100 transition"
              >
                Peruuta
              </button>
            </div>
          ) : (
            <button onClick={addRecipe} className="w-full rounded-xl bg-black text-white px-4 py-2">
              Lisää resepti
            </button>
          )}

          {!editingRecipeId && (
            <button
              onClick={() => setPasteMode(true)}
              className="w-full rounded-xl border px-4 py-2 hover:bg-gray-100 transition"
            >
              📋 Tai liitä resepti
            </button>
          )}

          {formError && <p className="text-red-600 text-sm">{formError}</p>}
        </div>

        {/* Ostoslista (extras) */}
        <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
          <h2 className="text-xl font-semibold">Ostoslista:</h2>
          <p className="text-sm opacity-80">Lisää tähän muita kauppaostoksia.</p>

          <div className="space-y-2">
            {extraItems.map((val, idx) => {
              const isLastEmpty = idx === extraItems.length - 1 && val.trim() === "";

              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    ref={(el) => {
                      extraRefs.current[idx] = el;
                    }}
                    className={`${isLastEmpty ? "col-span-12" : "col-span-11"} rounded-xl border p-2`}
                    placeholder="Kirjoita lisättävä ostos"
                    value={val}
                    onChange={(e) => updateExtraItemRow(idx, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const trimmed = val.trim();
                        if (!trimmed) return;

                        setExtraItems((prev) => {
                          const next = [...prev];
                          next[idx] = trimmed;
                          if (idx === next.length - 1) next.push("");
                          return next;
                        });

                        showExtraToast("Lisätty ✓", "add");
                        requestAnimationFrame(() => extraRefs.current[idx + 1]?.focus());
                      }
                    }}
                  />

                  {!isLastEmpty && (
                    <div className="col-span-1 flex justify-end gap-2">
                      {confirmExtraDeleteIndex === idx ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              removeExtraItemRow(idx);
                              setConfirmExtraDeleteIndex(null);
                            }}
                            className="rounded-lg bg-red-600 text-white px-2 py-1 text-xs hover:bg-red-700 transition"
                            title="Vahvista poisto"
                          >
                            Vahvista
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmExtraDeleteIndex(null)}
                            className="rounded-lg bg-red-600 text-white px-2 py-1 text-xs hover:bg-red-700 transition"
                            title="Peruuta"
                          >
                            Peruuta
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmExtraDeleteIndex(idx);
                          }}
                          className="rounded-lg bg-red-600 text-white px-2 py-1 text-xs hover:bg-red-700 transition"
                          title="Poista"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* RANDOM PICK + SHOPPING LIST */}
      <section className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-4">
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-2 sm:justify-end">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => randomPick(n)}
              className="rounded-xl border hover:bg-black hover:text-white transition px-2 py-2 text-sm sm:px-3 sm:py-2 sm:text-base"
            >
              Valitse {n}
            </button>
          ))}

          <button
            onClick={() => setState({ ...state, picked: [], hiddenShoppingKeys: [] })}
            className="rounded-xl border hover:bg-black hover:text-white transition px-2 py-2 text-sm sm:px-3 sm:py-2 sm:text-base"
          >
            Tyhjennä
          </button>
        </div>

        {state.picked.length === 0 ? (
          <p className="opacity-70">Ei valittuja ruokia.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border p-3">
              <h3 className="font-semibold mb-2">Valitut ruoat</h3>
              <ul className="space-y-2">
                {state.picked.map((m) => (
                  <li key={m.recipeId} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="break-words">{m.name}</span>
                      {m.isDouble && <span className="ml-2 rounded-full bg-black px-2 py-0.5 text-xs font-medium text-white">2x</span>}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        className={`rounded-lg border px-2 py-1 text-xs transition ${m.isDouble ? "bg-black text-white" : "hover:bg-gray-100"}`}
                        onClick={() => toggleMealDoubleSize(m.recipeId)}
                      >
                        {m.isDouble ? "Normaali" : "Tuplana"}
                      </button>
                      <button
                        className="text-sm underline opacity-70 hover:opacity-100"
                        onClick={() =>
                          setState({ ...state, picked: state.picked.filter((p) => p.recipeId !== m.recipeId) })
                        }
                      >
                        Poista
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Kauppalista</h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={restoreShoppingList}
                    className="text-sm underline opacity-70 hover:opacity-100"
                    type="button"
                  >
                    Palauta kaikki
                  </button>
                  {visibleShoppingList.length > 0 && (
                    <button
                      onClick={openShopMode}
                      className="rounded-xl bg-black text-white px-3 py-1.5 text-sm font-medium hover:opacity-80 transition"
                      type="button"
                    >
                      🛒
                    </button>
                  )}
                </div>
              </div>

              {visibleShoppingList.length === 0 ? (
                <p className="opacity-70">Ei tuotteita</p>
              ) : (
                <ul className="space-y-2">
                  {visibleShoppingList.map((it) => (
                    <li key={`${it.name}-${it.unit}`} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate">{it.name}</div>
                        <div className="text-xs opacity-70">
                          {it.unit ? `${Math.round(it.qty * 100) / 100} ${it.unit}` : it.qty > 1 ? `x${it.qty}` : ""}
                        </div>
                      </div>

                      {confirmShoppingDeleteKey === shoppingKey(it.name, it.unit) ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              hideShoppingItem(it.name, it.unit);
                              setConfirmShoppingDeleteKey(null);
                            }}
                            className="rounded-lg bg-red-600 text-white px-2 py-1 text-xs hover:bg-red-700 transition"
                          >
                            Vahvista
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmShoppingDeleteKey(null)}
                            className="rounded-lg border px-2 py-1 text-xs opacity-80 hover:opacity-100 transition"
                          >
                            Peruuta
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmShoppingDeleteKey(shoppingKey(it.name, it.unit))}
                          className="rounded-lg border px-2 py-1 text-sm opacity-80 hover:bg-black hover:text-white transition"
                        >
                          Poista
                        </button>
                      )}

                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {/* RECIPES LIST */}
      <section className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-semibold">Reseptit ({filteredRecipes.length}/{state.recipes.length})</h2>
            <input
              className="w-full sm:w-72 rounded-xl border p-2"
              value={recipeSearch}
              onChange={(e) => setRecipeSearch(e.target.value)}
              placeholder="Hae reseptejä..."
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "kana", "liha", "kasvis"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setRecipeFilter(f)}
                className={`rounded-xl border px-3 py-1.5 text-sm transition ${
                  recipeFilter === f ? "bg-black text-white border-black" : "hover:bg-gray-100"
                }`}
              >
                {f === "all" ? "Kaikki" : f === "kana" ? "🐔 Kana" : f === "liha" ? "🥩 Liha" : "🥦 Kasvis"}
              </button>
            ))}
          </div>
        </div>

        {state.recipes.length === 0 ? (
          <p className="opacity-70">Lisää ensimmäinen resepti yllä.</p>
        ) : filteredRecipes.length === 0 ? (
          <p className="opacity-70">Ei hakua vastaavia reseptejä.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filteredRecipes.map((r) => (
              <div
                key={r.id}
                className={`rounded-2xl border p-3 space-y-2 overflow-hidden ${
                  editingRecipeId === r.id ? "border-black bg-gray-50" : ""
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="font-semibold min-w-0 break-words sm:flex-1">{r.name}</div>

                  {confirmRecipeDeleteId === r.id ? (
                    <div className="flex flex-wrap justify-end gap-2 self-end sm:self-auto">
                      <button
                        type="button"
                        onClick={() => {
                          removeRecipe(r.id);
                          setConfirmRecipeDeleteId(null);
                        }}
                        title="Vahvista poisto"
                        aria-label="Vahvista poisto"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-red-600 text-white text-xs hover:bg-red-700 transition sm:h-8 sm:w-8"
                      >
                        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3,10 8,15 17,5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRecipeDeleteId(null)}
                        title="Peruuta"
                        aria-label="Peruuta"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs hover:bg-gray-100 transition sm:h-8 sm:w-8"
                      >
                        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                          <line x1="5" y1="5" x2="15" y2="15" />
                          <line x1="15" y1="5" x2="5" y2="15" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-end gap-1 self-end sm:self-auto">
                      <button
                        type="button"
                        onClick={() => toggleRecipePicked(r)}
                        title={pickedRecipeIds.has(r.id) ? "Poista valinta" : "Valitse"}
                        aria-label={pickedRecipeIds.has(r.id) ? "Poista valinta" : "Valitse"}
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs transition sm:h-8 sm:w-8 ${
                          pickedRecipeIds.has(r.id)
                            ? "bg-black text-white border-black"
                            : "hover:bg-gray-100"
                        }`}
                      >
                        {pickedRecipeIds.has(r.id) ? (
                          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3,10 8,15 17,5" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="10" y1="4" x2="10" y2="16" />
                            <line x1="4" y1="10" x2="16" y2="10" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => openCookingMode(r.id)}
                        title="Kokkaa"
                        aria-label="Kokkaa"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs hover:bg-gray-100 transition sm:h-8 sm:w-8"
                      >
                        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 9h8" />
                          <path d="M4 9h1" />
                          <path d="M15 9h1a2 2 0 0 1 0 4h-1" />
                          <path d="M6 9v6h8V9" />
                          <path d="M8 5c0 1-1 1.5-1 2.5" />
                          <path d="M11 4c0 1-1 1.5-1 2.5" />
                        </svg>
                      </button>
                      <button
                        onClick={() => startEditRecipe(r.id)}
                        title="Muokkaa"
                        aria-label="Muokkaa"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs hover:bg-gray-100 transition sm:h-8 sm:w-8"
                      >
                        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 14.5V17h2.5L15 7.5 12.5 5 3 14.5z" />
                          <path d="M11.8 5.7 14.3 8.2" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          setConfirmRecipeDeleteId(r.id);
                        }}
                        title="Poista"
                        aria-label="Poista"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-red-600 text-white text-xs hover:bg-red-700 transition sm:h-8 sm:w-8"
                      >
                        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                          <line x1="5" y1="5" x2="15" y2="15" />
                          <line x1="15" y1="5" x2="5" y2="15" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                {r.notes && <p className="text-sm opacity-80 whitespace-pre-wrap break-words">{r.notes}</p>}

                <ul className="text-sm space-y-1">
                  {r.ingredients.map((i, idx) => (
                    <li key={idx} className="flex justify-between gap-4 min-w-0">      
                      <span className="min-w-0 break-words">{i.name}</span>
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
        Eipä tarvii ennää miettiä mitä ens viikolla syötäis. Made with ♥ by Joona.
      </footer>
    </main>
  );
}
