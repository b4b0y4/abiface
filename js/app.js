import {
  ChainSelect,
  ConnectWallet,
  Copy,
  Notification,
  Settings,
  Theme,
  WalletConnect,
} from "./libs/dappkit.js";
import { AbiInterface } from "./abi-interface.js";

const wallet = new ConnectWallet({ autoConnect: true });

document.addEventListener("DOMContentLoaded", () => {
  Copy.mount();
  Theme.mount();
  ChainSelect.mount(wallet);
  WalletConnect.mount(wallet);
  Settings.mount();
  AbiInterface.mount(wallet);

  wallet.setNameResolutionOrder([ "wns", "gns", "ens"]);

  wallet.onConnect(async ({ accounts }) => {
    const name = await wallet.getResolvedName(accounts[0]);
    Notification.show(`Connected to ${wallet.getLastWallet()}: ${name}`, "info");
  });
  wallet.onDisconnect(() => Notification.show("Wallet disconnected", "warning"));
  wallet.onChainChange(({ name, allowed }) => {
    if (allowed) Notification.show(`Switched to ${name}`, "info");
  });
});
