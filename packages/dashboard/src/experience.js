const byId = (id) => document.getElementById(id);
const query = (selector) => document.querySelector(selector);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded', () => {
  const header = query('.site-header');
  const menu = query('[data-menu-toggle]');
  menu?.addEventListener('click', () => {
    const open = header?.classList.toggle('menu-open') ?? false;
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });

  const primaryNav = query('.primary-nav');
  if (primaryNav && !primaryNav.querySelector('[href="/capital"]')) {
    primaryNav.insertAdjacentHTML('beforeend', '<a href="/capital">Capital</a><a href="/flow">Flow</a>');
  }

  const revealNodes = [...document.querySelectorAll('.reveal')];
  revealNodes.forEach((node) => node.classList.add('is-pending'));
  if (!reduced && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('is-pending');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    revealNodes.forEach((node) => observer.observe(node));
  } else revealNodes.forEach((node) => node.classList.remove('is-pending'));

  const tabs = [...document.querySelectorAll('[data-story-tab]')];
  const storyTitle = byId('story-title') || query('[data-story-title]');
  const storyCopy = byId('story-copy') || query('[data-story-copy]');
  const storyLink = byId('story-link') || query('[data-story-link]');
  const panels = [
    ['Set the boundary before money moves.', 'Every payment meets a policy at the GuardAccount. Known recipients pass. Unknown recipients pause. Violations never leave the contract.', 'Open the owner view', '/app'],
    ['Make a decision you can replay.', 'The live run keeps the receipt, the source, the block, and the exact reason together. No black-box confidence score replaces the evidence.', 'Watch the live demo', '/demo'],
    ['Let a controlled miss become a recovery.', 'The scenario deliberately lets a lookalike payment slip through. A covered verdict calls the pool and sends the recovery to the owner.', 'See capital at work', '/demo'],
    ['Prove what is real. Label what is not.', 'Chain receipts stay separate from local watcher reasoning and scripted inputs. Trust grows when the boundaries are visible.', 'Read the agent record', '/record'],
  ];
  const selectTab = (index) => {
    const item = panels[index] ?? panels[0];
    tabs.forEach((tab, tabIndex) => {
      tab.setAttribute('aria-selected', String(tabIndex === index));
      tab.tabIndex = tabIndex === index ? 0 : -1;
    });
    if (storyTitle) storyTitle.textContent = item[0];
    if (storyCopy) storyCopy.textContent = item[1];
    if (storyLink) {
      storyLink.textContent = `${item[2]} ↗`;
      storyLink.href = item[3];
    }
  };
  tabs.forEach((tab, index) => tab.addEventListener('click', () => selectTab(index)));

  const dialog = byId('onboarding');
  const step = byId('tour-step');
  const tourTitle = byId('onboarding-title');
  const description = byId('tour-description');
  const dots = [...document.querySelectorAll('.tour-dots i')];
  const next = query('[data-tour-next]');
  const back = query('[data-tour-back]');
  const finish = byId('tour-finish');
  const tour = [
    ['01 / 03 · THE BOUNDARY', 'Meet your agent’s safety net.', 'Your agent gets a spending key. You set the rules. The GuardAccount checks every payment before money can move.'],
    ['02 / 03 · THE EVIDENCE', 'See the decision happen.', 'Start one live Arc testnet run. Payroll passes, a suspicious payment pauses, and a policy violation is rejected with its own receipt.'],
    ['03 / 03 · THE RECOVERY', 'Watch the promise become proof.', 'A controlled miss settles, the pool covers it, and the owner receives the recovery. Every step stays inspectable.'],
  ];
  let tourIndex = 0;
  const renderTour = () => {
    const current = tour[tourIndex];
    if (!current) return;
    if (step) step.textContent = current[0];
    if (tourTitle) tourTitle.textContent = current[1];
    if (description) description.textContent = current[2];
    dots.forEach((dot, index) => dot.classList.toggle('active', index === tourIndex));
    if (next) next.hidden = tourIndex === tour.length - 1;
    if (finish) finish.hidden = tourIndex !== tour.length - 1;
  };
  const openTour = () => {
    renderTour();
    if (!dialog) return;
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
  };
  document.querySelectorAll('[data-onboarding-open]').forEach((button) => button.addEventListener('click', openTour));
  query('[data-tour-close]')?.addEventListener('click', () => dialog?.close());
  back?.addEventListener('click', () => {
    dialog?.close();
    try { localStorage.setItem('repayd.tour-seen', '1'); } catch {}
  });
  next?.addEventListener('click', (event) => {
    event.preventDefault();
    tourIndex = Math.min(tourIndex + 1, tour.length - 1);
    renderTour();
  });
  finish?.addEventListener('click', () => {
    try { localStorage.setItem('repayd.tour-seen', '1'); } catch {}
    dialog?.close();
  });
  dialog?.addEventListener('close', () => {
    try { localStorage.setItem('repayd.tour-seen', '1'); } catch {}
  });
  if (document.body.dataset.page === 'owner' && new URLSearchParams(location.search).has('welcome')) openTour();

  const motion = query('[data-motion-toggle]');
  motion?.addEventListener('click', () => {
    const paused = document.body.classList.toggle('motion-paused');
    motion.setAttribute('aria-pressed', String(paused));
    motion.textContent = paused ? 'Play motion' : 'Pause motion';
  });
});
