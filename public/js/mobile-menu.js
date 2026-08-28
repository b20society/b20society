// Mobile menu toggle
// Toggles the .is-open class on the menu and backdrop when the hamburger
// button is clicked. Closes the menu on backdrop click, link click, or ESC.

(function initMobileMenu() {
  const hamburger = document.getElementById("hamburger");
  const menu = document.getElementById("mobile-menu");
  const backdrop = document.getElementById("menu-backdrop");

  if (!hamburger || !menu || !backdrop) return;

  function open() {
    menu.classList.add("is-open");
    backdrop.classList.add("is-open");
    hamburger.setAttribute("aria-expanded", "true");
    document.body.classList.add("menu-open");
  }

  function close() {
    menu.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    hamburger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open");
  }

  function toggle() {
    if (menu.classList.contains("is-open")) {
      close();
    } else {
      open();
    }
  }

  hamburger.addEventListener("click", toggle);
  backdrop.addEventListener("click", close);

  // Close on link click (so anchor jumps don't leave menu open)
  menu.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", close);
  });

  // Close on ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.classList.contains("is-open")) {
      close();
    }
  });
})();
