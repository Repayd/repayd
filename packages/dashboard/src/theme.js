(() => {
  const key = "repayd.theme";
  const preference = window.matchMedia("(prefers-color-scheme: dark)");
  let saved;
  try {
    saved = localStorage.getItem(key);
  } catch {
    /* Storage is optional. */
  }
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-pressed", String(theme === "dark"));
      button.setAttribute(
        "aria-label",
        `Switch to ${theme === "dark" ? "light" : "dark"} theme`,
      );
      const label = button.querySelector("[data-theme-label]");
      if (label) label.textContent = theme === "dark" ? "Light" : "Dark";
    });
  };
  apply(
    saved === "light" || saved === "dark"
      ? saved
      : preference.matches
      ? "dark"
      : "light",
  );
  document.addEventListener("DOMContentLoaded", () => {
    apply(document.documentElement.dataset.theme);
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        saved =
          document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(key, saved);
        } catch {
          /* Keep the in-memory preference. */
        }
        apply(saved);
      });
    });
  });
  preference.addEventListener("change", (event) => {
    if (saved !== "light" && saved !== "dark")
      apply(event.matches ? "dark" : "light");
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key) return;
    saved = event.newValue;
    apply(
      saved === "light" || saved === "dark"
        ? saved
        : preference.matches
        ? "dark"
        : "light",
    );
  });
})();
