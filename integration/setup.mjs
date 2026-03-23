import { beforeEach } from "vitest";

if (!customElements.get("ha-icon")) {
  class HaIconStub extends HTMLElement {
    connectedCallback() {
      const icon = this.getAttribute("icon") || this.icon || "";
      this.textContent = icon.replace("mdi:", "");
    }
  }
  customElements.define("ha-icon", HaIconStub);
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.customCards = [];
});
