import { ethers } from "./libs/ethers.min.js";
import {
  Notification,
  getRpcUrl,
  networkConfigs,
} from "./libs/dappkit.js";

const STORAGE_KEY = "abiface:lastContract";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const isReadFunction = (fragment) =>
  fragment.stateMutability === "view" || fragment.stateMutability === "pure";

const formatValue = (value) => {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(
        value,
        (_key, item) => (typeof item === "bigint" ? item.toString() : item),
        2,
      );
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const inputPlaceholder = (param) => {
  const type = param.type;
  if (type === "address") return "0x…";
  if (type === "bool") return "true / false";
  if (type.startsWith("uint") || type.startsWith("int")) return "0";
  if (type.startsWith("bytes")) return "0x…";
  if (type === "string") return "text";
  if (type.startsWith("tuple")) return '["value", …] or {"name": "value"}';
  if (type.endsWith("]")) return "[1, 2, 3]";
  return type;
};

export class AbiInterface {
  static mount(wallet) {
    const root = document.querySelector("#abi-app");
    if (!root) return null;
    return new AbiInterface(root, wallet);
  }

  constructor(root, wallet) {
    this.root = root;
    this.wallet = wallet;
    this.abi = null;
    this.address = null;
    this.cards = [];

    this.form = root.querySelector("#abi-form");
    this.addressInput = root.querySelector("#abi-address");
    this.abiInput = root.querySelector("#abi-input");
    this.errorEl = root.querySelector("#abi-error");
    this.summary = root.querySelector("#abi-summary");
    this.toolbar = root.querySelector("#abi-toolbar");
    this.filter = root.querySelector("#abi-filter");
    this.results = root.querySelector("#abi-results");

    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.load();
    });

    root.querySelector("#abi-clear")?.addEventListener("click", () => this.clear());
    this.filter?.addEventListener("input", () => this.applyFilter());

    this.restore();
  }

  /* ---------- loading ---------- */

  restore() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      saved = null;
    }
    if (!saved?.address || !saved?.abi) return;

    this.addressInput.value = saved.address;
    this.abiInput.value =
      typeof saved.abi === "string" ? saved.abi : JSON.stringify(saved.abi, null, 2);
    this.load({ silent: true });
  }

  persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ address: this.address, abi: this.abi }),
      );
    } catch {
      /* storage can be unavailable; ignore */
    }
  }

  parseAbi(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Allow human-readable ABIs, one fragment per line.
      const fragments = raw
        .split("\n")
        .map((line) => line.trim().replace(/,$/, ""))
        .filter(Boolean);
      const isFragment = (line) =>
        /^(function|event|error|constructor|receive|fallback)\b/.test(line);
      if (!fragments.length || !fragments.every(isFragment)) {
        throw new Error(
          "ABI is not valid JSON. For human-readable ABIs, put one function per line, e.g. function balanceOf(address) view returns (uint256).",
        );
      }
      parsed = fragments;
    }

    if (typeof parsed === "string") parsed = [parsed];
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.abi)) {
      parsed = parsed.abi;
    }
    if (!Array.isArray(parsed)) {
      throw new Error("ABI must be a JSON array (or a compiler artifact containing one).");
    }
    return parsed;
  }

  load({ silent = false } = {}) {
    this.setError("");

    const rawAbi = this.abiInput.value.trim();
    if (!rawAbi) return this.setError("Paste an ABI first.");
    if (!this.addressInput.value.trim())
      return this.setError("Enter a contract address.");

    const rawAddress = this.addressInput.value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawAddress)) {
      return this.setError("That contract address is not valid.");
    }
    let address;
    try {
      address = ethers.getAddress(rawAddress.toLowerCase());
    } catch {
      return this.setError("That contract address is not valid.");
    }

    let abi;
    try {
      abi = this.parseAbi(rawAbi);
    } catch (error) {
      return this.setError(error.message);
    }

    let iface;
    try {
      iface = new ethers.Interface(abi);
    } catch (error) {
      return this.setError(`Could not read the ABI: ${error.message}`);
    }

    this.abi = abi;
    this.address = address;
    this.interface = iface;
    this.addressInput.value = address;

    this.render();
    this.persist();

    if (!silent) {
      const count = iface.fragments.filter((f) => f.type === "function").length;
      Notification.show(
        `Loaded ${count} function${count === 1 ? "" : "s"} at ${address.slice(0, 6)}…${address.slice(-4)}`,
        "success",
      );
    }
  }

  clear() {
    this.abi = null;
    this.address = null;
    this.interface = null;
    this.cards = [];
    this.addressInput.value = "";
    this.abiInput.value = "";
    this.results.replaceChildren();
    this.summary.hidden = true;
    this.toolbar.hidden = true;
    this.filter.value = "";
    this.setError("");
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.addressInput.focus();
  }

  setError(message) {
    this.errorEl.textContent = message;
    this.errorEl.hidden = !message;
    return null;
  }

  /* ---------- rendering ---------- */

  render() {
    this.cards = [];
    this.results.replaceChildren();

    const functions = this.interface.fragments.filter((f) => f.type === "function");
    const reads = functions.filter(isReadFunction);
    const writes = functions.filter((f) => !isReadFunction(f));
    const receives = this.interface.fragments.filter(
      (f) => f.type === "receive" || f.type === "fallback",
    );

    this.summary.hidden = false;
    this.summary.replaceChildren();
    const addressEl = el("code", "abi-address", this.address);
    addressEl.title = "Click to copy";
    addressEl.addEventListener("click", () => this.copyAddress());
    this.summary.append(
      el("span", "abi-summary-label", "Contract"),
      addressEl,
      el(
        "span",
        "abi-summary-count",
        `${functions.length} function${functions.length === 1 ? "" : "s"}`,
      ),
    );

    this.toolbar.hidden = functions.length + receives.length === 0;
    this.filter.value = "";

    if (reads.length) {
      this.results.append(
        this.renderSection("Read", "Free calls — no wallet or gas required.", reads),
      );
    }
    if (writes.length) {
      this.results.append(
        this.renderSection(
          "Write",
          "Transactions — connect a wallet. Payable values are entered in ETH.",
          writes,
        ),
      );
    }
    if (receives.length) {
      this.results.append(
        this.renderSection("Receive", "Receive and fallback entry points.", receives),
      );
    }

    if (!functions.length && !receives.length) {
      this.results.append(
        el("p", "abi-empty", "This ABI does not contain any callable functions."),
      );
    }
  }

  renderSection(title, description, fragments) {
    const section = el("section", "fn-section");
    const heading = el("div", "fn-heading");
    heading.append(el("h2", "", title), el("p", "fn-description", description));
    const grid = el("div", "fn-grid");

    for (const fragment of fragments) {
      grid.append(this.renderCard(fragment));
    }

    section.append(heading, grid);
    return section;
  }

  renderCard(fragment) {
    const card = el("article", "fn-card");
    card.dataset.search = [
      fragment.name || "",
      fragment.type,
      fragment.stateMutability,
      ...(fragment.inputs || []).map((input) => `${input.name} ${input.type}`),
    ]
      .join(" ")
      .toLowerCase();

    if (fragment.type === "receive" || fragment.type === "fallback") {
      return this.renderReceiveCard(card, fragment);
    }

    const isRead = isReadFunction(fragment);
    const signature = fragment.format("sighash");

    const header = el("header", "fn-header");
    header.append(el("span", "fn-name", fragment.name));

    const badge = el(
      "span",
      `fn-badge ${isRead ? "fn-badge-read" : fragment.payable ? "fn-badge-pay" : "fn-badge-write"}`,
      fragment.stateMutability,
    );
    header.append(badge);

    const sig = el("div", "fn-signature");
    sig.textContent = `${signature}${
      fragment.outputs.length
        ? ` → ${fragment.outputs.map((output) => output.type).join(", ")}`
        : ""
    }`;

    const fields = el("div", "fn-fields");
    const controls = [];
    fragment.inputs.forEach((param, index) => {
      const { field, control } = this.createField(param, index);
      fields.append(field);
      controls.push(control);
    });

    let valueControl = null;
    if (fragment.payable) {
      const { field, control } = this.createValueField();
      fields.append(field);
      valueControl = control;
    }

    const footer = el("div", "fn-footer");
    const button = el("button", "btn fn-action", isRead ? "Call" : "Send");
    button.type = "button";
    footer.append(button);

    const result = el("pre", "fn-result");
    result.hidden = true;

    card.append(header, sig, fields, footer, result);
    this.cards.push(card);

    button.addEventListener("click", () => {
      if (isRead) {
        this.callFunction(fragment, controls, button, result);
      } else {
        this.sendTransaction(fragment, controls, valueControl, button, result);
      }
    });

    return card;
  }

  renderReceiveCard(card, fragment) {
    const isReceive = fragment.format("minimal").startsWith("receive(");
    const payable = fragment.payable !== false;
    card.dataset.search = `${isReceive ? "receive" : "fallback"} eth`.toLowerCase();

    const header = el("header", "fn-header");
    header.append(
      el("span", "fn-name", isReceive ? "Receive ETH" : "Fallback"),
      el(
        "span",
        payable ? "fn-badge fn-badge-pay" : "fn-badge fn-badge-write",
        payable ? "payable" : "nonpayable",
      ),
    );

    const sig = el(
      "div",
      "fn-signature",
      isReceive
        ? "receive() external payable"
        : `fallback() external ${payable ? "payable" : "nonpayable"}`,
    );

    const fields = el("div", "fn-fields");
    const value = payable ? this.createValueField() : null;
    if (value) fields.append(value.field);

    const footer = el("div", "fn-footer");
    const button = el(
      "button",
      "btn fn-action",
      payable ? "Send ETH" : "Call fallback",
    );
    button.type = "button";
    footer.append(button);

    const result = el("pre", "fn-result");
    result.hidden = true;

    card.append(header, sig, fields, footer, result);
    this.cards.push(card);

    button.addEventListener("click", () => {
      this.sendReceive(fragment, value?.control, button, result, isReceive);
    });

    return card;
  }

  createField(param, index) {
    const field = el("div", "fn-field");
    const label = el("label", "fn-label");
    const name = el("span", "", param.name || `arg${index}`);
    label.setAttribute("aria-label", `${param.name || `arg${index}`} (${param.type})`);
    label.append(name, el("span", "fn-type", param.type));

    let control;
    if (param.type === "bool") {
      control = el("select", "fn-input");
      control.append(
        Object.assign(el("option", "", "true"), { value: "true" }),
        Object.assign(el("option", "", "false"), { value: "false" }),
      );
    } else {
      control = el("input", "fn-input");
      control.type = "text";
      control.placeholder = inputPlaceholder(param);
      control.autocomplete = "off";
      control.spellcheck = false;
    }

    field.append(label, control);
    return { field, control };
  }

  createValueField() {
    const field = el("div", "fn-field");
    const label = el("label", "fn-label");
    label.setAttribute("aria-label", "value (ETH)");
    label.append(el("span", "", "value"), el("span", "fn-type", "ETH"));
    const control = el("input", "fn-input fn-value");
    control.type = "text";
    control.inputMode = "decimal";
    control.placeholder = "0.0";
    control.autocomplete = "off";
    field.append(label, control);
    return { field, control };
  }

  /* ---------- input parsing ---------- */

  readInput(param, control) {
    const raw = control.value;

    if (param.type === "bool") return raw === "true";

    const type = param.type;
    const composite = type.startsWith("tuple") || type.endsWith("]");

    if (composite) {
      if (!raw.trim())
        throw new Error(`"${param.name || param.type}" needs a JSON value.`);
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error(
          `"${param.name || param.type}" must be valid JSON (e.g. [1, 2] or {"field": 1}).`,
        );
      }
    }

    if (type === "string" || type.startsWith("bytes")) return raw;

    if (!raw.trim()) throw new Error(`"${param.name || param.type}" is required.`);
    return raw.trim();
  }

  readArgs(fragment, controls) {
    return fragment.inputs.map((param, index) =>
      this.readInput(param, controls[index]),
    );
  }

  readEthValue(control) {
    const raw = (control?.value || "0").trim();
    if (!raw) return 0n;
    if (!/^\d*\.?\d+$/.test(raw) || raw === ".")
      throw new Error("Enter the ETH value as a decimal number, e.g. 0.05.");
    return ethers.parseEther(raw);
  }

  /* ---------- providers & actions ---------- */

  getReadProvider() {
    const browserProvider = this.wallet.getEthersProvider();
    if (browserProvider) return browserProvider;

    const chainId = Number(this.wallet.getCurrentChainId() || 1);
    const entry =
      Object.entries(networkConfigs).find(([, config]) => config.chainId === chainId) ??
      Object.entries(networkConfigs)[0];
    return new ethers.JsonRpcProvider(getRpcUrl(entry[0]));
  }

  async callFunction(fragment, controls, button, result) {
    let args;
    try {
      args = this.readArgs(fragment, controls);
    } catch (error) {
      return this.showResult(result, error.message, true);
    }

    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Calling…";
    result.hidden = true;

    try {
      const contract = new ethers.Contract(
        this.address,
        this.abi,
        this.getReadProvider(),
      );
      const fn = contract.getFunction(fragment.format("sighash"));
      const output = await fn(...args);
      this.showResult(result, this.formatOutput(fragment, output));
    } catch (error) {
      this.showResult(result, error.shortMessage || error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  async sendTransaction(fragment, controls, valueControl, button, result) {
    if (!this.wallet.isConnected()) {
      Notification.show("Connect your wallet to send transactions.", "warning");
      return;
    }

    let args;
    let value;
    try {
      args = this.readArgs(fragment, controls);
      value = fragment.payable ? this.readEthValue(valueControl) : undefined;
    } catch (error) {
      return this.showResult(result, error.message, true);
    }

    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Confirm in wallet…";
    result.hidden = true;

    try {
      const signer = await this.wallet.getEthersProvider().getSigner();
      const contract = new ethers.Contract(this.address, this.abi, signer);
      const fn = contract.getFunction(fragment.format("sighash"));
      const overrides = value === undefined ? {} : { value };
      const tx = await fn(...args, overrides);
      Notification.track(tx, {
        label: fragment.format("sighash"),
        onSuccess: (receipt) =>
          this.showResult(
            result,
            `Confirmed in block ${receipt.blockNumber}\n${tx.hash}`,
          ),
        onError: () => this.showResult(result, "Transaction failed.", true),
      });
      this.showResult(
        result,
        `Transaction sent: ${tx.hash}\nWaiting for confirmation…`,
      );
    } catch (error) {
      const message = error.shortMessage || error.message;
      this.showResult(result, message, true);
      if (error.code === "ACTION_REJECTED") {
        Notification.show("Transaction rejected in wallet.", "warning");
      } else {
        Notification.show(message, "error");
      }
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  async sendReceive(fragment, valueControl, button, result, isReceive) {
    if (!this.wallet.isConnected()) {
      Notification.show("Connect your wallet to send ETH.", "warning");
      return;
    }

    let value = 0n;
    try {
      if (valueControl) {
        value = this.readEthValue(valueControl);
        if (value === 0n) throw new Error("Enter an ETH amount greater than 0.");
      }
    } catch (error) {
      return this.showResult(result, error.message, true);
    }

    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Confirm in wallet…";
    result.hidden = true;

    try {
      const signer = await this.wallet.getEthersProvider().getSigner();
      const tx = await signer.sendTransaction({
        to: this.address,
        value,
        ...(isReceive ? {} : { data: "0x00" }),
      });
      Notification.track(tx, {
        label: isReceive ? "Receive ETH" : "Fallback",
        onSuccess: (receipt) =>
          this.showResult(
            result,
            `Confirmed in block ${receipt.blockNumber}\n${tx.hash}`,
          ),
        onError: () => this.showResult(result, "Transaction failed.", true),
      });
      this.showResult(result, `Transaction sent: ${tx.hash}\nWaiting for confirmation…`);
    } catch (error) {
      const message = error.shortMessage || error.message;
      this.showResult(result, message, true);
      Notification.show(message, "error");
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  formatOutput(fragment, output) {
    if (!fragment.outputs.length) return "No return value.";

    if (fragment.outputs.length === 1) {
      return formatValue(output);
    }

    return fragment.outputs
      .map((param, index) => {
        const name = param.name || `result${index}`;
        return `${name} (${param.type}): ${formatValue(output[index])}`;
      })
      .join("\n");
  }

  showResult(result, message, isError = false) {
    result.hidden = false;
    result.classList.toggle("fn-result-error", isError);
    result.textContent = message;
  }

  applyFilter() {
    const query = this.filter.value.trim().toLowerCase();
    for (const card of this.cards) {
      card.hidden = query.length > 0 && !card.dataset.search.includes(query);
    }
    for (const section of this.results.querySelectorAll(".fn-section")) {
      section.hidden = ![...section.querySelectorAll(".fn-card")].some(
        (card) => !card.hidden,
      );
    }
  }

  async copyAddress() {
    try {
      await navigator.clipboard.writeText(this.address);
      Notification.show("Contract address copied.", "success");
    } catch {
      Notification.show("Could not copy the address.", "error");
    }
  }
}
