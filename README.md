# abiface

Turn any smart contract into a usable interface. Paste a contract address and its ABI, and abiface generates read and write controls for every function — no build step, no backend, no private keys.

## Features

- **ABI-to-UI generation** — every function becomes a card with labeled input fields.
- **Read calls** — call `view` / `pure` functions without a wallet, using a public or custom RPC.
- **Write calls** — send transactions through the connected wallet.
- **ETH values, not wei** — payable functions and `receive` entry points accept decimal ETH values, converted with `ethers.parseEther`.
- **Wallet + chain support** — injected wallet connection, chain switching, ENS/GNS/WNS names, and transaction tracking.
- **Function filter** — quickly narrow large ABIs by function name, type, or parameter.
- **Remembers the last contract** — address and ABI are stored locally in the browser.
- **No backend** — everything runs client-side.

## Supported networks

| Network | Chain ID | Native currency |
| --- | ---: | --- |
| Ethereum | 1 | ETH |
| Gnosis | 100 | xDAI |
| Arbitrum | 42161 | ETH |
| Optimism | 10 | ETH |
| Base | 8453 | ETH |

## Quick start

There is no build step. Serve the folder with any static file server:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

ES modules require an HTTP server; opening `index.html` directly with `file://` will not work.

## Usage

1. Paste the contract address (`0x` followed by 40 hex characters).
2. Paste the ABI.
3. Click **Load contract**.
4. Use the generated **Read** cards to call functions, or connect a wallet and use the **Write** cards to send transactions.
5. For payable functions, enter the amount in **ETH** — for example `0.05`, not `50000000000000000`.

Click the contract address in the summary bar to copy it. Use the filter field to show only matching functions.

## Supported ABI formats

**JSON array** — the standard ABI output:

```json
[
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [{ "name": "owner", "type": "address" }],
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view"
  }
]
```

**Compiler artifact** — an object containing an `abi` array (Hardhat, Foundry, etc.):

```json
{ "abi": [ ... ], "bytecode": "0x..." }
```

**Human-readable ABI** — one fragment per line:

```text
function balanceOf(address owner) view returns (uint256)
function transfer(address to, uint256 amount) returns (bool)
```

## Input types

- `address`, `uint*`, `int*`, `bytes*`, `string` → text input
- `bool` → true/false select
- tuples and arrays → JSON, for example `[1, "0xabc..."]` or `{"id": 1, "owner": "0xabc..."}`

## How it works

- `js/abi-interface.js` parses the ABI with `ethers.Interface`, builds the UI, and creates `ethers.Contract` instances for calls.
- Read calls use the connected wallet provider when available; otherwise they use the current network's RPC URL.
- Write calls request a signer from the connected wallet and track the transaction with `Notification.track`.
- `receive` and `fallback` entry points are shown separately, with ETH value fields when payable.

## Project structure

```text
abiface/
├─ index.html                 Page, layout, and ABI interface styles
├─ assets/
│  ├─ css/styleKit.css        Wallet, chain, settings, and notification UI
│  └─ img/                    Network and wallet icons
├─ js/
│  ├─ app.js                  Mounts the UI components
│  ├─ abi-interface.js        ABI parsing and contract controls
│  └─ libs/
│     ├─ dappkit.js           Wallet, chain, settings, notifications, copy
│     └─ ethers.min.js        ethers v6
├─ README.md
└─ license
```

## RPC behavior

Custom RPC URLs are saved in `localStorage` as `<network>-rpc`.

- ENS, GNS, and WNS name resolution always use the **Ethereum** RPC entry.
- ABI read calls use the wallet provider when connected. When disconnected, they use the selected network's custom RPC if set, otherwise its public default.
- Write transactions always go through the connected wallet, not the configured RPC.

## Limitations

- The address must be a `0x`-prefixed 20-byte hex address.
- Tuple and array inputs must be valid JSON.
- Write transactions require a wallet connected to the same network as the contract.
- Event logs and contract source code are not displayed.
- The ABI is trusted as provided; only interact with contracts you trust.

## License

MIT — see the [license](./license) file.
