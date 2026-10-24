// Types the name only on the first visit of the start page per session.
try {
  if (!sessionStorage.getItem("intro-seen")) {
    sessionStorage.setItem("intro-seen", "1");
    document.documentElement.classList.add("intro");
  }
} catch {}
