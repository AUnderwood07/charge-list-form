"use strict";

// =====================================================================
// CONFIG: the only part you should need to edit when n8n is ready.
// =====================================================================
const CONFIG = {
  // n8n GET webhook that returns the parts list.
  // Blank = use SAMPLE_PARTS from sample-parts.js (demo mode).
  PARTS_URL: "",

  // n8n POST webhook that receives submissions.
  // Blank = demo mode: nothing is sent; the thank-you screen shows the data instead.
  SUBMIT_URL: "",
};

// =====================================================================
// Helpers
// =====================================================================
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const $ = (selector) => document.querySelector(selector);

// Create an element with an optional class and text (textContent keeps names
// like  Six" Drip Pans  safe; no HTML is ever built from data).
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Wrap an input in a small label, e.g.  Qty [ 1 ]
function labeled(labelText, input, extraClass) {
  const wrap = el("label", extraClass || "");
  wrap.append(el("span", "mini-label", labelText), input);
  return wrap;
}

function numberInput(className, { min, step, placeholder }) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = className;
  input.min = min;
  input.step = step;
  input.inputMode = step === "1" ? "numeric" : "decimal";
  if (placeholder) input.placeholder = placeholder;
  return input;
}

// "" -> null, "12.5" -> 12.5, "abc" -> NaN (caught by validation)
function parseCost(value) {
  const text = String(value).trim();
  return text === "" ? null : Number(text);
}

// Whole number >= 1, otherwise NaN
function parseQty(value) {
  const n = Number(String(value).trim());
  return Number.isInteger(n) && n >= 1 ? n : NaN;
}

// =====================================================================
// Startup
// =====================================================================
document.addEventListener("DOMContentLoaded", () => {
  $("#add-other").addEventListener("click", () => addOtherRow(true));
  $("#charge-form").addEventListener("submit", onSubmit);
  $("#submit-another").addEventListener("click", resetForm);
  // Clear the red outline as soon as someone edits a flagged field
  $("#charge-form").addEventListener("input", (e) => e.target.classList.remove("invalid"));

  addOtherRow(false);
  loadParts();
});

// =====================================================================
// Load the parts list (from n8n, or the sample list in demo mode)
// =====================================================================
async function loadParts() {
  hideBanner();
  try {
    let raw;
    if (CONFIG.PARTS_URL) {
      const res = await fetch(CONFIG.PARTS_URL);
      if (!res.ok) throw new Error(`server responded ${res.status}`);
      const data = await res.json();
      raw = Array.isArray(data) ? data : data.parts;
    } else {
      raw = typeof SAMPLE_PARTS !== "undefined" ? SAMPLE_PARTS : [];
      showBanner("Demo mode: using a sample parts list. Nothing is sent to n8n. " +
                 "Submitting shows the data that would be sent.");
    }
    renderCharges(normalizeParts(raw || []));
  } catch (err) {
    $("#cleaning-list").textContent = "";
    $("#replacement-list").textContent = "";
    showBanner(`Could not load the charge list (${err.message}).`, true, loadParts);
  }
}

// Accepts either the tidy format (id, name, price, category) or raw sheet
// column names (ID, Full Name, Charge (min), Category), so n8n can pass rows
// through with little reshaping.
function normalizeParts(list) {
  return list
    .map((p) => ({
      id: Number(p.id ?? p.ID),
      name: String(p.name ?? p["Full Name"] ?? "").trim(),
      chargeType: String(p.chargeType ?? p["Charge Type"] ?? "").trim(),
      price: Number(p.price ?? p["Charge (min)"]) || 0,
      category: String(p.category ?? p.Category ?? "").trim().toLowerCase(),
    }))
    .filter((p) => Number.isFinite(p.id) && p.name && p.category !== "hidden");
}

// =====================================================================
// Build the checkbox rows
// =====================================================================
function renderCharges(parts) {
  const groups = [
    { container: $("#cleaning-list"), category: "cleaning", withCost: true },
    { container: $("#replacement-list"), category: "replacement", withCost: false },
  ];

  for (const { container, category, withCost } of groups) {
    container.textContent = "";
    const inGroup = parts.filter((p) => p.category === category);
    if (inGroup.length === 0) {
      container.append(el("p", "loading", "No charges in this category."));
      continue;
    }
    for (const part of inGroup) container.append(buildChargeRow(part, withCost));
  }
  updateTotals();
}

//  [☐] Kitchen Cleaning $45.00   Qty [ ]   Cost $ [ ]   —
//  [Notes (optional)........................................]   (only when checked)
function buildChargeRow(part, withCost) {
  const row = el("div", "charge-row");
  row.dataset.id = part.id;
  row.dataset.price = part.price;
  row.dataset.name = part.name;

  const line = el("div", withCost ? "charge-line" : "charge-line no-cost");

  // Checkbox + name + standard price
  const nameLabel = el("label", "charge-name");
  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "charge-check";
  const priceText = part.price > 0 ? `${money.format(part.price)} ea` : "price varies";
  nameLabel.append(check, el("span", "name", part.name), el("span", "price", priceText));
  line.append(nameLabel);

  // Qty (locked until checked)
  const qty = numberInput("qty", { min: "1", step: "1" });
  qty.disabled = true;
  line.append(labeled("Qty", qty));

  // Cost: cleaning rows only. Blank = sheet price, except $0 rows where it's required.
  if (withCost) {
    const cost = numberInput("cost", {
      min: "0",
      step: "0.01",
      placeholder: part.price > 0 ? part.price.toFixed(2) : "Required",
    });
    cost.disabled = true;
    line.append(labeled("Cost $ (each)", cost));
  }

  line.append(el("span", "line-total", "—"));
  row.append(line);

  // Notes (hidden until checked)
  const note = document.createElement("input");
  note.type = "text";
  note.className = "note-input";
  note.placeholder = "Notes (optional), e.g. living room, bedroom";
  note.hidden = true;
  row.append(note);

  check.addEventListener("change", () => syncChargeRow(row));
  row.addEventListener("input", updateTotals);
  return row;
}

// Lock/unlock a row's inputs to match its checkbox
function syncChargeRow(row) {
  const checked = row.querySelector(".charge-check").checked;
  const qty = row.querySelector(".qty");
  const cost = row.querySelector(".cost"); // null on replacement rows
  const note = row.querySelector(".note-input");

  row.classList.toggle("checked", checked);
  qty.disabled = !checked;
  if (cost) cost.disabled = !checked;
  note.hidden = !checked;

  if (checked) {
    if (!qty.value) qty.value = "1";
  } else {
    // Unchecking clears the row
    qty.value = "";
    if (cost) cost.value = "";
    note.value = "";
    row.querySelectorAll(".invalid").forEach((n) => n.classList.remove("invalid"));
  }
  updateTotals();
}

// =====================================================================
// "Other" rows
// =====================================================================
//  Description [..........]  Qty [1]  Cost $ [  ]  $0.00  [✕]
//  [Notes (optional)........................................]
function addOtherRow(focus) {
  const row = el("div", "other-row");
  const line = el("div", "other-line");

  const desc = document.createElement("input");
  desc.type = "text";
  desc.className = "other-desc-input";
  desc.placeholder = "e.g. Smoke detector";
  line.append(labeled("Description", desc, "other-desc"));

  const qty = numberInput("qty", { min: "1", step: "1" });
  qty.value = "1";
  line.append(labeled("Qty", qty));

  const cost = numberInput("cost", { min: "0", step: "0.01", placeholder: "0.00" });
  line.append(labeled("Cost $ (each)", cost));

  line.append(el("span", "line-total", "—"));

  const remove = el("button", "remove-other", "✕");
  remove.type = "button";
  remove.title = "Remove this line";
  remove.setAttribute("aria-label", "Remove this line");
  remove.addEventListener("click", () => {
    const list = $("#other-list");
    if (list.children.length > 1) {
      row.remove();
    } else {
      // Keep at least one row on screen; just clear it
      desc.value = ""; qty.value = "1"; cost.value = ""; note.value = "";
      row.querySelectorAll(".invalid").forEach((n) => n.classList.remove("invalid"));
    }
    updateTotals();
  });
  line.append(remove);
  row.append(line);

  const note = document.createElement("input");
  note.type = "text";
  note.className = "note-input";
  note.placeholder = "Notes (optional)";
  row.append(note);

  row.addEventListener("input", updateTotals);
  $("#other-list").append(row);
  if (focus) desc.focus();
}

// An Other row counts once anything besides the default Qty is filled in
function isOtherRowUsed(row) {
  return ["other-desc-input", "cost", "note-input"]
    .some((cls) => row.querySelector(`.${cls}`).value.trim() !== "");
}

// =====================================================================
// Totals (a preview only; n8n does the real pricing)
// =====================================================================
function chargeRowAmount(row) {
  const qty = parseQty(row.querySelector(".qty").value);
  const costInput = row.querySelector(".cost");
  const cost = costInput ? parseCost(costInput.value) : null;
  const unit = cost === null ? Number(row.dataset.price) : cost;
  return qty * unit; // NaN if something is invalid
}

function otherRowAmount(row) {
  const qty = parseQty(row.querySelector(".qty").value);
  const cost = parseCost(row.querySelector(".cost").value);
  return qty * (cost ?? 0);
}

function updateTotals() {
  let count = 0;
  let total = 0;

  document.querySelectorAll(".charge-row").forEach((row) => {
    const display = row.querySelector(".line-total");
    if (!row.classList.contains("checked")) { display.textContent = "—"; return; }
    const amount = chargeRowAmount(row);
    count++;
    if (Number.isFinite(amount)) { total += amount; display.textContent = money.format(amount); }
    else display.textContent = "—";
  });

  document.querySelectorAll(".other-row").forEach((row) => {
    const display = row.querySelector(".line-total");
    if (!isOtherRowUsed(row)) { display.textContent = "—"; return; }
    const amount = otherRowAmount(row);
    count++;
    if (Number.isFinite(amount)) { total += amount; display.textContent = money.format(amount); }
    else display.textContent = "—";
  });

  $("#total-count").textContent = `${count} charge${count === 1 ? "" : "s"}`;
  $("#total-amount").textContent = money.format(total);
}

// =====================================================================
// Validation
// =====================================================================
function validate() {
  document.querySelectorAll(".invalid").forEach((n) => n.classList.remove("invalid"));
  const problems = new Set();
  const flag = (input, message) => { input.classList.add("invalid"); problems.add(message); };

  // Unit details
  for (const id of ["property", "customerName", "accountNumber", "unitNumber", "unitWalkedDate"]) {
    const input = document.getElementById(id);
    if (!input.value.trim()) flag(input, "Fill in all unit details.");
  }

  // Checked charges
  const checkedRows = [...document.querySelectorAll(".charge-row.checked")];
  for (const row of checkedRows) {
    const qty = row.querySelector(".qty");
    if (Number.isNaN(parseQty(qty.value))) flag(qty, "Quantities must be whole numbers (1 or more).");

    const cost = row.querySelector(".cost");
    if (cost) {
      const value = parseCost(cost.value);
      if (value !== null && !(value >= 0)) flag(cost, "Costs must be valid dollar amounts.");
      if (value === null && Number(row.dataset.price) === 0) {
        flag(cost, `Enter a cost for ${row.dataset.name}.`);
      }
    }
  }

  // Other rows
  const usedOthers = [...document.querySelectorAll(".other-row")].filter(isOtherRowUsed);
  for (const row of usedOthers) {
    const desc = row.querySelector(".other-desc-input");
    const qty = row.querySelector(".qty");
    const cost = row.querySelector(".cost");
    if (!desc.value.trim()) flag(desc, "Each Other charge needs a description.");
    if (Number.isNaN(parseQty(qty.value))) flag(qty, "Quantities must be whole numbers (1 or more).");
    const value = parseCost(cost.value);
    if (value === null) flag(cost, "Each Other charge needs a cost.");
    else if (!(value >= 0)) flag(cost, "Costs must be valid dollar amounts.");
  }

  if (checkedRows.length === 0 && usedOthers.length === 0) {
    problems.add("Select at least one charge.");
  }

  return [...problems];
}

// =====================================================================
// Build the data sent to n8n (the agreed JSON format)
// =====================================================================
function buildPayload() {
  const value = (id) => document.getElementById(id).value.trim();

  const items = [...document.querySelectorAll(".charge-row.checked")].map((row) => {
    const costInput = row.querySelector(".cost");
    return {
      id: Number(row.dataset.id),
      qty: parseQty(row.querySelector(".qty").value),
      cost: costInput ? parseCost(costInput.value) : null, // null = use sheet price
      note: row.querySelector(".note-input").value.trim(),
    };
  });

  const other = [...document.querySelectorAll(".other-row")].filter(isOtherRowUsed).map((row) => ({
    description: row.querySelector(".other-desc-input").value.trim(),
    qty: parseQty(row.querySelector(".qty").value),
    cost: parseCost(row.querySelector(".cost").value),
    note: row.querySelector(".note-input").value.trim(),
  }));

  return {
    property: value("property"),
    customerName: value("customerName"),
    accountNumber: value("accountNumber"),
    unitNumber: value("unitNumber"),
    unitWalkedDate: value("unitWalkedDate"), // YYYY-MM-DD
    items,
    other,
  };
}

// =====================================================================
// Submit
// =====================================================================
async function onSubmit(event) {
  event.preventDefault();

  const problems = validate();
  if (problems.length) {
    showFormError(problems.join(" "));
    const firstBad = document.querySelector(".invalid");
    if (firstBad) { firstBad.scrollIntoView({ behavior: "smooth", block: "center" }); firstBad.focus({ preventScroll: true }); }
    return;
  }
  hideFormError();

  const payload = buildPayload();
  const button = $("#submit-btn");
  button.disabled = true;
  button.textContent = "Submitting…";

  try {
    const result = await sendPayload(payload);
    showSuccess(payload, result);
  } catch (err) {
    showFormError(`Submission failed (${err.message}). Your entries are still here; please try again.`);
  } finally {
    button.disabled = false;
    button.textContent = "Submit";
  }
}

// The thank-you screen only shows if n8n answers with success, so it confirms
// the rows were actually saved.
async function sendPayload(payload) {
  if (!CONFIG.SUBMIT_URL) {
    await new Promise((resolve) => setTimeout(resolve, 400)); // feel like a real request
    return { ok: true, demo: true };
  }

  const res = await fetch(CONFIG.SUBMIT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `server responded ${res.status}`);
  }
  return data;
}

// =====================================================================
// Thank-you screen and "Submit another"
// =====================================================================
function showSuccess(payload, result) {
  const count = payload.items.length + payload.other.length;
  const total = $("#total-amount").textContent;
  $("#success-summary").textContent =
    `${count} charge${count === 1 ? "" : "s"} (${total}) saved for ${payload.customerName}, ` +
    `${payload.property} unit ${payload.unitNumber}.`;

  const demoBox = $("#demo-payload");
  demoBox.hidden = !result.demo;
  if (result.demo) {
    $("#demo-payload-json").textContent = JSON.stringify(payload, null, 2);
    demoBox.open = true;
  }

  $("#charge-form").hidden = true;
  $("#success").hidden = false;
  window.scrollTo({ top: 0 });
}

function resetForm() {
  const form = $("#charge-form");
  const property = $("#property").value; // keep the property; agents often do several units in a row

  form.reset();
  $("#property").value = property;
  document.querySelectorAll(".charge-row").forEach(syncChargeRow);
  document.querySelectorAll(".invalid").forEach((n) => n.classList.remove("invalid"));
  $("#other-list").textContent = "";
  addOtherRow(false);
  hideFormError();
  updateTotals();

  $("#success").hidden = true;
  form.hidden = false;
  window.scrollTo({ top: 0 });
  $("#customerName").focus();
}

// =====================================================================
// Banner and error message
// =====================================================================
function showBanner(message, isError = false, retry = null) {
  const banner = $("#banner");
  banner.textContent = message;
  banner.classList.toggle("error", isError);
  if (retry) {
    const button = el("button", "btn btn-secondary", "Try again");
    button.type = "button";
    button.addEventListener("click", retry);
    banner.append(button);
  }
  banner.hidden = false;
}

function hideBanner() { $("#banner").hidden = true; }

function showFormError(message) {
  const box = $("#form-error");
  box.textContent = message;
  box.hidden = false;
}

function hideFormError() { $("#form-error").hidden = true; }
